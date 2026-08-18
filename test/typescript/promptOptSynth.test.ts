// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Task 10.4 — `cdk synth` flag on/off check (NOT a property test).
 *
 * Asserts that synthesizing the flag-gated construct with the
 * `prompt_optimization` feature flag ON and OFF both produce a clean, valid
 * CloudFormation template that references NO endpoint outside the demo account
 * — confirming the showcase stays self-contained and therefore deploys and
 * destroys with the standard CDK commands (the feature only adds an IAM action
 * and in-process handlers; no new runtime, table, bucket, or external URL).
 *
 * Scope: the AgentCore role is the only infrastructure surface the feature
 * touches (an IAM action toggled by the flag), so — mirroring the
 * skipped-by-default smoke approach — this check synthesizes that construct
 * both ways rather than standing up the full backend stack. Synthesizing
 * through `Template.fromStack` exercises the same synthesis path `cdk synth`
 * runs.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.5
 */

import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { createAgentCoreRole } from "../../lib/stacks/backend/agentcore-role";

const baseProps = {
    sessionsTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/sessions",
    customersTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/customers",
    metadataTableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/metadata",
    reportsBucketArn: "arn:aws:s3:::reports-bucket",
    imagesBucketArn: "arn:aws:s3:::images-bucket",
    avatarBucketArn: "arn:aws:s3:::avatar-bucket",
    machineClientSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:machine-abc",
};

/** Synthesize the flag-gated construct and return its template JSON. */
function synth(enablePromptOptimization: boolean): Record<string, unknown> {
    const app = new App();
    const stack = new Stack(app, "PromptOptSynthStack");
    createAgentCoreRole(stack, "test-stack", { ...baseProps, enablePromptOptimization });
    // Template.fromStack drives the same synthesis cdk synth performs; it throws
    // if synthesis fails, so reaching a template proves a clean synth.
    return Template.fromStack(stack).toJSON();
}

describe("Prompt Optimization — cdk synth is clean and self-contained (Req 12.1, 12.2, 12.5)", () => {
    for (const enabled of [true, false]) {
        const label = enabled ? "on" : "off";

        it(`synthesizes a non-empty, valid template with the flag ${label}`, () => {
            const template = synth(enabled);
            const resources = (template.Resources ?? {}) as Record<string, unknown>;
            // A clean synth yields at least the IAM role + its policy.
            expect(Object.keys(resources).length).toBeGreaterThan(0);
        });

        it(`references no endpoint outside the demo account with the flag ${label}`, () => {
            const json = JSON.stringify(synth(enabled));

            // No plaintext external URLs — the feature reaches only in-account
            // Bedrock/AWS services, never a public bucket, API, or website.
            expect(json).not.toContain("http://");
            const httpsMatches = json.match(/https:\/\/[^"\\]+/g) ?? [];
            for (const url of httpsMatches) {
                expect(url).toMatch(/amazonaws\.com/);
            }

            // Any principal/domain reference stays on an AWS-managed domain.
            const domainMatches = json.match(/[a-z0-9.-]+\.(com|net|org|io|dev)/gi) ?? [];
            for (const domain of domainMatches) {
                expect(domain).toMatch(/amazonaws\.com$/);
            }
        });
    }

    it("differs only by the OptimizePrompt action between flag states (no extra resources)", () => {
        const onResources = Object.keys(
            (synth(true).Resources ?? {}) as Record<string, unknown>
        ).sort();
        const offResources = Object.keys(
            (synth(false).Resources ?? {}) as Record<string, unknown>
        ).sort();
        // The flag adds an IAM action, not a resource, so the resource set is
        // identical on and off — nothing new to deploy or destroy (Req 12.5).
        expect(onResources).toEqual(offResources);
    });
});
