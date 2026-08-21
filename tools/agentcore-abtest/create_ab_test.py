#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Out-of-band provisioner for a demo Amazon Bedrock AgentCore A/B test.

WHY THIS IS A SCRIPT AND NOT CDK
--------------------------------
AgentCore A/B tests have no CloudFormation/CDK resource — they are a
control-plane API only (`bedrock-agentcore` data-plane client:
CreateABTest / CreateConfigurationBundle). We deliberately keep this OUT of
`cdk deploy` so it does not re-introduce the standalone AI-Assistant online
evaluation config we removed (that one scored live sessions asynchronously,
10-15 min, which we do not demo). This script pre-creates ONE real A/B test so
the AgentCore console (Optimizations -> A/B Tests) is not empty during the
walkthrough. The test is created in a NOT_STARTED / paused state — it does not
route traffic, run evaluation, or incur evaluation cost until someone starts it.

WHAT IT CREATES (idempotent by name — re-running skips existing pieces)
  1. Two configuration bundles (Control + Challenger), each an override of the
     AI Assistant runtime's system prompt. This is the "champion vs challenger
     configuration" the managed A/B compares.
  2. A paused online evaluation config that reuses the EXISTING custom
     evaluator (gartner_appdev_2026_copy_quality) as the judge. enableOnCreate
     is False, so it does not score live traffic on its own.
  3. The A/B test itself: gateway-level, two 50/50 variants pointing at the two
     bundles, judged by the online-eval config. enableOnCreate is omitted, so it
     lands NOT_STARTED.

Run with valid creds:  AWS_PROFILE=<profile> python3 create_ab_test.py
Delete everything:     AWS_PROFILE=<profile> python3 create_ab_test.py --delete
"""

import argparse
import os
import sys
import uuid

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "us-east-1")

# Resolved from the deployed demo (stackName = gartner-appdev-2026).
GATEWAY_ARN = os.environ.get(
    "AB_GATEWAY_ARN",
    "arn:aws:bedrock-agentcore:us-east-1:157000088284:gateway/gartner-appdev-2026-gateway-q1ficmge4n",
)
RUNTIME_ARN = os.environ.get(
    "AB_RUNTIME_ARN",
    "arn:aws:bedrock-agentcore:us-east-1:157000088284:runtime/gartner_appdev_2026_ai_assistant-l6xBJt8I2T",
)
EVAL_ROLE_ARN = os.environ.get(
    "AB_EVAL_ROLE_ARN",
    "arn:aws:iam::157000088284:role/gartner-appdev-2026-eval-exec-role",
)
EVALUATOR_ID = os.environ.get("AB_EVALUATOR_ID", "gartner_appdev_2026_copy_quality-Tks5XvFAUg")
SERVICE_NAME = os.environ.get("AB_SERVICE_NAME", "gartner_appdev_2026_ai_assistant.DEFAULT")
SPANS_LOG_GROUP = os.environ.get("AB_SPANS_LOG_GROUP", "aws/spans")

AB_TEST_NAME = "gartner_appdev_2026_catalog_copy_ab"
ONLINE_EVAL_NAME = "gartner_appdev_2026_abtest_online_eval"
CONTROL_BUNDLE_NAME = "gartner_appdev_2026_catalog_control"
CHALLENGER_BUNDLE_NAME = "gartner_appdev_2026_catalog_challenger"

# The two configurations under test: same task, different copy guidance. These
# are the "champion" (current) vs "challenger" (candidate) system prompts.
CONTROL_PROMPT = (
    "You are the AI Assistant for a private bank. Write services-catalog copy that is "
    "clear, benefit-led, on-brand, and length-disciplined."
)
CHALLENGER_PROMPT = (
    "You are the AI Assistant for a private bank. Write services-catalog copy that leads "
    "with the client benefit in one sentence (15-30 words), plain sentence case, no hype or "
    "unverifiable superlatives, and keep every entry the same tight length."
)


EVAL_ROLE_NAME = EVAL_ROLE_ARN.rsplit("/", 1)[-1]
# The A/B test service ASSUMES the passed roleArn and calls GetGateway /
# GetConfigurationBundle / GetOnlineEvaluationConfig to validate the request.
# The eval exec role does not carry those reads by default, so we attach a
# small inline policy. (Not in CDK because the whole A/B test is out-of-band;
# fold this into agentcore-role/eval-exec-role if you want it permanent in IaC.)
ROLE_POLICY_NAME = "abtest-validation-reads"
ROLE_POLICY_ACTIONS = [
    "bedrock-agentcore:GetGateway",
    "bedrock-agentcore:ListGatewayTargets",
    "bedrock-agentcore:GetConfigurationBundle",
    "bedrock-agentcore:GetConfigurationBundleVersion",
    "bedrock-agentcore:ListConfigurationBundleVersions",
    "bedrock-agentcore:GetOnlineEvaluationConfig",
]


def _ensure_role_policy():
    import json

    iam = boto3.client("iam")
    iam.put_role_policy(
        RoleName=EVAL_ROLE_NAME,
        PolicyName=ROLE_POLICY_NAME,
        PolicyDocument=json.dumps(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {"Sid": "ABTestValidationReads", "Effect": "Allow", "Action": ROLE_POLICY_ACTIONS, "Resource": "*"}
                ],
            }
        ),
    )
    print(f"[AB] ensured inline policy {ROLE_POLICY_NAME} on {EVAL_ROLE_NAME}")


def control():
    return boto3.client("bedrock-agentcore-control", region_name=REGION)


def data():
    return boto3.client("bedrock-agentcore", region_name=REGION)


def _find_ab_test(d, name):
    try:
        for t in d.list_ab_tests().get("abTests", d.list_ab_tests().get("items", [])):
            if t.get("name") == name:
                return t.get("abTestId") or t.get("abTestArn")
    except Exception as exc:  # noqa: BLE001
        print(f"[AB] list_ab_tests failed: {exc}")
    return None


def _find_online(c, name):
    try:
        for o in c.list_online_evaluation_configs().get("onlineEvaluationConfigs", []):
            if o.get("onlineEvaluationConfigName") == name:
                return o.get("onlineEvaluationConfigArn"), o.get("onlineEvaluationConfigId")
    except Exception as exc:  # noqa: BLE001
        print(f"[AB] list_online_evaluation_configs failed: {exc}")
    return None, None


def _find_bundle(c, name):
    """Return (bundleArn, latestVersionId) for an existing bundle, or (None, None)."""
    for b in c.list_configuration_bundles().get("bundles", []):
        if b.get("bundleName") == name:
            vers = c.list_configuration_bundle_versions(bundleId=b["bundleId"]).get("versions", [])
            if vers:
                latest = max(vers, key=lambda v: v.get("versionCreatedAt", ""))
                return latest["bundleArn"], latest["versionId"]
            return b.get("bundleArn"), None
    return None, None


def _create_bundle(c, name, prompt):
    existing_arn, existing_ver = _find_bundle(c, name)
    if existing_arn and existing_ver:
        print(f"[AB] bundle {name} exists: arn={existing_arn} ver={existing_ver}")
        return existing_arn, existing_ver
    r = c.create_configuration_bundle(
        bundleName=name,
        description="Demo A/B configuration bundle (catalog copy quality).",
        components={RUNTIME_ARN: {"configuration": {"system_prompt": prompt}}},
        commitMessage="Initial demo version",
        clientToken=str(uuid.uuid4()),
    )
    print(f"[AB] bundle {name}: arn={r['bundleArn']} ver={r['versionId']}")
    return r["bundleArn"], r["versionId"]


def _create_online(c, name):
    arn, _ = _find_online(c, name)
    if arn:
        print(f"[AB] online-eval exists: {arn}")
        return arn
    r = c.create_online_evaluation_config(
        onlineEvaluationConfigName=name,
        description="Paused judge for the demo A/B test — reuses the custom copy-quality evaluator.",
        rule={
            "samplingConfig": {"samplingPercentage": 100.0},
            "sessionConfig": {"sessionTimeoutMinutes": 5},
        },
        dataSourceConfig={"cloudWatchLogs": {"logGroupNames": [SPANS_LOG_GROUP], "serviceNames": [SERVICE_NAME]}},
        evaluators=[{"evaluatorId": EVALUATOR_ID}],
        evaluationExecutionRoleArn=EVAL_ROLE_ARN,
        enableOnCreate=False,  # do NOT score live traffic; A/B test only
        clientToken=str(uuid.uuid4()),
    )
    arn = r["onlineEvaluationConfigArn"]
    print(f"[AB] created online-eval: {arn}")
    return arn


def provision():
    c, d = control(), data()
    if _find_ab_test(d, AB_TEST_NAME):
        print(f"[AB] A/B test '{AB_TEST_NAME}' already exists — nothing to do.")
        return
    _ensure_role_policy()
    control_arn, control_ver = _create_bundle(c, CONTROL_BUNDLE_NAME, CONTROL_PROMPT)
    chall_arn, chall_ver = _create_bundle(c, CHALLENGER_BUNDLE_NAME, CHALLENGER_PROMPT)
    online_arn = _create_online(c, ONLINE_EVAL_NAME)
    r = d.create_ab_test(
        name=AB_TEST_NAME,
        description="Champion vs challenger catalog-copy configuration, judged by the custom copy-quality evaluator.",
        gatewayArn=GATEWAY_ARN,
        # Variant names are constrained by the API to the pattern (C|T1):
        # C = control/champion, T1 = treatment/challenger.
        variants=[
            {
                "name": "C",
                "weight": 50,
                "variantConfiguration": {
                    "configurationBundle": {"bundleArn": control_arn, "bundleVersion": control_ver}
                },
            },
            {
                "name": "T1",
                "weight": 50,
                "variantConfiguration": {"configurationBundle": {"bundleArn": chall_arn, "bundleVersion": chall_ver}},
            },
        ],
        evaluationConfig={"onlineEvaluationConfigArn": online_arn},
        roleArn=EVAL_ROLE_ARN,
        clientToken=str(uuid.uuid4()),
        # enableOnCreate omitted -> lands NOT_STARTED (no traffic, no eval cost).
    )
    print(f"[AB] created A/B test: id={r['abTestId']} status={r['status']} exec={r['executionStatus']}")


def teardown():
    c, d = control(), data()
    ab_id = _find_ab_test(d, AB_TEST_NAME)
    if ab_id:
        try:
            d.delete_ab_test(abTestId=ab_id)
            print(f"[AB] deleted A/B test {ab_id}")
        except ClientError as exc:
            print(f"[AB] delete A/B test failed: {exc}")
    arn, oid = _find_online(c, ONLINE_EVAL_NAME)
    if oid:
        try:
            c.delete_online_evaluation_config(onlineEvaluationConfigId=oid)
            print(f"[AB] deleted online-eval {oid}")
        except ClientError as exc:
            print(f"[AB] delete online-eval failed: {exc}")
    for name in (CONTROL_BUNDLE_NAME, CHALLENGER_BUNDLE_NAME):
        try:
            for b in c.list_configuration_bundles().get("bundles", []):
                if b.get("bundleName") == name:
                    c.delete_configuration_bundle(bundleId=b.get("bundleId"))
                    print(f"[AB] deleted bundle {name}")
        except ClientError as exc:
            print(f"[AB] delete bundle {name} failed: {exc}")
    try:
        boto3.client("iam").delete_role_policy(RoleName=EVAL_ROLE_NAME, PolicyName=ROLE_POLICY_NAME)
        print(f"[AB] removed inline policy {ROLE_POLICY_NAME}")
    except ClientError as exc:
        print(f"[AB] remove inline policy failed (ignored): {exc}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--delete", action="store_true", help="Tear down the A/B test and its resources.")
    args = ap.parse_args()
    try:
        teardown() if args.delete else provision()
    except ClientError as exc:
        print(f"[AB] ERROR: {exc}")
        sys.exit(1)
