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
const properties = {
    env: {
        account: account?.id,
        region: account?.region,
    },
};

new ApplicationStage(app, stage || "dev", properties);

app.synth();
