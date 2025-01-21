import { Stack, Duration, aws_wafv2, CfnOutput } from "aws-cdk-lib";
import { CDKProps, lambdaArchitecture, lambdaRuntime } from "../config/AppConfig";
import { IUserPool } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { Function } from "aws-cdk-lib/aws-lambda";
import { PythonFunction, PythonLayerVersion } from "@aws-cdk/aws-lambda-python-alpha";
import { AmplifyGraphqlApi, AmplifyGraphqlDefinition } from "@aws-amplify/graphql-api-construct";
import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from "cdk-nag";
import * as path from "path";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";


interface GraphQlApiStackProps extends CDKProps {
    userPool: IUserPool;
    regionalWebAclArn: string;
    distributionDomainName: string;
    vpc: Vpc;
    defaultSecurityGroup: SecurityGroup;
}

export class GraphQlApiStack extends Stack {
    public readonly resolverLambda: Function;
    public readonly appSyncAPI: AmplifyGraphqlApi
    constructor(scope: Construct, id: string, props: GraphQlApiStackProps) {
        super(scope, id, props);

        const commonLayer = new PythonLayerVersion(this, `${props.projectName}-common-layer`, {
            layerVersionName: `${props.projectName}-common-layer`,
            entry: path.join(__dirname, "..", "lambda", "python", "layers", "common"),
            compatibleArchitectures: [lambdaArchitecture],
            compatibleRuntimes: [lambdaRuntime],
            // this will skip docker builds; removing bundling commands will require docker/finch CLI to compile
            // bundling: {
            // to support docker in docker
            // note the export folder as /asset-output/python/common that matches the folder name where the layer code resides
            //     bundlingFileAccess: BundlingFileAccess.VOLUME_COPY,
            //     image: lambdaBundlerImage,
            //     command: [
            //         "bash",
            //         "-c",
            //         "pip install -r requirements.txt -t /asset-output/python && cp -au . /asset-output/python/common",
            //     ],
            // }
        });

        this.resolverLambda = new PythonFunction(this, `${props.projectName}-resolver-function`, {
            functionName: `${props.projectName}-resolver-function`,
            entry: path.join(__dirname, "..", "lambda", "python", "resolver-lambda"),
            index: "index.py",
            handler: "lambda_handler",
            runtime: lambdaRuntime,
            architecture: lambdaArchitecture,
            layers: [commonLayer],
            memorySize: 1024,
            timeout: Duration.minutes(15), // increased timeout to test Bedrock batch inference
            environment: {
                "rootFolder": props.projectName,
                "emailsBucket": `email-generator-data-bucket-${this.account}-${this.region}`,
            },
            vpc: props.vpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [props.defaultSecurityGroup],
        })

        // add bedrock invoke permissions to resolver lambda 
        this.resolverLambda.addToRolePolicy(new PolicyStatement({
            actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources: ["*"],
        }))


        this.appSyncAPI = new AmplifyGraphqlApi(this, "appsync-graphql-api", {
            definition: AmplifyGraphqlDefinition.fromFiles(path.join(__dirname, "..", "graphql", "schema.graphql")),
            authorizationModes: {
                defaultAuthorizationMode: 'AMAZON_COGNITO_USER_POOLS',
                userPoolConfig: {
                    userPool: props.userPool,
                },
                // API key to be accessed from bastion server for real time data streaming
                // apiKeyConfig: {
                //     expires: Duration.days(30),
                // }
            },
            functionNameMap: {
                "resolverLambda": this.resolverLambda,
            },
        });

        /**
         * Add the appsync API endpoint to lambda 
         */
        this.resolverLambda.addEnvironment('graphql_endpoint', this.appSyncAPI.graphqlUrl)
        this.resolverLambda.addEnvironment('lambda_role', this.resolverLambda.role?.roleArn || '')

        // Access L1 resources under `.resources.cfnResources`        
        this.appSyncAPI.resources.cfnResources.cfnGraphqlApi.xrayEnabled = true;
        Object.values(this.appSyncAPI.resources.cfnResources.cfnTables).forEach((table, index) => {
            table.pointInTimeRecoverySpecification = { pointInTimeRecoveryEnabled: true };
        });

        // logging for AppSync
        const graphqlLogWriterRole = new Role(this, 'ApiGWLogWriterRole', {
            assumedBy: new ServicePrincipal('appsync.amazonaws.com')
        })

        const policy = new PolicyStatement({
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:DescribeLogGroups',
                'logs:DescribeLogStreams',
                'logs:PutLogEvents',
                'logs:GetLogEvents',
                'logs:FilterLogEvents'
            ],
            resources: [this.appSyncAPI.resources.graphqlApi.arn]
        })

        graphqlLogWriterRole.addToPolicy(policy)


        this.appSyncAPI.resources.cfnResources.cfnGraphqlApi.logConfig = {
            fieldLogLevel: "ERROR",
            cloudWatchLogsRoleArn: graphqlLogWriterRole.roleArn,
        }

        // associate the regional WAF to Amazon AppSync 
        new aws_wafv2.CfnWebACLAssociation(this, `${props.projectName}-webacl-gql-association`, {
            resourceArn: this.appSyncAPI.resources.graphqlApi.arn,
            webAclArn: props.regionalWebAclArn,
        });

        NagSuppressions.addResourceSuppressions(
            this.appSyncAPI,
            [
                {
                    id: "AwsSolutions-IAM5",
                    reason: "GraphQL Constructs has the wild cards to accommodate future tables and configurations ",
                },
                {
                    id: "AwsSolutions-L1",
                    reason: "Deliberately setting to use latest version -1 to ensure compatibility for demos.",
                },
            ],
            true
        );

        /**
        * Output exports
        */
        new CfnOutput(this, "config-appsync-endpoint-output", {
            value: this.appSyncAPI.graphqlUrl,
            description: "Appsync API endpoint",
            exportName: `${props.projectName}-config-appsync-endpoint-output`,
        });
        new CfnOutput(this, "config-appsync-api-id-output", {
            value: this.appSyncAPI.apiId,
            description: "Appsync API API ID",
            exportName: `${props.projectName}-config-appsync-api-id-output`,
        });

    }
}