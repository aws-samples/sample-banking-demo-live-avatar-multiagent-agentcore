# Generative Architecture Toolkit

## 0. CANONICAL PATH: `arch_diagram.py` (deterministic, offline)

**The current architecture diagram is produced by `arch_diagram.py`, not by
the Claude pipeline described below.** It renders the same architecture
deterministically with zero Bedrock calls:

```bash
cd tools/generative-architecture
../../.venv/bin/python arch_diagram.py      # PNG + SVG + DOT
../../.venv/bin/python dot_to_drawio.py     # editable draw.io XML
```

Outputs:

| File                                       | What it is                                  |
| ------------------------------------------ | ------------------------------------------- |
| `architecture.drawio.png` (repo root)      | The diagram (landscape, ~2.1:1)             |
| `architecture.drawio` (repo root)          | Editable draw.io XML, icons base64-embedded |
| `architecture.drawio.svg` / `.dot`         | Vector + Graphviz source                    |
| `docs/architecture.png`                    | Copy for documentation                      |
| `docs/architecture.drawio.xml`             | Copy of the editable XML                    |

Why it replaced the LLM path:

- **Readability.** The generated spec had 58 nodes / 67 edges — an
  unreadable edge mesh. `arch_diagram.py` consolidates sibling resources
  into 26 nodes / 28 edges without losing meaning (collapsed detail is
  named in each node's sub-label).
- **Hub-and-spoke, not mesh.** The MCP Gateway is the single hub for tool
  traffic and the Runtime the single hub for model traffic, so there are
  no N×M crossing lines.
- **Cost + reproducibility.** No Bedrock call, so layout iteration is
  free and byte-identical between runs.
- **Latest icons.** AgentCore primitives use the Jan 2026 AWS icon pack
  in `icons/`; AWS services use first-party `diagrams.aws` classes,
  including the native `Bedrock` icon (previously a SageMaker stand-in).

Layout note: `arch_diagram.py` uses `style="invis"` edges purely to pin
Graphviz ranks (they draw nothing). Without them the canvas comes out
portrait. `dot_to_drawio.py` filters them so they never become phantom
connectors in the XML.

The Claude-in-the-loop pipeline below is retained for reference and for
the legacy `--target agentcore-2026` spec.

---

## 1. Legacy: Claude-in-the-loop generator

A Claude-in-the-loop architecture-diagram generator for the research-agent
repo. Reads `cdk.json` + `lib/common/feature-flags.ts` to build a layout
spec (clusters / nodes / edges), asks Claude to emit `diagrams` Python
code, executes it, and copies the rendered PNG to
`architecture.drawio.png` at the repo root.

## 1. Purpose

Keep the architecture diagram in lockstep with the code. Every time a new
feature flag lands, a Lambda is added, or a construct is renamed, a
single command (`npm run diagram`) regenerates the PNG — no manual
diagramming, no stale references.

The toolkit is declarative: `research_agent_config.py` encodes the
intended layout, and Claude is used strictly to handle the low-level
`diagrams` library calls (imports, nesting, orthogonal edges, label
formatting). Claude never invents components — it only renders the spec
we give it.

## 2. The Modern AgentCore-First Design (May 2026)

1. **AgentCore at the center, not in a row.** Orchestrator Runtime,
   Gateway, Memory, Browser microVM, Code Interpreter, and Guardrails
   form a visual gravitational core — one large rounded cluster with
   inner sub-clusters, not a horizontal pipeline stage between "Auth"
   and "AI Models".
2. **Swim lanes, not a single row.** Three visual bands:
    - **User Journey** (top): User → CloudFront/WAF → Frontend →
      Cognito → REST API
    - **AgentCore Core** (middle): the two Runtimes, Gateway, Memory,
      Guardrails, Browser, Code Interpreter, in-process sub-agents
    - **Data & Model Plane** (bottom): DynamoDB, S3, Knowledge Base
      (S3 Vectors), Neptune (optional), Bedrock foundation models
3. **Orchestrator Runtime is a nested cluster.** Inside the AgentCore
   band, it contains Planner / Researcher / Synthesizer / PDF Writer /
   Menu Designer / Chatbot sub-agents + in-process Browser tool group,
   all styled as `Custom:icons/AI_Agent.png`.
4. **17 Gateway tools render as 5 logical Lambda groups** plus
   `kb_ingest` on its own S3-triggered edge path, and both
   `sample_tool` and `research_orchestrator` as ghost/dashed
   feature-flagged nodes.
5. **Edge styling encodes semantics.** Solid = hot path;
   dashed = conditional; bold penwidth=2 for primary invocation paths;
   colored by source-cluster theme.
6. **Icons: custom AgentCore pack first, stock `diagrams.aws` fallback.**
   Runtimes use `Runtime.png`, Gateway uses `Gateway.png`, sub-agents use
   `AI_Agent.png`, etc.
7. **Color palette.** AgentCore teal (#01A88D), User Journey indigo
   (#3B82F6), Auth amber (#F59E0B), Tool Lambdas pink (#EC4899),
   Foundation models purple (#8B5CF6), Data plane orange (#F97316),
   Ghost grey (#9CA3AF).

## 3. Runbook / Quickstart

**Prereqs**:

- Graphviz CLI: `brew install graphviz`
- AWS credentials with Bedrock access to
  `us.anthropic.claude-sonnet-4-5-20250929-v1:0` in `us-east-1`
- `npm install` at the repo root — this provisions the uv `.venv` and
  installs the 3 toolkit Python deps (boto3, diagrams, graphviz)

**Commands** (run from the repo root):

```bash
npm run diagram                       # stage=dev, live Bedrock call
npm run diagram -- --stage prod       # different stage resolution
npm run diagram -- --dry-run          # prints the spec, no Bedrock
npm run diagram -- --target agentcore-2026   # legacy sibling-repo spec
```

**Where the PNG lands**:

- Repo root: `architecture.drawio.png` (always overwritten)
- Snapshot: `tools/generative-architecture/outputs/{timestamp}_research_agent_architecture.png`

## 4. Flag-to-Element Mapping

When a feature flag is OFF, the corresponding cluster / node / edge is
**omitted** from the diagram (not greyed out). Exception:
`research_orchestrator` always renders as a dashed ghost when the
`durable_functions` flag is on.

| Flag                     | Default      | When OFF, the spec omits                                                                              |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| `avatar`                 | true         | Avatar Runtime cluster + all `v_*` nodes + edges to `fm_sonic`, `fm_novalite`, `m_agentcore_memory`   |
| `knowledge_base`         | true         | Knowledge Base cluster + `api_kb_reset_lambda` + `g_knowsearch_lambda` → `kb_kb` edges                |
| `kb_backend`             | `s3-vectors` | (only the `s3-vectors` variant is rendered; `opensearch` variant is TODO)                             |
| `neptune`                | false        | `n_neptune_graph` — rendered only when true; otherwise omitted entirely                               |
| `episodic_memory`        | true         | Memory strategy sub-label; entire Memory cluster only rendered if any memory flag is on               |
| `semantic_memory`        | true         | (same as above)                                                                                       |
| `user_preference_memory` | true         | (same as above)                                                                                       |
| `durable_functions`      | false        | `g_durable_lambda` ghost node + its dashed callback edge                                              |
| `guardrails`             | true         | Guardrails cluster + `r_chatbot → gr_guardrail_policy` edge                                           |
| `browser`                | true         | Browser Tools (in-process) inner cluster + `br_agentcore_browser` + DCV edge + chatbot → browser edge |

## 5. Validation Without Bedrock

All iteration should happen via the offline inspectors to avoid burning
Bedrock tokens. Everything below exits zero and prints useful output:

```bash
# From tools/generative-architecture/
python cdk_inspector.py --stage dev --format table
python icon_manifest.py --list
python research_agent_config.py --stage dev

# Or via the npm shim
npm run diagram -- --dry-run
```

Expected output:

- `cdk_inspector.py` prints all 13 feature flags (not 10) — including
  `semantic_memory`, `user_preference_memory`, `browser`
- `icon_manifest.py --list` resolves 27 logical names with 11 custom
  icons under `icons/`
- `research_agent_config.py` prints a spec whose `clusters` string
  contains multiple `parent=...` attributes, reflecting the nested
  AgentCore → Orchestrator Runtime → Multi-Agent Pipeline structure

## 6. How to Evolve the Spec

When a new CDK construct lands (new Lambda, new runtime, new feature
flag):

1. Edit the `DEFAULT_FEATURES` dict in `cdk_inspector.py` to mirror
   `lib/common/feature-flags.ts` exactly. Update `FeatureFlags`
   dataclass fields if you added a new flag.
2. Edit `research_agent_config.py`:
    - Add an alias constant at the top (follow the prefix convention:
      `u_`, `a_`, `r_`, `v_`, `g_`, `fm_`, `kb_`, `d_`, etc.)
    - Add an `_mk_node(...)` line in `_build_nodes()` — feature-gate
      with a flag check if needed
    - Add the cluster member in `_build_clusters()`
    - Add any `_mk_edge(...)` calls in `_build_edges()`
    - Update the `LABELS` dict inside `_build_extra_prompt()`
3. Update the flag-to-element mapping table in section 4 above.
4. Iterate with `npm run diagram -- --dry-run` first. Only call the
   live `npm run diagram` once the spec looks right.

## 7. Legacy Target

The toolkit still supports the original sibling-repo diagram:

```bash
npm run diagram -- --target agentcore-2026
```

This uses `specs/agentcore_2026.py` (unchanged) and writes its PNG
inside `tools/generative-architecture/` — it does NOT copy to the repo
root.
