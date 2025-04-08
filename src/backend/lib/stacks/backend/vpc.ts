import { aws_ec2 as ec2, Stack } from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export class Vpc extends Construct {
    public vpc: ec2.Vpc;
    public securityGroup: ec2.SecurityGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const subnetPrefix = Stack.of(this).stackName;
        const vpc = new ec2.Vpc(this, "vpc", {
            ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
            natGateways: 1,
            maxAzs: 3,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    name: `${subnetPrefix}-public`,
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: `${subnetPrefix}-privateIsolated`,
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 28,
                },
                {
                    name: `${subnetPrefix}-privateWithEgress`,
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
            ],
            flowLogs: {
                flowLog: {
                    trafficType: ec2.FlowLogTrafficType.REJECT,
                },
            },
            gatewayEndpoints: {
                S3: {
                    service: ec2.GatewayVpcEndpointAwsService.S3,
                },
                DynamoDB: {
                    service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
                },
            },
        });
        // vpc.addInterfaceEndpoint("ecrDockerInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        // });
        // vpc.addInterfaceEndpoint("appSyncInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.APP_SYNC,
        //     privateDnsEnabled: false,
        // });
        // vpc.addInterfaceEndpoint("bedrockRuntimeInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        // });

        const securityGroup = new ec2.SecurityGroup(this, "securityGroup", {
            vpc: vpc,
            allowAllOutbound: true,
        });

        securityGroup.addIngressRule(
            ec2.Peer.ipv4(vpc.vpcCidrBlock),
            ec2.Port.tcp(443),
            "Allow access from client"
        );
        NagSuppressions.addResourceSuppressions(securityGroup, [
            {
                id: "AwsSolutions-EC23",
                reason: "Security group only allows HTTPS traffic from VPC CIDR block.",
            },
        ]);

        this.vpc = vpc;
        this.securityGroup = securityGroup;
    }
}
