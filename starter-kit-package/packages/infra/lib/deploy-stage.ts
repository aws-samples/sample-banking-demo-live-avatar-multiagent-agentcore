import { Aspects, Stage } from "aws-cdk-lib";
import { CDKProps } from "../config/AppConfig";
import { Construct } from "constructs";
import { InfraStack } from "./infra-stack";
import { AwsSolutionsChecks, } from "cdk-nag";

export class DeployStage extends Stage {
    constructor(scope: Construct, id: string, props: CDKProps) {
        super(scope, id, props);

        new InfraStack(this, "infra", props)
        // Add CDK Nag for infra security
        Aspects.of(this).add(new AwsSolutionsChecks());

    }
}