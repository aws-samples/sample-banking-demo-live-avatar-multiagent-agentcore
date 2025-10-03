import { App, Tags } from "aws-cdk-lib";
// @export {"deleteLines": 1}
import { getPropertyInjectors } from "../lib/common/blueprints";
import { Pipeline } from "../lib/stacks/pipeline";
import { ApplicationStage } from "../lib/stage";

const app = new App({
    propertyInjectors: getPropertyInjectors(),
});

const projectId = app.node.tryGetContext("projectId");
if (projectId) Tags.of(app).add("projectId", projectId);

const stage = app.node.tryGetContext("stage") || "dev";
const account = app.node.tryGetContext("accounts")?.[stage];
const properties = {
    env: {
        account: account?.number,
        region: account?.region,
    },
};

// @export {"deleteLines": 4}
if (app.node.tryGetContext("pipeline") && stage === "dev") {
    // this stack must be named pipeline
    new Pipeline(app, "pipeline", properties);
} else {
    new ApplicationStage(app, stage, properties);
    // @export {"deleteLines": 1}
}
app.synth();
