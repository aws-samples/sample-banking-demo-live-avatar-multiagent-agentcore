// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Task 10.2 — IAM grant presence assertion (NOT a property test).
 *
 * A CDK assertion (aws-cdk-lib/assertions `Template`) that the shared
 * AgentCore_Role policy INCLUDES `bedrock:OptimizePrompt` when the
 * `prompt_optimization` feature flag is on, and OMITS it when the flag is off.
 * This pins the least-privilege behavior of `createAgentCoreRole`: the action
 * rides on the existing broad Bedrock statement only when the showcase is
 * enabled, so a stack built without the feature never holds the permission.
 *
 * Validates: Requirements 11.1, 11.3
 */

import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { createAgentCoreRole } from "../../lib/stacks/backend/agentcore-role";

const OPTIMIZE_ACTION = "bedrock:OptimizePrompt";

// Placeholder ARNs — the IAM statements under test key off the feature flag,
// not these resource values, so synthetic ARNs are sufficient to synthesize.
const baseProps = {
    sessionsTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/sessions",
    customersTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/customers",
    metadataTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/metadata",
    reportsBucketArn: "arn:aws:s3:::reports-bucket",
    imagesBucketArn: "arn:aws:s3:::images-bucket",
    avatarBucketArn: "arn:aws:s3:::avatar-bucket",
    machineClientSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:machine-abc",
};

/** Synthesize a stack containing only the AgentCore role, with the flag on/off. */
function roleTemplate(enablePromptOptimization: boolean): Template {
    const app = new App();
    const stack = new Stack(app, "AgentCoreRoleTestStack");
    createAgentCoreRole(stack, "test-stack", { ...baseProps, enablePromptOptimization });
    return Template.fromStack(stack);
}

describe("createAgentCoreRole — bedrock:OptimizePrompt grant is flag-gated (Req 11.1, 11.3)", () => {
    it("INCLUDES bedrock:OptimizePrompt when the prompt_optimization flag is on", () => {
        const template = roleTemplate(true);

        // The action lives on an IAM policy statement whose Action array also
        // carries the other Bedrock invocation actions (the shared statement).
        template.hasResourceProperties("AWS::IAM::Policy", {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Effect: "Allow",
                        Action: Match.arrayWith([OPTIMIZE_ACTION]),
                    }),
                ]),
            },
        });

        // Sanity: the action really is present somewhere in the synthesized template.
        expect(JSON.stringify(template.toJSON())).toContain(OPTIMIZE_ACTION);
    });

    it("OMITS bedrock:OptimizePrompt when the prompt_optimization flag is off", () => {
        const template = roleTemplate(false);
        expect(JSON.stringify(template.toJSON())).not.toContain(OPTIMIZE_ACTION);
    });

    it("OMITS bedrock:OptimizePrompt when the flag is left undefined (defaults off)", () => {
        const app = new App();
        const stack = new Stack(app, "AgentCoreRoleDefaultStack");
        createAgentCoreRole(stack, "test-stack", baseProps);
        const template = Template.fromStack(stack);
        expect(JSON.stringify(template.toJSON())).not.toContain(OPTIMIZE_ACTION);
    });

    it("still grants the core Bedrock invocation actions in both flag states", () => {
        for (const enabled of [true, false]) {
            const json = JSON.stringify(roleTemplate(enabled).toJSON());
            // The feature only ADDS an action; it never removes the base grant.
            expect(json).toContain("bedrock:InvokeModel");
            expect(json).toContain("bedrock:ApplyGuardrail");
        }
    });
});
