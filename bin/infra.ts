import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { ApplicationProtocol } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';

const app = new cdk.App();

const stack = new cdk.Stack(app, 'EMD-FargateService15',
 { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }}
);

// Create VPC
const vpc = new ec2.Vpc(stack, 'VPC', {
  maxAzs: 2,
  subnetConfiguration: [
    {
      cidrMask: 24,
      name: 'EMD-PublicSubnet',
      subnetType: ec2.SubnetType.PUBLIC,
    },
    {
      cidrMask: 24,
      name: 'EMD-PrivateSubnet',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
  ],
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
});




// ALB Security Group
const albSecurityGroup = new ec2.SecurityGroup(stack, 'EMD-ApplicationLoadBalancerSecurityGroup', { vpc });
// Allow HTTP traffic from the load balancer
albSecurityGroup.addIngressRule(
  ec2.Peer.anyIpv4(),
  ec2.Port.tcp(80),
  'Allow All HTTP traffic'
);

// Create Load Balancer
const alb = new elbv2.ApplicationLoadBalancer(stack, 'EMD-ApplicationLoadBalancer', {
  vpc: vpc,
  internetFacing: true,
  ipAddressType: elbv2.IpAddressType.IPV4,
  securityGroup: albSecurityGroup,
  loadBalancerName: 'EMD-ApplicationLoadBalancer',
  vpcSubnets: {
    subnetType: ec2.SubnetType.PUBLIC
  }
  
});


// Create Fargate Cluster
const cluster = new ecs.Cluster(stack, 'Cluster', { vpc });

// Create ECS Task Definition Template
const fargateTaskDefinition = new ecs.FargateTaskDefinition(stack, `EMD-FargateTaskDefinition`, {
  family: `EMD-CDK-fargateTaskDefinition`,
  cpu: 512,
  memoryLimitMiB: 1024,
  runtimePlatform: {
    cpuArchitecture: ecs.CpuArchitecture.ARM64,
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
  }
});

// Create AWS Fargate Container
const fargateContainer = new ecs.ContainerDefinition(stack, `EMD-FargateContainer`, {
  taskDefinition: fargateTaskDefinition,
  containerName: 'EMD-FargateContainer',
  image: ecs.ContainerImage.fromAsset(path.resolve(__dirname, '../local-image')),
  portMappings: [
      {
          containerPort: 80,
          hostPort: 80,
          protocol: ecs.Protocol.TCP
      }
  ],
  environment: {
      EMD_VAR: 'option 1',
      FAVORITE_DESSERT: 'ice cream'
  },
  logging: new ecs.AwsLogDriver({ streamPrefix: "infra" })
});

// Create Security Group firewall settings
const ec2SecurityGroup = new ec2.SecurityGroup(stack, 'EMD-EC2SecurityGroup', {
  vpc,
  allowAllOutbound: true,
});

// Allow HTTP traffic from the load balancer
ec2SecurityGroup.addIngressRule(
  ec2.Peer.securityGroupId(albSecurityGroup.securityGroupId),
  ec2.Port.tcp(80),
  'Allow All HTTP traffic from ALB on port 80'
);

// create ECS service
const service = new ecs.FargateService(stack, `EMD-ecs-service`, {
  assignPublicIp: true,
  cluster: cluster,
  taskDefinition: fargateTaskDefinition,
  platformVersion: ecs.FargatePlatformVersion.LATEST,
  vpcSubnets: {
      subnets: [
          vpc.privateSubnets[0],
          vpc.privateSubnets[1],
      ]
  },
  securityGroups: [ec2SecurityGroup]
});

// Add HTTP Listener
const httpListener = alb.addListener(`EMD-HTTPListner`, {
  port: 80,
  protocol: ApplicationProtocol.HTTP
});

// Add listener target 
httpListener.addTargets('EMD-ECS', {
  protocol: ApplicationProtocol.HTTP,
  targets: [service.loadBalancerTarget({
    containerName: 'EMD-FargateContainer'
  })],

});

 function generateBucketName(stack: cdk.Stack) : string {
  const environmentType = 'Development';
  const region = stack.region;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const result = `${environmentType}-${region}-${timestamp}`;
  return result.toLocaleLowerCase();
}

const logBucket = new s3.Bucket(stack, 'LogBucket', {
  bucketName: generateBucketName(stack),
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  versioned: true,
});

// enable logging to S3
 alb.logAccessLogs(logBucket, 'alb-logs'); // 'alb-logs' is the optional prefix within the bucket
