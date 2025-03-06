import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";

export class LabsVpc extends Construct {
    public vpc: ec2.Vpc;
    public securityGroup: ec2.SecurityGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const prefix = scope.node.tryGetContext("stackPrefix");
        this.vpc = new ec2.Vpc(this, "vpc", {
            ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
            natGateways: 1,
            maxAzs: 3,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    name: `${prefix}-public-subnet`,
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: `${prefix}-private-isolated`,
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 28,
                },
                {
                    name: `${prefix}-private-with-egress`,
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
        // this.vpc.addInterfaceEndpoint("ecrDockerInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        // });
        // this.vpc.addInterfaceEndpoint("appSyncInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.APP_SYNC,
        //     privateDnsEnabled: false,
        // });
        // this.vpc.addInterfaceEndpoint("bedrockRuntimeInterfaceEndpoint", {
        //     service: ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        // });

        this.securityGroup = new ec2.SecurityGroup(this, "securityGroup", {
            vpc: this.vpc,
            allowAllOutbound: true,
        });

        this.securityGroup.addIngressRule(
            ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
            ec2.Port.tcp(443),
            "Allow access from client"
        );
    }
}
