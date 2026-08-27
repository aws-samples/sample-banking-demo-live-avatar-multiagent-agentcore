import { App, Tags } from "aws-cdk-lib";
import { PROPERTY_INJECTORS } from "../lib/common/blueprints";
import { ApplicationStage } from "../lib/stage";

const app = new App({
    propertyInjectors: PROPERTY_INJECTORS,
});

const projectId = app.node.tryGetContext("projectId");
if (projectId) Tags.of(app).add("projectId", projectId);

const stage = app.node.tryGetContext("stage");
const account = app.node.tryGetContext("accounts")?.[stage];
// Fall back to the deploying credentials' default account/region when cdk.json
// leaves them null. This lets a customer run `cdk deploy` with their own AWS
// profile and no config edits. Nova Sonic requires us-east-1, so that is the
// default region when nothing else is set.
const properties = {
    env: {
        account: account?.id ?? process.env.CDK_DEFAULT_ACCOUNT,
        region: account?.region ?? process.env.CDK_DEFAULT_REGION ?? "us-east-1",
    },
};

new ApplicationStage(app, stage || "dev", properties);

app.synth();
