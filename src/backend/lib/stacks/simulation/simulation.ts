import {
    StackProps,
    aws_iam as iam,
    aws_ec2 as ec2,
    aws_logs as logs,
    aws_ecs as ecs,
} from "aws-cdk-lib";
import * as path from "path";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import { LabsStack } from "../../constructs/stack";

export class SimulationStack extends LabsStack {
    constructor(scope: Construct, id: string, props: StackProps) {
        super(scope, id, props);

        const prefix = scope.node.tryGetContext("stackPrefix");

        // Assuming you have a VPC defined somewhere
        const vpc = new ec2.Vpc(this, `${prefix}SimulationVPC`, {
            // VPC configuration
        });

        // Add VPC Flow Log
        new ec2.FlowLog(this, "FlowLog", {
            resourceType: ec2.FlowLogResourceType.fromVpc(vpc),
            destination: ec2.FlowLogDestination.toCloudWatchLogs(
                new logs.LogGroup(this, "FlowLogGroup", {
                    retention: logs.RetentionDays.ONE_WEEK,
                })
            ),
        });

        // Create ECS cluster
        const cluster = new ecs.Cluster(this, `${prefix}SimulationCluster`, {
            containerInsightsV2: ecs.ContainerInsights.ENABLED,
            vpc: vpc,
        });

        // Build the Docker image
        const image = ecs.ContainerImage.fromAsset(path.join(__dirname, "docker"));

        const taskExecutionRole = new iam.Role(this, `${prefix}SimulationTaskRole`, {
            assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"), // Required for ECS tasks
        });

        // Create the IAM Policy for Bedrock
        const sitewisePolicy = new iam.PolicyStatement({
            actions: ["iotsitewise:BatchPutAssetPropertyValue"],
            resources: ["*"],
        });

        taskExecutionRole.addToPolicy(sitewisePolicy);

        // Task definition for running Chainlit container
        const taskDefinition = new ecs.FargateTaskDefinition(
            this,
            `${prefix}SimulationTaskDefinition`,
            {
                taskRole: taskExecutionRole,
            }
        );

        const container = taskDefinition.addContainer(`${prefix}SimulationApp`, {
            image,
            memoryLimitMiB: 512,
            logging: new ecs.AwsLogDriver({ streamPrefix: "SimulationApp" }),
        });

        // Create an ECS Fargate service
        const service = new ecs.FargateService(this, `${prefix}SimulationService`, {
            cluster,
            taskDefinition,
        });
    }
}
