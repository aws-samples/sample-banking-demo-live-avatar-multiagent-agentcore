"""
Declarative architecture spec for the gartner-app-dev-research-agent project.

AgentCore-first, May 2026 swim-lane layout. Produces the `title`, `clusters`,
`nodes`, `edges`, and `extra_prompt` strings that gen_arch.py feeds to Claude.

Design rules:
  - Three visual bands (top-to-bottom):
      1. User Journey   — User → CloudFront/WAF → Frontend → Cognito → REST API
      2. AgentCore Core — 2 Runtimes, Gateway + 5 Lambda groups, Memory,
                          Guardrails, Browser microVM, Code Interpreter,
                          in-process sub-agents
      3. Data & Model Plane — DynamoDB, S3, Knowledge Base (S3 Vectors),
                          Neptune (optional), Bedrock FMs
  - Orchestrator Runtime is a nested cluster inside AgentCore containing
    Planner / Researcher / Synthesizer / PDF Writer / Menu Designer /
    Chatbot sub-agents, plus an in-process Browser Tools sub-cluster.
  - 18 Gateway tools collapse to 5 logical Lambda groups. `kb_ingest` is
    edge-triggered by S3 events. `research_orchestrator` is a ghost node
    when `durable_functions` is off.
  - Feature-gated components are OMITTED (not greyed) when their flag is
    off. Exception: `research_orchestrator` renders as a dashed ghost.
"""

from __future__ import annotations

from dataclasses import dataclass
from textwrap import dedent

from cdk_inspector import FeatureFlags, ResolvedContext
from icon_manifest import node_token

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ArchitectureSpec:
    """The five strings consumed by gen_arch.py's Claude prompt."""

    title: str
    clusters: str
    nodes: str
    edges: str
    extra_prompt: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "title": self.title,
            "clusters": self.clusters,
            "nodes": self.nodes,
            "edges": self.edges,
            "extra_prompt": self.extra_prompt,
        }


# ---------------------------------------------------------------------------
# Theme — cluster borders/fills and matching edge colors
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Theme:
    bgcolor: str
    pencolor: str
    penwidth: int = 2
    edge_color: str | None = None  # defaults to pencolor when None

    def cluster_attrs(self) -> str:
        return f"bgcolor={self.bgcolor}, pencolor={self.pencolor}, penwidth={self.penwidth}, style=filled"

    def edge(self) -> str:
        return self.edge_color or self.pencolor


_THEMES: dict[str, Theme] = {
    # User Journey band — indigo
    "user": Theme(bgcolor="#EEF2FF", pencolor="#3B82F6"),
    # Auth band — amber
    "auth": Theme(bgcolor="#FFF7ED", pencolor="#F59E0B"),
    # REST API / ops — same amber family but slightly tinted
    "api": Theme(bgcolor="#FEF3C7", pencolor="#D97706"),
    # AgentCore Core — teal, visually dominant
    "agentcore": Theme(bgcolor="#01A88D", pencolor="#047857", penwidth=3),
    # Inner AgentCore clusters — lighter teal for nesting contrast
    "agentcore_inner": Theme(bgcolor="#B3E5D9", pencolor="#01A88D", penwidth=2),
    "agentcore_innermost": Theme(bgcolor="#E0F2EE", pencolor="#01A88D", penwidth=1),
    # Tool Lambdas — pink
    "tools": Theme(bgcolor="#FDF2F8", pencolor="#EC4899"),
    # Bedrock foundation models — purple
    "fm": Theme(bgcolor="#FAF5FF", pencolor="#8B5CF6"),
    # Data plane — warm orange
    "data": Theme(bgcolor="#FFF7ED", pencolor="#F97316"),
    # Knowledge Base — warm orange, slightly distinct
    "kb": Theme(bgcolor="#FFEDD5", pencolor="#F97316", penwidth=2),
    # Optional / ghost — muted grey
    "ghost": Theme(bgcolor="#F3F4F6", pencolor="#9CA3AF"),
    # Legend — white fill with subtle border so it reads as "reference
    # material" rather than a dimmed/disabled component.
    "legend": Theme(bgcolor="#FFFFFF", pencolor="#D1D5DB", penwidth=1),
}


# ---------------------------------------------------------------------------
# Node aliases
#
# Prefix convention (per plan):
#   u_   User Journey   a_   Auth & Edge       api_ REST API
#   r_   Orchestrator   v_   Avatar            g_   Gateway/Tool Lambdas
#   m_   Memory         gr_  Guardrails        br_  Browser microVM
#   ci_  Code Interp.   fm_  Foundation models kb_  Knowledge Base
#   d_   Data plane     n_   Neptune
# ---------------------------------------------------------------------------


# User Journey
U_USER = "u_user"
U_CF = "u_cloudfront"
U_WAF_CF = "u_waf_cf"
U_FRONTEND = "u_frontend_s3"

# Auth
A_COGNITO_UP = "a_cognito_up"
A_COGNITO_IP = "a_cognito_ip"
A_FEDERATE = "a_federate_idp"
A_COGNITO_DOMAIN = "a_cognito_domain"
A_WAF_REGIONAL = "a_waf_regional"
A_M2M = "a_m2m_client"
A_SECRETS = "a_secrets_mgr"

# REST API (Feedback + KB Reset)
API_GW = "api_gateway"
API_FEEDBACK = "api_feedback_lambda"
API_KB_RESET = "api_kb_reset_lambda"

# Orchestrator Runtime (+ in-process sub-agents)
R_RUNTIME = "r_runtime"
R_PLANNER = "r_planner"
R_RESEARCHER = "r_researcher"
R_SYNTH = "r_synthesizer"
R_PDF = "r_pdfwriter"
R_MENU = "r_menudesigner"
R_CHATBOT = "r_chatbot"
R_BROWSER_INPROC = "r_browsertools_inproc"
R_PERSONA = "r_persona_router"

# Avatar Runtime
V_RUNTIME = "v_runtime"
V_BIDI = "v_bidi"
V_TOOL_SEL = "v_tool_selector"

# Gateway + Lambda tool groups
G_GATEWAY = "g_gateway"
G_KNOWSEARCH = "g_knowsearch_lambda"
G_CONTENTGEN = "g_contentgen_lambda"
G_MEMORY = "g_memory_lambda"
G_COMMERCE = "g_commerce_lambda"
G_DURABLE = "g_durable_lambda"  # ghost, conditional

# Memory
M_AGENTCORE = "m_agentcore_memory"

# Guardrails
GR_POLICY = "gr_guardrail_policy"

# Browser microVM
BR_AGENTCORE = "br_agentcore_browser"

# Code Interpreter
CI_AGENTCORE = "ci_agentcore_codeinterpreter"

# Foundation models
FM_CLAUDE = "fm_claude46"
FM_SONIC = "fm_sonic"
FM_NOVALITE = "fm_novalite"
FM_CANVAS = "fm_canvas"
FM_REEL = "fm_reel"
FM_EMBED = "fm_nova_mm_embedding"

# Knowledge Base
KB_KB = "kb_kb"
KB_INDEX = "kb_index"
KB_VECTORS = "kb_vectors"
KB_DOCS_BUCKET = "kb_docs_bucket"
KB_SUPPLEMENTAL = "kb_supplemental"
KB_INGEST = "kb_ingest_lambda"
KB_DATA_SOURCE = "kb_data_source"

# Data plane
D_DDB_SESSIONS = "d_dynamo_sessions"
D_DDB_CUSTOMERS = "d_dynamo_customers"
D_DDB_METADATA = "d_dynamo_metadata"
D_DDB_FEEDBACK = "d_dynamo_feedback"
D_S3_REPORTS = "d_reports_s3"
D_S3_IMAGES = "d_images_s3"
D_S3_AVATAR = "d_avatar_s3"

# Neptune
N_GRAPH = "n_neptune_graph"

# Legend anchors — three column sub-nodes rendered side-by-side in a footer
# band at the bottom of the diagram. Splitting per column keeps each node's
# vertical height bounded so it does not flip the graph to portrait.
L_LEGEND_LEFT = "l_legend_left"
L_LEGEND_MIDDLE = "l_legend_middle"
L_LEGEND_RIGHT = "l_legend_right"


# ---------------------------------------------------------------------------
# Numbering table
#
# This ordered list is the authoritative source for node numbers. The number
# of each rendered alias is its 1-based index in this list (after filtering
# to only the aliases the current feature flags actually render).
#
# Both the node labels (prepended "N. ...") and the legend body are derived
# from the same _build_number_map() call, so they can never disagree.
# ---------------------------------------------------------------------------


_NUMBERED_ORDER: list[str] = [
    # --- LEFT column: User Journey, Auth, REST API ---
    U_USER,
    U_CF,
    U_WAF_CF,
    U_FRONTEND,
    A_COGNITO_UP,
    A_COGNITO_IP,
    A_FEDERATE,
    A_COGNITO_DOMAIN,
    A_WAF_REGIONAL,
    A_M2M,
    A_SECRETS,
    API_GW,
    API_FEEDBACK,
    API_KB_RESET,
    # --- MIDDLE column: AgentCore ---
    R_RUNTIME,
    R_PERSONA,
    R_PLANNER,
    R_RESEARCHER,
    R_SYNTH,
    R_PDF,
    R_MENU,
    R_CHATBOT,
    R_BROWSER_INPROC,
    V_RUNTIME,
    V_BIDI,
    V_TOOL_SEL,
    G_GATEWAY,
    G_KNOWSEARCH,
    G_CONTENTGEN,
    G_MEMORY,
    G_COMMERCE,
    G_DURABLE,
    M_AGENTCORE,
    GR_POLICY,
    BR_AGENTCORE,
    CI_AGENTCORE,
    # --- RIGHT column: FMs, Knowledge Base, Data plane ---
    FM_CLAUDE,
    FM_SONIC,
    FM_NOVALITE,
    FM_CANVAS,
    FM_REEL,
    FM_EMBED,
    KB_KB,
    KB_INDEX,
    KB_VECTORS,
    KB_DOCS_BUCKET,
    KB_SUPPLEMENTAL,
    KB_INGEST,
    KB_DATA_SOURCE,
    D_DDB_SESSIONS,
    D_DDB_CUSTOMERS,
    D_DDB_METADATA,
    D_DDB_FEEDBACK,
    D_S3_REPORTS,
    D_S3_IMAGES,
    D_S3_AVATAR,
    N_GRAPH,
]


_BASE_LABELS: dict[str, str] = {
    U_USER: "User",
    U_CF: "CloudFront",
    U_WAF_CF: "WAF (CloudFront)",
    U_FRONTEND: "Frontend\\n(S3 + Vite)",
    A_COGNITO_UP: "Cognito User Pool",
    A_COGNITO_IP: "Identity Pool",
    A_FEDERATE: "Federate / Midway",
    A_COGNITO_DOMAIN: "Cognito Domain",
    A_WAF_REGIONAL: "WAF (Regional)",
    A_M2M: "M2M Client",
    A_SECRETS: "Secrets Manager",
    API_GW: "REST API Gateway",
    API_FEEDBACK: "Feedback Lambda",
    API_KB_RESET: "KB Reset Lambda",
    R_RUNTIME: "Orchestrator Runtime",
    R_PLANNER: "Planner",
    R_RESEARCHER: "Researcher",
    R_SYNTH: "Synthesizer",
    R_PDF: "PDF Writer",
    R_MENU: "Menu Designer",
    R_CHATBOT: "Chatbot",
    R_PERSONA: "Persona Router",
    R_BROWSER_INPROC: "Browser Tools\\n(Strands @tool)",
    V_RUNTIME: "Avatar Runtime",
    V_BIDI: "BidiAgent",
    V_TOOL_SEL: "Tool Selector\\n(Nova 2 Lite)",
    G_GATEWAY: "MCP Gateway",
    G_KNOWSEARCH: "Knowledge & Search\\n(kb_search . web_search)",
    G_CONTENTGEN: "Content Generation\\n(pdf . canvas . reel . website)",
    G_MEMORY: "Memory & Profile\\n(save . recall . analyze . profile)",
    G_COMMERCE: "Commerce & Data\\n(place_order . data_sources . sample)",
    G_DURABLE: "Durable Functions\\n(research_orchestrator)",
    M_AGENTCORE: "AgentCore Memory\\n(Episodic . Semantic . Preferences)",
    GR_POLICY: "Bedrock Guardrails",
    BR_AGENTCORE: "AgentCore Browser\\n(microVM)",
    CI_AGENTCORE: "AgentCore Code Interpreter",
    FM_CLAUDE: "Claude Sonnet 4.6",
    FM_SONIC: "Nova 2 Sonic",
    FM_NOVALITE: "Nova 2 Lite",
    FM_CANVAS: "Nova Canvas",
    FM_REEL: "Nova Reel",
    FM_EMBED: "Nova 2 Multimodal\\nEmbeddings",
    KB_KB: "Knowledge Base\\n(Bedrock)",
    KB_INDEX: "Vector Index",
    KB_VECTORS: "S3 Vectors",
    KB_DOCS_BUCKET: "KB Docs S3",
    KB_SUPPLEMENTAL: "KB Supplemental S3",
    KB_INGEST: "kb_ingest Lambda",
    KB_DATA_SOURCE: "Data Source",
    D_DDB_SESSIONS: "Sessions",
    D_DDB_CUSTOMERS: "Customers",
    D_DDB_METADATA: "Metadata",
    D_DDB_FEEDBACK: "Feedback",
    D_S3_REPORTS: "Reports S3",
    D_S3_IMAGES: "Images S3",
    D_S3_AVATAR: "Avatar S3",
    N_GRAPH: "Neptune Analytics",
}


_BASE_LEGEND_BLURBS: dict[str, str] = {
    U_USER: "End user / browser",
    U_CF: "CloudFront distribution (OAC to S3)",
    U_WAF_CF: "WAF web ACL (CloudFront scope)",
    U_FRONTEND: "React + Vite SPA on S3",
    A_COGNITO_UP: "Cognito User Pool (OIDC)",
    A_COGNITO_IP: "Cognito Identity Pool (SigV4)",
    A_FEDERATE: "Federate / Midway IdP",
    A_COGNITO_DOMAIN: "Cognito hosted domain",
    A_WAF_REGIONAL: "WAF web ACL (Regional scope)",
    A_M2M: "M2M OAuth2 client credentials",
    A_SECRETS: "Secrets Manager (M2M secret)",
    API_GW: "REST API Gateway (feedback, kb-reset)",
    API_FEEDBACK: "Feedback persistence Lambda",
    API_KB_RESET: "Knowledge Base reset Lambda",
    R_RUNTIME: "AgentCore Runtime (HTTP/SSE)",
    R_PERSONA: "Dispatches per-mode sub-agents",
    R_PLANNER: "Decomposes query into plan",
    R_RESEARCHER: "KB + web search + citations",
    R_SYNTH: "Cross-references, summarizes",
    R_PDF: "12-section PDF report",
    R_MENU: "Menu designer + dish images",
    R_CHATBOT: "Conversational agent (guarded)",
    R_BROWSER_INPROC: "Strands browser @tool helpers",
    V_RUNTIME: "AgentCore Runtime (WebSocket)",
    V_BIDI: "Nova Sonic bidi agent",
    V_TOOL_SEL: "Nova Lite tool selector",
    G_GATEWAY: "MCP Gateway (JWT-authorized)",
    G_KNOWSEARCH: "kb_search + web_search tools",
    G_CONTENTGEN: "PDF + Canvas + Reel tools",
    G_MEMORY: "Memory + user profile tools",
    G_COMMERCE: "Orders + data + sample tools",
    G_DURABLE: "Durable research orchestrator",
    M_AGENTCORE: "Episodic / semantic / preference",
    GR_POLICY: "Bedrock guardrail policy",
    BR_AGENTCORE: "AgentCore Browser microVM",
    CI_AGENTCORE: "AgentCore Code Interpreter",
    FM_CLAUDE: "Claude Sonnet 4.6 (Converse)",
    FM_SONIC: "Nova 2 Sonic (voice bidi)",
    FM_NOVALITE: "Nova 2 Lite (tool select)",
    FM_CANVAS: "Nova Canvas (image gen)",
    FM_REEL: "Nova Reel (video gen)",
    FM_EMBED: "Nova 2 multimodal embeddings",
    KB_KB: "Bedrock Knowledge Base",
    KB_INDEX: "S3 Vectors index",
    KB_VECTORS: "S3 Vectors bucket",
    KB_DOCS_BUCKET: "KB source documents bucket",
    KB_SUPPLEMENTAL: "Supplemental assets bucket",
    KB_INGEST: "S3-event ingestion Lambda",
    KB_DATA_SOURCE: "KB data source binding",
    D_DDB_SESSIONS: "Session state table",
    D_DDB_CUSTOMERS: "Customer profiles table",
    D_DDB_METADATA: "Metadata table",
    D_DDB_FEEDBACK: "User feedback table",
    D_S3_REPORTS: "Generated reports bucket",
    D_S3_IMAGES: "Generated images bucket",
    D_S3_AVATAR: "Avatar assets bucket",
    N_GRAPH: "Neptune Analytics (optional)",
}


# Column boundaries, expressed as aliases that begin each column.
_COLUMN_HEADERS: list[tuple[str, str]] = [
    (U_USER, "LEFT:   USER / AUTH / REST API"),
    (R_RUNTIME, "MIDDLE: AMAZON BEDROCK AGENTCORE"),
    (FM_CLAUDE, "RIGHT:  FM / KNOWLEDGE BASE / DATA"),
]


def _rendered_aliases(flags: FeatureFlags) -> set[str]:
    """Return the set of aliases that _build_nodes would emit for these flags.

    This is the single source of truth shared by _build_number_map and the
    node emitter — feature-flag predicates are not duplicated elsewhere.
    """
    rendered: set[str] = set()

    # User Journey (always)
    rendered.update({U_USER, U_CF, U_WAF_CF, U_FRONTEND})

    # Auth (always)
    rendered.update({A_COGNITO_UP, A_COGNITO_IP, A_FEDERATE, A_COGNITO_DOMAIN, A_WAF_REGIONAL, A_M2M, A_SECRETS})

    # REST API
    rendered.update({API_GW, API_FEEDBACK})
    if flags.knowledge_base:
        rendered.add(API_KB_RESET)

    # Orchestrator Runtime + in-process sub-agents
    rendered.update({R_RUNTIME, R_PLANNER, R_RESEARCHER, R_SYNTH, R_PDF, R_MENU, R_CHATBOT, R_PERSONA})
    if flags.browser:
        rendered.add(R_BROWSER_INPROC)

    # Avatar Runtime
    if flags.avatar:
        rendered.update({V_RUNTIME, V_BIDI, V_TOOL_SEL})

    # Gateway + Lambda groups
    rendered.update({G_GATEWAY, G_KNOWSEARCH, G_CONTENTGEN, G_MEMORY, G_COMMERCE})
    if flags.durable_functions:
        rendered.add(G_DURABLE)

    # AgentCore features
    if flags.episodic_memory or flags.semantic_memory or flags.user_preference_memory:
        rendered.add(M_AGENTCORE)
    if flags.guardrails:
        rendered.add(GR_POLICY)
    if flags.browser:
        rendered.add(BR_AGENTCORE)
    rendered.add(CI_AGENTCORE)

    # Foundation models
    rendered.update({FM_CLAUDE, FM_CANVAS, FM_REEL})
    if flags.avatar:
        rendered.update({FM_SONIC, FM_NOVALITE})
    if flags.knowledge_base:
        rendered.add(FM_EMBED)

    # Knowledge Base
    if flags.knowledge_base:
        rendered.update({KB_KB, KB_INDEX, KB_VECTORS, KB_DOCS_BUCKET, KB_SUPPLEMENTAL, KB_INGEST, KB_DATA_SOURCE})

    # Data plane
    rendered.update({D_DDB_SESSIONS, D_DDB_CUSTOMERS, D_DDB_METADATA, D_DDB_FEEDBACK, D_S3_REPORTS, D_S3_IMAGES})
    if flags.avatar:
        rendered.add(D_S3_AVATAR)

    # Neptune
    if flags.neptune:
        rendered.add(N_GRAPH)

    return rendered


def _build_number_map(flags: FeatureFlags) -> dict[str, int]:
    """Assign 1-based numbers to every alias rendered for these flags.

    Ordering is strictly _NUMBERED_ORDER filtered to rendered aliases —
    numbers are contiguous with no gaps.
    """
    rendered = _rendered_aliases(flags)
    return {alias: i + 1 for i, alias in enumerate(a for a in _NUMBERED_ORDER if a in rendered)}


def _build_numbered_labels(flags: FeatureFlags) -> dict[str, str]:
    """Produce LABELS dict with '{n}. ' prefix on every rendered alias."""
    numbers = _build_number_map(flags)
    return {alias: f"{numbers[alias]}. {_BASE_LABELS[alias]}" for alias in numbers}


def _column_ranges() -> list[tuple[str, str, int, int]]:
    """Return [(header_title, first_alias, start_idx, end_idx), ...]."""
    order = _NUMBERED_ORDER
    starts = [order.index(a) for a, _ in _COLUMN_HEADERS]
    ends = starts[1:] + [len(order)]
    return [(title, alias, starts[i], ends[i]) for i, (alias, title) in enumerate(_COLUMN_HEADERS)]


def _build_legend_texts(flags: FeatureFlags) -> dict[str, str]:
    """Produce three column-scoped legend bodies (LEFT, MIDDLE, RIGHT).

    Each body is short enough (~15-20 lines) that Graphviz will not flip
    the graph into portrait orientation. Returned dict keys are the
    three legend-anchor aliases.
    """
    numbers = _build_number_map(flags)
    rendered = set(numbers)
    # Global alignment: pad numbers to the widest integer width so the
    # three column bodies visually line up when placed side-by-side.
    width = max((len(str(n)) for n in numbers.values()), default=1)

    anchors = [L_LEGEND_LEFT, L_LEGEND_MIDDLE, L_LEGEND_RIGHT]
    bodies: dict[str, str] = {}

    for anchor, (title, _first, start, end) in zip(anchors, _column_ranges()):
        column_aliases = [a for a in _NUMBERED_ORDER[start:end] if a in rendered]
        # Per-column name width so each column packs tightly without
        # pushing the others wider.
        name_width = max(
            (len(_BASE_LABELS[a].replace("\\n", " ")) for a in column_aliases),
            default=0,
        )
        name_width = min(name_width, 26)
        lines = [f"▸ {title}"]
        for a in column_aliases:
            n = numbers[a]
            name = _BASE_LABELS[a].replace("\\n", " ")
            blurb = _BASE_LEGEND_BLURBS.get(a, "")
            lines.append(f"{str(n).rjust(width)}. {name.ljust(name_width)}  {blurb}")
        bodies[anchor] = "\n".join(lines)
    return bodies


def _build_legend_text(flags: FeatureFlags) -> str:
    """Concatenate the per-column bodies (used by the dry-run CLI only)."""
    bodies = _build_legend_texts(flags)
    parts = [bodies[L_LEGEND_LEFT], bodies[L_LEGEND_MIDDLE], bodies[L_LEGEND_RIGHT]]
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _mk_node(icon_logical_name: str, alias: str) -> str:
    return f"    {node_token(icon_logical_name)} {alias}"


def _mk_edge(
    src: str,
    dst: str,
    theme: Theme,
    *,
    style: str | None = None,
    width: int | None = None,
    label: str | None = None,
) -> str:
    attrs = [f"color={theme.edge()}"]
    if style:
        attrs.append(f"style={style}")
    if width:
        attrs.append(f"penwidth={width}")
    if label:
        attrs.append(f'xlabel="{label}"')
    return f"    {src} points to {dst} ({', '.join(attrs)})"


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------


def _build_nodes(flags: FeatureFlags) -> str:
    lines: list[str] = []

    # --- User Journey --------------------------------------------------
    lines.append(_mk_node("user", U_USER))
    lines.append(_mk_node("cloudfront", U_CF))
    lines.append(_mk_node("waf", U_WAF_CF))
    lines.append(_mk_node("s3", U_FRONTEND))

    # --- Auth & Edge ---------------------------------------------------
    lines.append(_mk_node("cognito", A_COGNITO_UP))
    lines.append(_mk_node("cognito", A_COGNITO_IP))
    lines.append(_mk_node("identity", A_FEDERATE))
    lines.append(_mk_node("cognito", A_COGNITO_DOMAIN))
    lines.append(_mk_node("waf", A_WAF_REGIONAL))
    lines.append(_mk_node("cognito", A_M2M))
    lines.append(_mk_node("secrets_manager", A_SECRETS))

    # --- REST API (Feedback + KB Reset) --------------------------------
    lines.append(_mk_node("api_gateway", API_GW))
    lines.append(_mk_node("lambda", API_FEEDBACK))
    if flags.knowledge_base:
        lines.append(_mk_node("lambda", API_KB_RESET))

    # --- Orchestrator Runtime + in-process sub-agents ------------------
    # Strands-agent mark goes on every genuine `strands.Agent()` instance.
    # R_PERSONA is an if/elif dispatcher inside orchestrate() (not an Agent),
    # so it reuses the Runtime icon to reinforce it's the entry gate.
    # R_BROWSER_INPROC is a 7x `@tool` bundle (not an Agent) so it reuses
    # the Browser_Tool icon.
    lines.append(_mk_node("runtime", R_RUNTIME))
    lines.append(_mk_node("runtime", R_PERSONA))
    lines.append(_mk_node("strands_agent", R_PLANNER))
    lines.append(_mk_node("strands_agent", R_RESEARCHER))
    lines.append(_mk_node("strands_agent", R_SYNTH))
    lines.append(_mk_node("strands_agent", R_PDF))
    lines.append(_mk_node("strands_agent", R_MENU))
    lines.append(_mk_node("strands_agent", R_CHATBOT))
    if flags.browser:
        lines.append(_mk_node("browser_tool", R_BROWSER_INPROC))

    # --- Avatar Runtime ------------------------------------------------
    if flags.avatar:
        lines.append(_mk_node("runtime", V_RUNTIME))
        lines.append(_mk_node("strands_agent", V_BIDI))
        lines.append(_mk_node("strands_agent", V_TOOL_SEL))

    # --- Gateway + Lambda groups ---------------------------------------
    lines.append(_mk_node("gateway", G_GATEWAY))
    lines.append(_mk_node("lambda", G_KNOWSEARCH))
    lines.append(_mk_node("lambda", G_CONTENTGEN))
    lines.append(_mk_node("lambda", G_MEMORY))
    lines.append(_mk_node("lambda", G_COMMERCE))
    if flags.durable_functions:
        lines.append(_mk_node("lambda", G_DURABLE))

    # --- AgentCore features -------------------------------------------
    if flags.episodic_memory or flags.semantic_memory or flags.user_preference_memory:
        lines.append(_mk_node("memory", M_AGENTCORE))
    if flags.guardrails:
        lines.append(_mk_node("guardrails", GR_POLICY))
    if flags.browser:
        lines.append(_mk_node("browser_tool", BR_AGENTCORE))
    lines.append(_mk_node("code_interpreter", CI_AGENTCORE))

    # --- Foundation models --------------------------------------------
    lines.append(_mk_node("bedrock", FM_CLAUDE))
    if flags.avatar:
        lines.append(_mk_node("bedrock", FM_SONIC))
        lines.append(_mk_node("bedrock", FM_NOVALITE))
    lines.append(_mk_node("bedrock", FM_CANVAS))
    lines.append(_mk_node("bedrock", FM_REEL))
    if flags.knowledge_base:
        lines.append(_mk_node("bedrock", FM_EMBED))

    # --- Knowledge Base -----------------------------------------------
    if flags.knowledge_base:
        lines.append(_mk_node("knowledge_base", KB_KB))
        lines.append(_mk_node("s3", KB_INDEX))
        lines.append(_mk_node("s3", KB_VECTORS))
        lines.append(_mk_node("s3", KB_DOCS_BUCKET))
        lines.append(_mk_node("s3", KB_SUPPLEMENTAL))
        lines.append(_mk_node("lambda", KB_INGEST))
        lines.append(_mk_node("s3", KB_DATA_SOURCE))

    # --- Data plane ---------------------------------------------------
    lines.append(_mk_node("dynamodb", D_DDB_SESSIONS))
    lines.append(_mk_node("dynamodb", D_DDB_CUSTOMERS))
    lines.append(_mk_node("dynamodb", D_DDB_METADATA))
    lines.append(_mk_node("dynamodb", D_DDB_FEEDBACK))
    lines.append(_mk_node("s3", D_S3_REPORTS))
    lines.append(_mk_node("s3", D_S3_IMAGES))
    if flags.avatar:
        lines.append(_mk_node("s3", D_S3_AVATAR))

    # --- Neptune (optional) -------------------------------------------
    if flags.neptune:
        lines.append(_mk_node("neptune", N_GRAPH))

    # --- Legend anchors (three sibling nodes in a footer band) -------
    lines.append(_mk_node("observability", L_LEGEND_LEFT))
    lines.append(_mk_node("observability", L_LEGEND_MIDDLE))
    lines.append(_mk_node("observability", L_LEGEND_RIGHT))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Clusters
# ---------------------------------------------------------------------------


def _build_clusters(flags: FeatureFlags) -> str:
    t = _THEMES

    def contains(*aliases: str) -> str:
        return ", ".join(aliases)

    user_members = [U_USER, U_CF, U_WAF_CF, U_FRONTEND]
    auth_members = [
        A_COGNITO_UP,
        A_COGNITO_IP,
        A_FEDERATE,
        A_COGNITO_DOMAIN,
        A_WAF_REGIONAL,
        A_M2M,
        A_SECRETS,
    ]

    api_members = [API_GW, API_FEEDBACK]
    if flags.knowledge_base:
        api_members.append(API_KB_RESET)

    agentcore_members: list[str] = [R_RUNTIME]
    if flags.avatar:
        agentcore_members.append(V_RUNTIME)
    agentcore_members.append(G_GATEWAY)
    if flags.episodic_memory or flags.semantic_memory or flags.user_preference_memory:
        agentcore_members.append(M_AGENTCORE)
    if flags.guardrails:
        agentcore_members.append(GR_POLICY)
    if flags.browser:
        agentcore_members.append(BR_AGENTCORE)
    agentcore_members.append(CI_AGENTCORE)

    orch_members = [
        R_PLANNER,
        R_RESEARCHER,
        R_SYNTH,
        R_PDF,
        R_MENU,
        R_CHATBOT,
        R_PERSONA,
    ]
    pipeline_members = [R_PLANNER, R_RESEARCHER, R_SYNTH, R_PDF, R_MENU, R_CHATBOT]
    browser_inproc_members = [R_BROWSER_INPROC] if flags.browser else []
    avatar_members = [V_BIDI, V_TOOL_SEL] if flags.avatar else []

    gateway_members = [G_KNOWSEARCH, G_CONTENTGEN, G_MEMORY, G_COMMERCE]
    if flags.durable_functions:
        gateway_members.append(G_DURABLE)

    fm_members = [FM_CLAUDE]
    if flags.avatar:
        fm_members += [FM_SONIC, FM_NOVALITE]
    fm_members += [FM_CANVAS, FM_REEL]
    if flags.knowledge_base:
        fm_members.append(FM_EMBED)

    kb_members: list[str] = []
    if flags.knowledge_base:
        kb_members = [
            KB_KB,
            KB_INDEX,
            KB_VECTORS,
            KB_DOCS_BUCKET,
            KB_SUPPLEMENTAL,
            KB_INGEST,
            KB_DATA_SOURCE,
        ]

    data_members = [
        D_DDB_SESSIONS,
        D_DDB_CUSTOMERS,
        D_DDB_METADATA,
        D_DDB_FEEDBACK,
        D_S3_REPORTS,
        D_S3_IMAGES,
    ]
    if flags.avatar:
        data_members.append(D_S3_AVATAR)

    lines = [
        f"    Cluster User Journey ({t['user'].cluster_attrs()}) contains {contains(*user_members)}",
        f"    Cluster Auth and Edge ({t['auth'].cluster_attrs()}) contains {contains(*auth_members)}",
        f"    Cluster REST API ({t['api'].cluster_attrs()}) contains {contains(*api_members)}",
        f"    Cluster Amazon Bedrock AgentCore ({t['agentcore'].cluster_attrs()}) contains {contains(*agentcore_members)}",
        f"    Cluster Orchestrator Runtime ({t['agentcore_inner'].cluster_attrs()}, parent=Amazon Bedrock AgentCore) contains {contains(*orch_members)}",
        f"    Cluster Multi-Agent Pipeline ({t['agentcore_innermost'].cluster_attrs()}, parent=Orchestrator Runtime) contains {contains(*pipeline_members)}",
    ]
    if browser_inproc_members:
        lines.append(
            f"    Cluster Browser Tools (in-process) ({t['agentcore_innermost'].cluster_attrs()}, parent=Orchestrator Runtime) contains {contains(*browser_inproc_members)}"
        )
    if avatar_members:
        lines.append(
            f"    Cluster Avatar Runtime ({t['agentcore_inner'].cluster_attrs()}, parent=Amazon Bedrock AgentCore) contains {contains(*avatar_members)}"
        )
    lines.append(
        f"    Cluster MCP Gateway ({t['agentcore_inner'].cluster_attrs()}, parent=Amazon Bedrock AgentCore) contains {contains(*gateway_members)}"
    )
    lines.append(f"    Cluster Bedrock Foundation Models ({t['fm'].cluster_attrs()}) contains {contains(*fm_members)}")
    if kb_members:
        lines.append(f"    Cluster Knowledge Base ({t['kb'].cluster_attrs()}) contains {contains(*kb_members)}")
    lines.append(f"    Cluster Data Plane ({t['data'].cluster_attrs()}) contains {contains(*data_members)}")
    if flags.neptune:
        lines.append(f"    Cluster Neptune Analytics ({t['ghost'].cluster_attrs()}) contains {N_GRAPH}")
    # Legend cluster — footer band at the bottom of the diagram, three
    # sibling anchors aligned side-by-side (rank=same).
    lines.append(
        f"    Cluster Legend ({t['legend'].cluster_attrs()}) contains "
        f"{L_LEGEND_LEFT}, {L_LEGEND_MIDDLE}, {L_LEGEND_RIGHT}"
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Edges
# ---------------------------------------------------------------------------


def _build_edges(flags: FeatureFlags) -> str:
    t = _THEMES
    lines: list[str] = []

    # --- User Journey hot path ----------------------------------------
    lines.append(_mk_edge(U_USER, U_CF, t["user"], width=2))
    lines.append(_mk_edge(U_CF, U_FRONTEND, t["user"], width=2))
    lines.append(_mk_edge(U_CF, U_WAF_CF, t["user"], style="dashed"))

    # --- Auth paths ---------------------------------------------------
    lines.append(_mk_edge(U_FRONTEND, A_COGNITO_UP, t["auth"], label="OIDC"))
    lines.append(_mk_edge(A_COGNITO_UP, A_FEDERATE, t["auth"], style="dashed", label="Midway"))
    lines.append(_mk_edge(A_COGNITO_UP, A_COGNITO_DOMAIN, t["auth"]))
    lines.append(_mk_edge(A_COGNITO_UP, A_COGNITO_IP, t["auth"]))

    # --- Runtime invocation (frontend -> runtimes) --------------------
    lines.append(_mk_edge(U_FRONTEND, R_RUNTIME, t["agentcore"], width=2, label="SigV4/JWT"))
    if flags.avatar:
        lines.append(_mk_edge(U_FRONTEND, V_RUNTIME, t["agentcore"], width=2, label="WebSocket"))

    # --- M2M OAuth2 ---------------------------------------------------
    lines.append(_mk_edge(R_RUNTIME, A_M2M, t["auth"], style="dashed", label="M2M OAuth2"))
    if flags.avatar:
        lines.append(_mk_edge(V_RUNTIME, A_M2M, t["auth"], style="dashed"))
    lines.append(_mk_edge(A_M2M, A_SECRETS, t["auth"], style="dashed"))

    # --- Gateway JWT / authorizer -------------------------------------
    lines.append(_mk_edge(G_GATEWAY, A_COGNITO_UP, t["auth"], style="dashed", label="JWT"))

    # --- Runtimes -> Gateway ------------------------------------------
    lines.append(_mk_edge(R_RUNTIME, G_GATEWAY, t["agentcore"], width=2))
    if flags.avatar:
        lines.append(_mk_edge(V_RUNTIME, G_GATEWAY, t["agentcore"], width=2))

    # --- Gateway -> Lambda groups -------------------------------------
    for group in (G_KNOWSEARCH, G_CONTENTGEN, G_MEMORY, G_COMMERCE):
        lines.append(_mk_edge(G_GATEWAY, group, t["tools"], width=2))
    if flags.durable_functions:
        lines.append(_mk_edge(G_GATEWAY, G_DURABLE, t["tools"], style="dashed"))
        lines.append(_mk_edge(G_DURABLE, R_RUNTIME, t["ghost"], style="dashed", label="callback"))

    # --- In-process sub-agent pipeline --------------------------------
    lines.append(_mk_edge(R_RUNTIME, R_PERSONA, t["agentcore_inner"]))
    lines.append(_mk_edge(R_PERSONA, R_PLANNER, t["agentcore_inner"]))
    lines.append(_mk_edge(R_PLANNER, R_RESEARCHER, t["agentcore_inner"]))
    lines.append(_mk_edge(R_RESEARCHER, R_SYNTH, t["agentcore_inner"]))
    lines.append(_mk_edge(R_SYNTH, R_PDF, t["agentcore_inner"]))
    lines.append(_mk_edge(R_PERSONA, R_MENU, t["agentcore_inner"], style="dashed"))
    lines.append(_mk_edge(R_PERSONA, R_CHATBOT, t["agentcore_inner"], style="dashed"))

    # --- Chatbot guardrails -------------------------------------------
    if flags.guardrails:
        lines.append(_mk_edge(R_CHATBOT, GR_POLICY, t["agentcore_inner"], style="dashed", label="ApplyGuardrail"))

    # --- Avatar Runtime inner -----------------------------------------
    if flags.avatar:
        lines.append(_mk_edge(V_RUNTIME, V_BIDI, t["agentcore_inner"]))
        lines.append(_mk_edge(V_RUNTIME, V_TOOL_SEL, t["agentcore_inner"]))

    # --- Browser microVM ----------------------------------------------
    if flags.browser:
        lines.append(_mk_edge(R_CHATBOT, R_BROWSER_INPROC, t["agentcore_inner"], style="dashed"))
        lines.append(_mk_edge(R_BROWSER_INPROC, BR_AGENTCORE, t["agentcore_inner"], style="dashed", label="CDP"))
        lines.append(_mk_edge(U_USER, BR_AGENTCORE, t["user"], style="dashed", label="DCV live view"))

    # --- Code Interpreter (extract_pdf_images) ------------------------
    lines.append(_mk_edge(G_CONTENTGEN, CI_AGENTCORE, t["agentcore_inner"], style="dashed", label="extract_pdf_images"))

    # --- AgentCore Memory ---------------------------------------------
    if flags.episodic_memory or flags.semantic_memory or flags.user_preference_memory:
        lines.append(_mk_edge(R_RUNTIME, M_AGENTCORE, t["agentcore_inner"]))
        if flags.avatar:
            lines.append(_mk_edge(V_RUNTIME, M_AGENTCORE, t["agentcore_inner"]))
        lines.append(_mk_edge(G_MEMORY, M_AGENTCORE, t["agentcore_inner"]))

    # --- Runtime -> Foundation Models ---------------------------------
    lines.append(_mk_edge(R_RUNTIME, FM_CLAUDE, t["fm"], width=2, label="Converse"))
    if flags.avatar:
        lines.append(_mk_edge(V_RUNTIME, FM_SONIC, t["fm"], width=2, label="Sonic bidi"))
        lines.append(_mk_edge(V_RUNTIME, FM_NOVALITE, t["fm"], label="tool select"))

    # --- Tool Lambdas -> FMs ------------------------------------------
    lines.append(_mk_edge(G_KNOWSEARCH, FM_CLAUDE, t["fm"], style="dashed", label="Nova grounding"))
    lines.append(_mk_edge(G_CONTENTGEN, FM_CANVAS, t["fm"], width=2))
    lines.append(_mk_edge(G_CONTENTGEN, FM_REEL, t["fm"], width=2))

    # --- Tool Lambdas -> Data plane -----------------------------------
    lines.append(_mk_edge(G_CONTENTGEN, D_S3_REPORTS, t["data"], label="pdf_generator"))
    lines.append(_mk_edge(G_CONTENTGEN, D_S3_IMAGES, t["data"]))
    lines.append(_mk_edge(G_COMMERCE, D_DDB_CUSTOMERS, t["data"]))
    lines.append(_mk_edge(G_COMMERCE, D_DDB_METADATA, t["data"]))

    # --- Runtime -> Sessions ------------------------------------------
    lines.append(_mk_edge(R_RUNTIME, D_DDB_SESSIONS, t["data"]))
    if flags.avatar:
        lines.append(_mk_edge(V_RUNTIME, D_DDB_SESSIONS, t["data"]))
        lines.append(_mk_edge(V_RUNTIME, D_S3_AVATAR, t["data"]))

    # --- REST API paths -----------------------------------------------
    lines.append(_mk_edge(U_FRONTEND, API_GW, t["api"], label="POST /feedback"))
    lines.append(_mk_edge(API_GW, A_COGNITO_UP, t["auth"], style="dashed", label="authorizer"))
    lines.append(_mk_edge(API_GW, A_WAF_REGIONAL, t["auth"], style="dashed"))
    lines.append(_mk_edge(API_GW, API_FEEDBACK, t["api"]))
    lines.append(_mk_edge(API_FEEDBACK, D_DDB_FEEDBACK, t["data"]))
    if flags.knowledge_base:
        lines.append(_mk_edge(API_GW, API_KB_RESET, t["api"], label="POST /kb-reset"))
        lines.append(_mk_edge(API_KB_RESET, KB_DOCS_BUCKET, t["data"], style="dashed", label="DeleteObject"))
        lines.append(_mk_edge(API_KB_RESET, KB_KB, t["kb"], style="dashed", label="StartIngestionJob"))

    # --- Knowledge Base search + ingestion ----------------------------
    if flags.knowledge_base:
        lines.append(_mk_edge(G_KNOWSEARCH, KB_KB, t["kb"], width=2, label="kb_search"))
        lines.append(_mk_edge(D_S3_REPORTS, KB_INGEST, t["kb"], style="dashed", label="S3 event"))
        lines.append(_mk_edge(KB_INGEST, KB_DOCS_BUCKET, t["kb"]))
        lines.append(_mk_edge(KB_INGEST, KB_KB, t["kb"], style="dashed", label="StartIngestionJob"))
        lines.append(_mk_edge(KB_KB, KB_DATA_SOURCE, t["kb"]))
        lines.append(_mk_edge(KB_DATA_SOURCE, KB_DOCS_BUCKET, t["kb"]))
        lines.append(_mk_edge(KB_KB, KB_INDEX, t["kb"]))
        lines.append(_mk_edge(KB_INDEX, KB_VECTORS, t["kb"]))
        lines.append(_mk_edge(KB_KB, FM_EMBED, t["fm"], style="dashed", label="embed"))
        lines.append(_mk_edge(KB_KB, KB_SUPPLEMENTAL, t["kb"], style="dashed"))

    # --- Neptune fallback (conditional) --------------------------------
    if flags.neptune:
        lines.append(_mk_edge(G_MEMORY, N_GRAPH, t["ghost"], style="dashed", label="fallback"))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Extra prompt — layout guidance for Claude
# ---------------------------------------------------------------------------


def _build_extra_prompt(flags: FeatureFlags) -> str:
    labels = _build_numbered_labels(flags)
    legend_bodies = _build_legend_texts(flags)

    # Render the LABELS dict deterministically in _NUMBERED_ORDER so the
    # prompt diff is stable across runs with identical flags.
    label_lines: list[str] = []
    for alias in _NUMBERED_ORDER:
        if alias in labels:
            label_lines.append(f'            "{alias}": "{labels[alias]}",')
    labels_block = "\n".join(label_lines)

    # Render each column's body as its own indented block, keyed by the
    # anchor alias Claude must use as the node label.
    def _indent_body(body: str) -> str:
        return "\n".join(f"            {line}" for line in body.split("\n"))

    legend_left_block = _indent_body(legend_bodies[L_LEGEND_LEFT])
    legend_middle_block = _indent_body(legend_bodies[L_LEGEND_MIDDLE])
    legend_right_block = _indent_body(legend_bodies[L_LEGEND_RIGHT])

    base = (
        dedent(
            """\
        RESEARCH-AGENT LAYOUT RULES (AgentCore-first, May 2026):

        LAYOUT RULES:
          - Use direction="LR" (left-to-right flow). The User MUST be
            the leftmost node in the diagram.
          - graph_attr must include: nodesep="0.6", ranksep="1.2",
            splines="ortho", pad="0.6", fontname="Helvetica", dpi="200",
            rankdir="LR".
          - Three visual columns left-to-right:
              (1) LEFT column: User Journey + Auth and Edge + REST API
                  (the user starts here on the far left)
              (2) MIDDLE column: Amazon Bedrock AgentCore (the visual
                  center -- must visibly dominate the diagram with larger
                  padding and bolder border, penwidth=3). Nested inside:
                  Orchestrator Runtime, Avatar Runtime, MCP Gateway,
                  Memory, Guardrails, Browser, Code Interpreter.
              (3) RIGHT column: Bedrock Foundation Models + Knowledge
                  Base + Data Plane (the "sinks" the AgentCore core
                  reads from and writes to).
          - ASPECT RULE: the final canvas MUST be landscape (wider than
            tall). To keep Auth and Edge from stacking 11 nodes tall,
            add `graph_attr={"rank": "same", ...}` rows inside the Auth
            and Edge cluster that group nodes into 2-3 horizontal rows
            via invisible chain edges:
              a_cognito_up >> Edge(style="invis") >> a_cognito_ip >> Edge(style="invis") >> a_federate_idp
              a_cognito_domain >> Edge(style="invis") >> a_waf_regional >> Edge(style="invis") >> a_m2m_client
            Do the same inside the Data Plane cluster (7 nodes) -- split
            into two rows of 3-4:
              d_dynamo_sessions >> Edge(style="invis") >> d_dynamo_customers >> Edge(style="invis") >> d_dynamo_metadata >> Edge(style="invis") >> d_dynamo_feedback
              d_reports_s3 >> Edge(style="invis") >> d_images_s3 >> Edge(style="invis") >> d_avatar_s3
            And the Knowledge Base cluster (7 nodes) -- two rows:
              kb_kb >> Edge(style="invis") >> kb_index >> Edge(style="invis") >> kb_vectors >> Edge(style="invis") >> kb_data_source
              kb_docs_bucket >> Edge(style="invis") >> kb_supplemental >> Edge(style="invis") >> kb_ingest_lambda
            And Bedrock Foundation Models (6 nodes) -- two rows:
              fm_claude46 >> Edge(style="invis") >> fm_sonic >> Edge(style="invis") >> fm_novalite
              fm_canvas >> Edge(style="invis") >> fm_reel >> Edge(style="invis") >> fm_nova_mm_embedding
            These chain edges flatten each cluster from ~11 rows tall
            to ~4 rows tall, pulling the overall canvas aspect from
            1:1.7 portrait to ~1.3:1 landscape.
          - The Legend cluster is rendered as a RIGHT-SIDE COLUMN,
            vertically aligned with the main architecture bands. It sits
            to the right of the Knowledge Base / Data Plane / Foundation
            Models clusters and contains three sibling anchor nodes
            (left / middle / right) aligned HORIZONTALLY side-by-side as
            three narrow sub-columns via `rank=same` inside the cluster.
            The three sub-columns make the legend compact (roughly as
            tall as the main body, not 3x taller) so the overall canvas
            stays close to landscape.
            Pin the legend to the UPPER-RIGHT corner by CHAINING ALL
            THREE LEGEND NODES directly onto the top-right-column
            nodes with invisible edges. The legend anchors become
            right-hand siblings of fm_claude46 / kb_kb / d_dynamo_sessions
            in the same rank order, forcing Graphviz to place them in
            the upper-right whitespace:
              fm_claude46       >> Edge(style="invis") >> l_legend_left
              l_legend_left     >> Edge(style="invis") >> l_legend_middle
              l_legend_middle   >> Edge(style="invis") >> l_legend_right
            Then ALSO chain the top-row foundation-model rank to the
            three legend nodes so they share a horizontal row:
              fm_claude46 >> Edge(style="invis") >> fm_sonic >> Edge(style="invis") >> fm_novalite >> Edge(style="invis") >> l_legend_left
            (the legend chain in LEGEND RULES below already ties the
            three legend nodes together, so this one extra edge from
            fm_novalite to l_legend_left is what actually drags the
            legend cluster up to the top row).
            Do NOT use constraint="false" -- that disables positioning
            and the legend drifts to bottom-left whitespace.

        NESTING RULES:
          - Honor every `parent=<Name>` attribute in the clusters list.
            That cluster MUST be rendered nested inside the named parent's
            `with Cluster(...)` block. Missing nesting is a validation
            error.
          - Nested cluster fill uses a lighter shade than its parent so
            the nesting is visually obvious (Orchestrator Runtime uses
            teal #B3E5D9 inside the AgentCore #01A88D outer; Multi-Agent
            Pipeline and Browser Tools (in-process) use the lightest
            shade #E0F2EE as innermost clusters inside the Orchestrator).

        EDGE STYLE RULES:
          - Solid edges are hot paths. Dashed edges are conditional,
            feature-gated, or fallback.
          - Bold edges (penwidth=2) are primary invocation paths:
            Frontend -> Runtime, Runtime -> Foundation Model, Gateway ->
            Lambda group.
          - Use `xlabel="..."` for edge labels (OIDC, M2M OAuth2, JWT,
            DCV live view, ApplyGuardrail, S3 event, StartIngestionJob,
            extract_pdf_images, etc.).
          - The S3-event ingest path (Reports S3 -> kb_ingest_lambda)
            MUST be dashed with label "S3 event".

        ICON RULES:
          - Use Custom("<Label>", "icons/<Name>.png") for all custom icons.
          - Orchestrator Runtime + Avatar Runtime both use Runtime.png.
          - Persona Router uses Runtime.png (it is the entry-gate dispatcher
            inside the Orchestrator Runtime, not a strands.Agent instance).
          - Every genuine `strands.Agent()` / `BidiAgent` / built-in tool-
            selector instance uses Strands_Agent.png (the black-square
            twin-strand mark). This applies to: Planner, Researcher,
            Synthesizer, PDF Writer, Menu Designer, Chatbot, BidiAgent,
            Tool Selector.
          - In-process Browser Tools uses Browser_Tool.png (it is a
            bundle of `@tool` helpers, not a strands.Agent).
          - MCP Gateway uses Gateway.png. AgentCore Memory uses Memory.png.
          - Bedrock Guardrails use Policy_Engine_Agentic_Guardrails.png.
          - AgentCore Browser uses Browser_Tool.png.
          - AgentCore Code Interpreter uses Code_Interpreter.png.
          - Cognito uses diagrams.aws.security.Cognito.
          - Lambda groups use diagrams.aws.compute.Lambda.
          - Foundation models use diagrams.aws.ml.Sagemaker (convention
            for Bedrock FMs, since diagrams has no Bedrock class).
          - Legend anchor nodes (l_legend_left/middle/right) do NOT use
            Custom() and do NOT have an icon image. They MUST use
            `diagrams.Node(label, shape="note", ...)` -- see LEGEND
            RULES below for the exact constructor signature. Do not
            use Observability.png or any other icon on these three
            nodes -- icons inflate node height 5-10x and make the
            legend text unreadable.

        NUMBERING RULES:
          - Every node label below is pre-numbered ("N. Name"). Use the
            supplied label string VERBATIM -- do not strip the number,
            do not reformat, do not reassign. The number is authoritative
            and matches the Legend exactly.

        LEGEND RULES:
          - The Legend cluster is a FOOTER BAND with EXACTLY THREE
            sibling nodes: `l_legend_left`, `l_legend_middle`,
            `l_legend_right`. Each node's label is one of the
            multi-line bodies supplied below -- assign verbatim.
          - Inside the Legend cluster, force horizontal side-by-side
            layout by adding invisible SAME-RANK edges between the
            three legend nodes (the `diagrams` library does not forward
            raw `{rank=same; ...}` statements, so we must chain them
            with invisible edges instead):
              l_legend_left   >> Edge(style="invis") >> l_legend_middle
              l_legend_middle >> Edge(style="invis") >> l_legend_right
            This is LOAD-BEARING -- without these chain edges, the
            three bodies stack vertically and the legend becomes
            ~2000 units tall. The cluster MUST include `rank="same"`
            in its graph_attr so Graphviz honors the chain:
              cluster_Legend graph_attr: bgcolor="#FFFFFF",
                pencolor="#D1D5DB", penwidth="1", style="rounded,filled",
                rank="same", rankdir="LR"
          - White fill: bgcolor="#FFFFFF", pencolor="#D1D5DB",
            penwidth=1, style="rounded,filled". Do NOT use grey -- grey
            reads as "dimmed/disabled" and competes with the colored
            architecture clusters above.
          - Each legend node MUST be emitted via the `diagrams.Node`
            constructor (NOT Custom, NOT any icon class). Import it at
            the top of the generated code:
              from diagrams import Node
            Then construct each legend node with the full body as the
            first positional arg and these exact keyword attrs:
              l_legend_left = Node(
                  "▸ LEFT: USER / AUTH / REST API\\n1. User ...",
                  shape="note",
                  fontname="Menlo",
                  fontsize="9",
                  labeljust="l",
                  margin="0.15,0.08",
                  width="2.8",
                  height="4.0",
                  fixedsize="false",
                  image="",
                  imagescale="false",
              )
            The shape="note" renders multi-line labels natively with the
            folded-corner note glyph -- no icon image needed. Setting
            image="" prevents inheritance of any default icon. Setting
            fixedsize="false" lets the node grow to fit the label. Do
            NOT wrap the label in Custom() -- Custom forces shape=none
            and renders an image instead of the text.
          - Every `\\n` below MUST be preserved as a literal newline
            inside the corresponding node label.
          - The three bodies already include a header line prefixed
            with `▸` -- keep that glyph so the section heading is
            visible at small zoom levels.

        LEGEND BODY FOR `l_legend_left` (assign verbatim):
        """
        )
        + legend_left_block
        + dedent(
            """

        LEGEND BODY FOR `l_legend_middle` (assign verbatim):
        """
        )
        + legend_middle_block
        + dedent(
            """

        LEGEND BODY FOR `l_legend_right` (assign verbatim):
        """
        )
        + legend_right_block
        + dedent(
            """

        LABELS (use these as the first arg to every node constructor --
        never emit the alias string as the label, and never strip the
        leading "N. " number prefix):
          {
        """
        )
        + labels_block
        + "\n          }\n"
    )
    return base


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build(context: ResolvedContext) -> ArchitectureSpec:
    flags = context.features
    title = f"Gartner AppDev Research Agent -- Bedrock AgentCore on AWS   (stage: {context.stage})"
    return ArchitectureSpec(
        title=title,
        clusters=_build_clusters(flags),
        nodes=_build_nodes(flags),
        edges=_build_edges(flags),
        extra_prompt=_build_extra_prompt(flags),
    )


# ---------------------------------------------------------------------------
# CLI -- quick introspection (no Bedrock call)
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Build and preview the research-agent architecture spec.",
    )
    parser.add_argument("--cdk-json", default=None)
    parser.add_argument("--stage", default="dev")
    parser.add_argument(
        "--section",
        choices=("all", "clusters", "nodes", "edges", "extra", "legend"),
        default="all",
    )
    args = parser.parse_args(argv)

    from cdk_inspector import load_context

    ctx = load_context(args.cdk_json, args.stage)
    spec = build(ctx)

    if args.section in ("all", "clusters"):
        print("=== CLUSTERS ===")
        print(spec.clusters)
        print()
    if args.section in ("all", "nodes"):
        print("=== NODES ===")
        print(spec.nodes)
        print()
    if args.section in ("all", "edges"):
        print("=== EDGES ===")
        print(spec.edges)
        print()
    if args.section in ("all", "legend"):
        print("=== LEGEND ===")
        numbers = _build_number_map(ctx.features)
        print(f"Rendered aliases: {len(numbers)}")
        print(_build_legend_text(ctx.features))
        print()
    if args.section in ("all", "extra"):
        print("=== EXTRA PROMPT ===")
        print(spec.extra_prompt)
    return 0


if __name__ == "__main__":  # pragma: no cover
    import sys

    sys.exit(_main(sys.argv[1:]))
