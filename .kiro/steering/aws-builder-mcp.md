# AWS Builder MCP Usage

For every run, whenever the work touches an AWS service or feature — availability,
API/SDK/CLI shape, IaC/CloudFormation/CDK support, quotas, best practices, or
"is this GA / does this exist yet" questions — consult the **AWS Builder MCP
server** before answering or writing code. Do not rely on memory or public docs
alone for AWS specifics.

## What to use

- `InternalSearch` — confirm feature availability, GA status, launch details, and
  internal guidance (wikis, broadcasts, APG library). Prefer this for
  "does X exist / is X supported yet" questions.
- `InternalCodeSearch` — verify exact API/SDK/CLI/construct signatures against
  real source. Never invent method names or request shapes.
- `ReadInternalWebsites` — read specific internal pages (wikis, code.amazon.com,
  APG patterns) surfaced by the searches.

## How to apply

- **Verify before baking in.** Empirically confirm AgentCore/Bedrock (and other
  AWS) API shapes before committing code — cross-check with a boto3 probe in a
  venv when a control-plane call is involved.
- **Beware case-sensitive substring filters** when scanning API names
  (e.g. `ABTest` vs `abtest`).
- **Be honest / no overclaiming.** If the MCP search does not confirm a feature,
  say so plainly rather than assuming it works.
- Cite the internal source (URL) when the answer depends on it.
