import { Stack } from "aws-cdk-lib";
import {
    FlowLogTrafficType,
    GatewayVpcEndpointAwsService,
    IpAddresses,
    Peer,
    Port,
    SecurityGroup,
    SubnetType,
    Vpc,
} from "aws-cdk-lib/aws-ec2";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export class Networking extends Construct {
    public vpc: Vpc;
    public securityGroup: SecurityGroup;

    constructor(scope: Construct, id: string) {
        super(scope, id);

        const subnetPrefix = Stack.of(this).stackName;
        const vpc = new Vpc(this, "vpc", {
            ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
            natGateways: 1,
            maxAzs: 3,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            subnetConfiguration: [
                {
                    name: `${subnetPrefix}-public`,
                    subnetType: SubnetType.PUBLIC,
                    cidrMask: 24,
                },
                {
                    name: `${subnetPrefix}-privateIsolated`,
                    subnetType: SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 28,
                },
                {
                    name: `${subnetPrefix}-privateWithEgress`,
                    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24,
                },
            ],
            flowLogs: {
                flowLog: {
                    trafficType: FlowLogTrafficType.REJECT,
                },
            },
            gatewayEndpoints: {
                S3: {
                    service: GatewayVpcEndpointAwsService.S3,
                },
                DynamoDB: {
                    service: GatewayVpcEndpointAwsService.DYNAMODB,
                },
            },
        });
        // vpc.addInterfaceEndpoint("ecrDockerInterfaceEndpoint", {
        //     service: InterfaceVpcEndpointAwsService.ECR_DOCKER,
        // });
        // vpc.addInterfaceEndpoint("appSyncInterfaceEndpoint", {
        //     service: InterfaceVpcEndpointAwsService.APP_SYNC,
        //     privateDnsEnabled: false,
        // });
        // vpc.addInterfaceEndpoint("bedrockRuntimeInterfaceEndpoint", {
        //     service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        // });

        const securityGroup = new SecurityGroup(this, "securityGroup", {
            vpc,
            allowAllOutbound: true,
        });

        securityGroup.addIngressRule(
            Peer.ipv4(vpc.vpcCidrBlock),
            Port.tcp(443),
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
