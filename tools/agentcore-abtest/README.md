# AgentCore A/B Test (demo prop)

Pre-creates one real Amazon Bedrock AgentCore **A/B test** so the console
(AgentCore → Optimizations → **A/B Tests**) is not empty during the demo.

## Why this is a script, not CDK

AgentCore A/B tests have **no CloudFormation/CDK resource** — they are a
control-plane API only (`bedrock-agentcore`: `CreateABTest`,
`CreateConfigurationBundle`). Keeping this out of `cdk deploy` avoids
re-introducing the standalone AI-Assistant online-evaluation config we removed
(that one scored live sessions asynchronously, 10–15 min, which we don't demo).

## What it creates

- Two **configuration bundles** (Control + Challenger) — overrides of the AI
  Assistant runtime's system prompt. This is the champion-vs-challenger
  _configuration_ the managed A/B compares.
- A **paused online-evaluation config** that reuses the existing custom
  evaluator (`gartner_appdev_2026_copy_quality`) as the judge
  (`enableOnCreate=false`, so it does not score live traffic on its own).
- The **A/B test**: gateway-level, two 50/50 variants (`C`, `T1`) pointing at the
  two bundles, judged by the online-eval config. Created **NOT_STARTED** — it
  does not route traffic, run evaluation, or incur evaluation cost until started.
- A small inline IAM policy on the eval-exec role (`abtest-validation-reads`) —
  the A/B test service assumes that role and calls `GetGateway` /
  `GetConfigurationBundle` / `GetOnlineEvaluationConfig` to validate the request.

Names, ARNs, and IDs are resolved for the deployed demo (stack
`gartner-appdev-2026`) and overridable via `AB_*` env vars — see the script header.

## Usage

```bash
# Create (idempotent — re-running skips an existing test)
AWS_PROFILE=<profile> AWS_REGION=us-east-1 python3 create_ab_test.py

# Tear down (test, online-eval, bundles, inline policy)
AWS_PROFILE=<profile> AWS_REGION=us-east-1 python3 create_ab_test.py --delete
```

Because the A/B test is not a CFN resource, it survives `cdk deploy` but is **not
recreated** by a from-scratch redeploy — re-run this script after recreating the
stack. If you want it permanent in IaC, move the inline policy into
`lib/stacks/backend/agentcore-role.ts` (eval-exec role) and drive the API calls
from a CDK custom resource.
