"""
Canonical architecture diagram — deterministic renderer (no Bedrock call).

Why this exists
---------------
The original toolkit asked Claude to emit `diagrams` code from a prose spec
(`research_agent_config.py` -> `gen_arch.py`). That produced a 58-node /
67-edge canvas whose edge mesh was unreadable, and every layout iteration
cost a live Bedrock call.

This module renders the same architecture deterministically and offline:

  * CONSOLIDATED NODES — sibling resources that share one role collapse into
    a single node (4 DynamoDB tables -> "DynamoDB Tables", 6 Bedrock models ->
    2 model nodes, 7 Knowledge Base parts -> 2). Fewer nodes means far fewer
    edges without losing architectural meaning; the collapsed detail is named
    in each node's sub-label.
  * HUB-AND-SPOKE, NOT MESH — the MCP Gateway is the single hub for tool
    traffic and the Runtime is the single hub for model traffic, so we never
    draw N x M crossing lines.
  * LATEST ICONS — AgentCore primitives use the Jan 2026 AWS icon pack under
    `icons/`; AWS services use the first-party `diagrams.aws` classes,
    including the native Bedrock icon (previously a SageMaker stand-in).

Outputs (alongside this file):
    research_agent_architecture.png / .svg / .dot

The `.dot` is consumed by `dot_to_drawio.py` to emit an editable
`architecture.drawio` XML. Run:

    cd tools/generative-architecture
    ../../.venv/bin/python arch_diagram.py
    ../../.venv/bin/python dot_to_drawio.py
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.general import User
from diagrams.aws.ml import Bedrock
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.security import Cognito
from diagrams.aws.storage import SimpleStorageServiceS3
from diagrams.custom import Custom

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
OUTPUT_BASENAME = "research_agent_architecture"

# --- Palette ---------------------------------------------------------------
TEAL = "#01A88D"  # AgentCore
TEAL_DEEP = "#047857"
TEAL_MID = "#B3E5D9"
TEAL_LIGHT = "#E0F2EE"
INDIGO = "#3B82F6"  # client & edge
AMBER = "#D97706"  # auth / API
PINK = "#EC4899"  # tool lambdas
PURPLE = "#8B5CF6"  # foundation models
ORANGE = "#F97316"  # data plane

GRAPH_ATTR = {
    "rankdir": "LR",
    "splines": "ortho",
    # nodesep controls same-rank spacing, which is VERTICAL under rankdir=LR —
    # keeping it tight and ranksep wide is what holds the canvas in landscape.
    "nodesep": "0.40",
    "ranksep": "1.45",
    "pad": "0.6",
    "fontname": "Helvetica",
    "fontsize": "11",
    "dpi": "200",
    "compound": "true",
}
NODE_ATTR = {"fontname": "Helvetica", "fontsize": "10"}
EDGE_ATTR = {"fontname": "Helvetica", "fontsize": "9", "penwidth": "1.6"}


def _cluster(bg: str, pen: str, width: int = 2) -> dict[str, str]:
    return {
        "bgcolor": bg,
        "pencolor": pen,
        "penwidth": str(width),
        "style": "rounded,filled",
        "fontname": "Helvetica-Bold",
        "fontsize": "12",
    }


def icon(name: str) -> str:
    """Relative path to a custom AgentCore icon.

    Deliberately relative: Graphviz line-wraps long attribute values with a
    trailing backslash, which corrupts absolute icon paths in the emitted
    `.dot` and breaks the draw.io icon embedding. `main()` chdir's here so the
    relative path always resolves.
    """
    return f"icons/{name}"


def build(show_payments: bool = False) -> None:
    """Render the diagram.

    `show_payments` mirrors the `payments` feature flag: the AgentCore Payments
    preview path and the self-hosted x402 merchant only appear when the stack
    actually deploys them, so the default diagram matches a default deploy.
    """
    title = "Trinity Reserve Bank — AI Platform on Amazon Bedrock AgentCore"

    with Diagram(
        title,
        filename=OUTPUT_BASENAME,
        outformat=["png", "svg", "dot"],
        show=False,
        direction="LR",
        graph_attr=GRAPH_ATTR,
        node_attr=NODE_ATTR,
        edge_attr=EDGE_ATTR,
    ):
        # ================================================================
        # BAND 1 — Client & Edge
        # ================================================================
        with Cluster("1 · Client & Edge", graph_attr=_cluster("#EEF2FF", INDIGO)):
            user = User("End User\n(browser)")
            edge_cdn = CloudFront("CloudFront + WAF\nTLS 1.2+ · OAC")
            spa = SimpleStorageServiceS3("Frontend SPA\nS3 · React + Vite")
            auth = Cognito("Cognito\nUser Pool · Identity Pool")

        with Cluster("2 · REST API", graph_attr=_cluster("#FEF3C7", AMBER)):
            rest = APIGateway("API Gateway\nWAF-protected · JWT")
            rest_fns = Lambda("API Lambdas\nfeedback · reports · kb-reset")

        # ================================================================
        # BAND 2 — Amazon Bedrock AgentCore (visual center)
        # ================================================================
        with Cluster("3 · Amazon Bedrock AgentCore", graph_attr=_cluster(TEAL, TEAL_DEEP, 3)):
            with Cluster("Orchestrator Runtime", graph_attr=_cluster(TEAL_MID, TEAL)):
                runtime = Custom("Orchestrator Runtime\nHTTP/SSE · mode router", icon("Runtime.png"))

                with Cluster("Deep Research Pipeline", graph_attr=_cluster(TEAL_LIGHT, TEAL, 1)):
                    planner = Custom("Planner\nrefine · sub-questions", icon("Strands_Agent.png"))
                    # The researcher fans out: the plan's sub-questions are
                    # sharded across concurrent sub-agents (MAX_RESEARCH_WORKERS)
                    # and merged back before synthesis.
                    researcher = Custom(
                        "Researcher ×4 (parallel)\nsharded sub-questions · web + images",
                        icon("Strands_Agent.png"),
                    )
                    synth = Custom("Synthesizer\nmerge · report · PDF", icon("Strands_Agent.png"))
                    evaluator = Custom("Evaluator\nscorecard", icon("Evaluations.png"))

                with Cluster("Customer Agents", graph_attr=_cluster(TEAL_LIGHT, TEAL, 1)):
                    catalog = Custom("Catalog Designer\nservices + imagery", icon("Strands_Agent.png"))
                    advisor = Custom("Client Advisor\nKYC · accounts", icon("Strands_Agent.png"))

            with Cluster("Avatar Runtime", graph_attr=_cluster(TEAL_MID, TEAL)):
                avatar = Custom("Avatar Runtime\nWebSocket · bidi voice", icon("Runtime.png"))

            with Cluster("MCP Gateway", graph_attr=_cluster(TEAL_MID, TEAL)):
                gateway = Custom("MCP Gateway\nJWT-authorized", icon("Gateway.png"))
                tools = Lambda("Tool Lambdas\n18 MCP tools · 5 groups")

            memory = Custom("AgentCore Memory\nepisodic · semantic · prefs", icon("Memory.png"))
            guardrails = Custom(
                "Guardrails + DLP\ntopic · PII · content",
                icon("Policy_Engine_Agentic_Guardrails.png"),
            )
            browser = Custom("AgentCore Browser\nmicroVM · live view", icon("Browser_Tool.png"))
            code_interp = Custom("Code Interpreter\nsandboxed exec", icon("Code_Interpreter.png"))
            payments = (
                Custom(
                    "AgentCore Payments\nx402 · session budget",
                    icon("Identity.png"),
                )
                if show_payments
                else None
            )

        # ================================================================
        # BAND 3 — Models, Knowledge, Data
        # ================================================================
        with Cluster("4 · Bedrock Foundation Models", graph_attr=_cluster("#FAF5FF", PURPLE)):
            fm_claude = Bedrock("Claude Sonnet / Opus\nConverse · reasoning")
            fm_nova = Bedrock("Amazon Nova\nSonic · Lite · Canvas · Embed")

        with Cluster("5 · Knowledge Base", graph_attr=_cluster("#FFEDD5", ORANGE)):
            kb = Bedrock("Bedrock Knowledge Base\n3 pipelines · auto-ingest")
            kb_store = SimpleStorageServiceS3("S3 Vectors + Docs\nindex · source PDFs")

        with Cluster("6 · Data Plane", graph_attr=_cluster("#FFF7ED", ORANGE)):
            ddb = Dynamodb("DynamoDB Tables\nsessions · customers · feedback")
            buckets = SimpleStorageServiceS3("S3 Buckets\nreports · images · avatar")

        # Self-hosted paywalled data source. In-stack on purpose: it is what
        # lets the payments demo run without an external API or real funds.
        merchant = None
        if show_payments:
            with Cluster("7 · Paid Data (self-hosted)", graph_attr=_cluster("#FDF2F8", PINK)):
                merchant = Lambda("x402 Merchant\nHTTP 402 · synthetic datasets")

        # ================================================================
        # EDGES — hub-and-spoke, deliberately sparse (~24 total)
        # ================================================================

        # Client journey (one straight chain)
        user >> Edge(color=INDIGO, penwidth="2.2") >> edge_cdn
        edge_cdn >> Edge(color=INDIGO, penwidth="2.2") >> spa
        spa >> Edge(color=AMBER, xlabel="OIDC") >> auth

        # SPA into the platform — two entry points only
        spa >> Edge(color=TEAL_DEEP, penwidth="2.2", xlabel="SigV4 / JWT") >> runtime
        spa >> Edge(color=TEAL_DEEP, penwidth="2.2", xlabel="WebSocket") >> avatar
        spa >> Edge(color=AMBER, xlabel="REST") >> rest
        rest >> Edge(color=AMBER) >> rest_fns

        # Runtime -> pipeline chain (reads as flow, not mesh)
        runtime >> Edge(color=TEAL) >> planner
        planner >> Edge(color=TEAL) >> researcher
        researcher >> Edge(color=TEAL) >> synth
        synth >> Edge(color=TEAL) >> evaluator

        # Runtime -> customer agents (single fan of 2)
        runtime >> Edge(color=TEAL, style="dashed") >> catalog
        runtime >> Edge(color=TEAL, style="dashed") >> advisor

        # Guardrails / browser attach to the advisor only
        advisor >> Edge(color=TEAL, style="dashed", xlabel="ApplyGuardrail") >> guardrails
        advisor >> Edge(color=TEAL, style="dashed", xlabel="CDP") >> browser

        # Gateway hub: both runtimes in, tool lambdas out
        runtime >> Edge(color=TEAL_DEEP, penwidth="2.2") >> gateway
        avatar >> Edge(color=TEAL_DEEP, penwidth="2.2") >> gateway
        gateway >> Edge(color=PINK, penwidth="2.2") >> tools
        tools >> Edge(color=TEAL, style="dashed") >> code_interp

        # Memory — single shared edge from the runtime hub
        runtime >> Edge(color=TEAL) >> memory

        # Models — one edge per consumer hub
        runtime >> Edge(color=PURPLE, penwidth="2.2", xlabel="Converse") >> fm_claude
        avatar >> Edge(color=PURPLE, penwidth="2.2", xlabel="Sonic bidi") >> fm_nova
        tools >> Edge(color=PURPLE, style="dashed", xlabel="Canvas / embed") >> fm_nova

        # Paid data path: the researcher hits the paywall, Payments settles it.
        # Only two extra lines, kept off the hot path so the diagram stays legible.
        if payments is not None and merchant is not None:
            researcher >> Edge(color=PINK, style="dashed", xlabel="HTTP 402") >> merchant
            payments >> Edge(color=PINK, style="dashed", xlabel="x402 proof") >> merchant

        # Knowledge & data — tool lambdas are the only writers/readers
        tools >> Edge(color=ORANGE, penwidth="2.2", xlabel="kb_search / RAG") >> kb
        kb >> Edge(color=ORANGE) >> kb_store
        tools >> Edge(color=ORANGE) >> buckets
        buckets >> Edge(color=ORANGE, style="dashed", xlabel="S3 event → ingest") >> kb
        rest_fns >> Edge(color=ORANGE) >> ddb

        # ================================================================
        # LAYOUT-ONLY invisible chains.
        #
        # These draw NOTHING. Under rankdir=LR an invisible edge advances the
        # target one rank to the right, so chaining otherwise-unconnected
        # siblings converts a tall vertical stack into a short horizontal row.
        # Without them Graphviz stacks the four standalone AgentCore services
        # (and each sink cluster) vertically and the canvas comes out portrait.
        # ================================================================
        # Customer Agents sit to the RIGHT of the research pipeline, and the two
        # agents share one row — together this saves two full rows of height.
        catalog >> Edge(style="invis") >> advisor
        evaluator >> Edge(style="invis") >> catalog

        # AgentCore's four standalone services: one row instead of a 4-high stack.
        memory >> Edge(style="invis") >> guardrails
        guardrails >> Edge(style="invis") >> browser
        browser >> Edge(style="invis") >> code_interp
        if payments is not None:
            code_interp >> Edge(style="invis") >> payments

        # REST API sits to the RIGHT of Client & Edge rather than beneath it.
        auth >> Edge(style="invis") >> rest

        # The three sink clusters (models, knowledge, data) laid out as one
        # horizontal band instead of three stacked rows.
        fm_claude >> Edge(style="invis") >> fm_nova
        fm_nova >> Edge(style="invis") >> kb
        kb_store >> Edge(style="invis") >> ddb
        ddb >> Edge(style="invis") >> buckets


def main() -> int:
    # Relative icon paths (see `icon()`) resolve against the CWD, so pin it.
    os.chdir(HERE)
    # `--payments` mirrors the feature flag; default off so the rendered diagram
    # matches a default deployment.
    build(show_payments="--payments" in sys.argv)

    produced = [HERE / f"{OUTPUT_BASENAME}.{ext}" for ext in ("png", "svg", "dot")]
    print("=" * 64)
    for path in produced:
        status = "OK  " if path.exists() else "MISS"
        size = f"{path.stat().st_size:,} bytes" if path.exists() else "-"
        print(f"  {status} {path.name}  ({size})")
    print("=" * 64)

    # Repo-root canonical copies (same names the old pipeline used).
    png = HERE / f"{OUTPUT_BASENAME}.png"
    if png.exists():
        shutil.copy2(png, REPO_ROOT / "architecture.drawio.png")
        print(f"Copied -> {REPO_ROOT / 'architecture.drawio.png'}")
    for ext in ("svg", "dot"):
        src = HERE / f"{OUTPUT_BASENAME}.{ext}"
        if src.exists():
            shutil.copy2(src, REPO_ROOT / f"architecture.drawio.{ext}")
            print(f"Copied -> {REPO_ROOT / f'architecture.drawio.{ext}'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
