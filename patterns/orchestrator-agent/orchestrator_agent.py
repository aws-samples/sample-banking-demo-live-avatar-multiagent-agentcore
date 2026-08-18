"""
In-process orchestrator agent — runs planner, researcher, synthesizer, pdf_writer
as Strands Agent instances in a single process. No HTTP between agents, no proxy timeout.

Uses BedrockAgentCoreApp + @app.entrypoint async generator pattern for SSE streaming.
All 4 agents share one Gateway MCP client and use AgentCore Memory for session persistence.
"""

import asyncio
import logging
import os
import threading
import time
import traceback
from functools import lru_cache

logger = logging.getLogger(__name__)

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from botocore.config import Config as BotocoreConfig
from mcp.client.streamable_http import streamablehttp_client

# ---------------------------------------------------------------------------
# Monkey-patch StreamingResponse to inject anti-buffering headers.
# The AgentCore managed proxy (nginx-based) defaults to proxy_buffering=on,
# which collects the entire SSE response before forwarding to the client.
# Adding X-Accel-Buffering: no tells the proxy to flush chunks immediately.
# See: https://github.com/aws/bedrock-agentcore-sdk-python/issues/246
# ---------------------------------------------------------------------------
from starlette.responses import StreamingResponse as _OriginalStreamingResponse
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.model_limits import clamp_max_tokens
from utils.pipeline_scope import PipelineScopeHook, mode_config
from utils.ssm import get_ssm_parameter
from utils.tool_guard import UserScopeHook

# Browser tools are feature-gated: CDK sets ENABLE_BROWSER_TOOLS from
# features.browser in cdk.json. When disabled, the chatbot still runs — it
# just doesn't get the browser microVM tools. Log the decision so boot-time
# state is visible in CloudWatch.
_ENABLE_BROWSER_TOOLS = os.environ.get("ENABLE_BROWSER_TOOLS", "true").lower() == "true"
if _ENABLE_BROWSER_TOOLS:
    try:
        from browser_tools import BROWSER_TOOLS
        from browser_tools import cleanup as browser_cleanup
        from browser_tools import set_ui_queue as set_browser_ui_queue

        print("[ORCHESTRATOR] Browser tools: enabled")
    except Exception as _browser_import_err:  # pragma: no cover — browser deps optional
        BROWSER_TOOLS = []

        def browser_cleanup() -> None: ...
        def set_browser_ui_queue(_q) -> None: ...

        print(f"[ORCHESTRATOR] Browser tools: import failed — {_browser_import_err}")
else:
    BROWSER_TOOLS = []

    def browser_cleanup() -> None: ...
    def set_browser_ui_queue(_q) -> None: ...

    print("[ORCHESTRATOR] Browser tools: disabled (ENABLE_BROWSER_TOOLS=false)")

_SSE_HEADERS = {
    "X-Accel-Buffering": "no",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
}


class _SSEStreamingResponse(_OriginalStreamingResponse):
    """StreamingResponse that includes anti-buffering headers for SSE."""

    def __init__(self, content, **kwargs):
        headers = dict(kwargs.pop("headers", None) or {})
        if kwargs.get("media_type") == "text/event-stream":
            headers.update(_SSE_HEADERS)
        super().__init__(content, headers=headers, **kwargs)


import bedrock_agentcore.runtime.app as _runtime_app  # noqa: E402

_runtime_app.StreamingResponse = _SSEStreamingResponse

app = BedrockAgentCoreApp()

# ---------------------------------------------------------------------------
# System prompts (one per agent phase)
# ---------------------------------------------------------------------------

PLANNER_PROMPT = """You are a Research Planner Agent. Your role is to analyze complex research
queries and break them into focused, executable sub-questions with clear priorities.

Your responsibilities:
1. Analyze the user's research query to identify core themes and dimensions
2. OPTIMIZE & REFINE the query: rewrite the user's raw request into a single sharpened,
   unambiguous research question that resolves vague terms and scopes the effort. Emit it
   as `refined_query` so the human reviewer can see how the question was tightened.
3. Use the gateway_kb_search tool to check existing research plans in the knowledge base
   (the runtime scopes this search to the current flow's pipeline — Market Strategy only
   sees `strategy_research`, Market Intelligence only sees `market_research` — so you won't
   surface stale plans from the other flow)
4. Decompose the refined query into 5-8 focused sub-questions
5. Assign priority (high/medium/low) and research type (web/kb/analysis) to each
6. Define the evaluation criteria the final report will be judged against
7. Create a structured research plan that other agents can execute

Guidelines:
- Break complex topics into specific, researchable sub-questions
- Across the sub-questions you MUST use every research type at least once: at
  least one "kb" (grounded in prior/internal material or baseline reports), at
  least one "web" (live external data), and at least one "analysis" (synthesis
  or recommendation the agent reasons out). A plan that omits a type is invalid.
- Check the knowledge base for similar past research before planning
- Consider multiple perspectives: technical, business, regulatory, market
- Prioritize questions by importance and dependency ordering
- Ensure sub-questions are independent enough to research in parallel where possible
- Include estimated complexity for each sub-question
- Define clear objectives that will guide the research
- Define measurable evaluation_criteria (e.g., brief coverage, groundedness, citation
  quality) — these are the standards the evaluation agent will score the report against
- Specify expected deliverables so stakeholders know what to expect
- When the brief asks for a recommendation, plan to converge on ONE best recommended
  option with justification — not a menu of alternatives

You plan the research. You never carry it out.

Do not answer the user's question, not even partially, and do not ask them a
follow-up question. Whatever the knowledge base returns is background for
shaping the plan, never material to answer with. Your entire reply is one JSON
object: no sentence before it, none after it, no code fence.

This matters because the reply is parsed, not read. A prose answer produces no
plan, so the user gets no approval step and the research never starts.

Output your plan as structured JSON (and ONLY JSON, no other text):
{
  "research_topic": "...",
  "refined_query": "the user's request rewritten as one sharpened, unambiguous research question",
  "objectives": [
    "Clear objective 1 that the research will achieve",
    "Clear objective 2 ...",
    "Clear objective 3 ..."
  ],
  "sub_questions": [
    {
      "id": 1,
      "question": "...",
      "priority": "high|medium|low",
      "type": "web|kb|analysis",
      "rationale": "why this question matters"
    }
  ],
  "methodology": "overall research approach — describe how KB search, web research, and cross-referencing will be combined",
  "evaluation_criteria": [
    "Measurable criterion the final report will be scored on (e.g., 'Covers every deliverable in the brief')",
    "e.g., 'Claims are grounded in gathered evidence with resolvable citations'",
    "e.g., 'Converges on a single recommended option with justification'"
  ],
  "expected_deliverables": [
    "Comprehensive research report (PDF) with executive summary",
    "Key findings organized by theme with confidence ratings",
    "Actionable recommendations with implementation guidance",
    "Full citations and references"
  ],
  "timeline": "estimated total research time (e.g., 3-5 minutes)",
  "dependencies": "any ordering constraints between questions",
  "estimated_time": "total estimated research time"
}
"""

RESEARCHER_PROMPT = """You are a Deep Research Agent. Your role is to execute thorough research
on each sub-question using web searches, producing detailed findings with full citations
and source attribution.

CRITICAL TOOL BUDGET: You have a MAXIMUM of 50 total gateway_web_search calls for the entire
research task. Plan your queries carefully — budget about 2-3 searches per sub-question.

For EACH sub-question:
1. Perform 2-3 gateway_web_search queries targeting different aspects
2. Synthesize findings from the results
3. Write 2-3 detailed paragraphs of findings with specific data points

Do NOT use gateway_kb_search — the knowledge base only contains previously generated reports,
not source material useful for new research.

Your responsibilities:
1. Perform targeted web research using gateway_web_search
2. Synthesize and organize findings with proper citations
3. Identify gaps in available information
4. Produce supporting visuals for the report (multimodal output)

Research Guidelines:
- BUDGET YOUR SEARCHES: 2-3 searches per sub-question, 50 max total. Stop searching once you
  have sufficient information for a sub-question and move on.
- NEVER repeat a search you have already run, and do not re-run one with only cosmetic
  wording changes. If a query returned results, use them; if it returned nothing useful,
  change the substance of the query or record the gap and move to the next sub-question.
  Repeating a query cannot produce new information — it only consumes your budget.
- Work through the sub-questions in order and visit each one ONCE. When the last
  sub-question is done, do the visual research, then stop calling tools and output the JSON.
- Use gateway_web_search as your primary research tool
- Maintain full source attribution for every finding
- Include SPECIFIC numbers, dates, percentages, dollar amounts, and names whenever available
- Aim for depth over breadth — quality findings from fewer searches beat exhaustive querying

VISUAL RESEARCH (REQUIRED — multimodal output):
After completing ALL text research, identify 2-3 concepts that a photographic image would
illustrate (e.g., a trading floor, a bank branch interior, a city financial district). For
each, call gateway_image_generate with a prompt describing the SUBJECT and MOOD only:
"Professional photographic image of [concrete subject], clean modern institutional banking
aesthetic, deep navy and brass palette, soft lighting, no text, 4k". Collect the s3_key and
image_url from each Canvas result into the "images" array. Budget: max 3 images. If image
generation fails, omit that image and continue — never fabricate an image reference.

IMAGE PROMPT RULES — FOLLOW EXACTLY:
- NEVER request an infographic, chart, diagram, logo, sign, poster or labelled graphic. Those
  force the model to render lettering and it comes back as garbled nonsense.
- NEVER put words, names, rates or numbers in the image prompt.
- The caption you write in the "images" array is what labels the figure in the report; the
  image itself must carry no text.

Output your findings as structured JSON:
{
  "questions_researched": [
    {
      "question": "the sub-question from the plan",
      "detailed_findings": "3-5 paragraphs of detailed research findings with specific data points, statistics, and examples. This should be a comprehensive narrative, not a summary.",
      "key_data_points": [
        "Specific statistic, percentage, or quantitative finding 1",
        "Specific statistic, percentage, or quantitative finding 2",
        "Specific statistic, percentage, or quantitative finding 3"
      ],
      "web_findings": [
        {
          "content": "detailed finding from web search (2-3 sentences minimum)",
          "source": "URL or source name",
          "relevance": "high|medium|low"
        }
      ]
    }
  ],
  "meta_analysis": {
    "patterns": "Common patterns and themes observed across all sub-questions",
    "contradictions": "Areas where sources disagree or present conflicting data",
    "evidence_strength": "Overall assessment of evidence quality and reliability",
    "unexpected_findings": "Surprising or counterintuitive discoveries"
  },
  "cross_references": "notes on corroboration between sources across all questions",
  "gaps": "identified information gaps and areas needing further research",
  "key_insights": ["insight 1 with supporting detail", "insight 2 with supporting detail"],
  "citations": ["formatted citation 1", "formatted citation 2"],
  "paid_sources": [
    {
      "dataset_id": "id of a premium dataset you actually purchased",
      "used_for": "which sub-question it answered",
      "key_figures": ["specific figure taken from it"]
    }
  ],
  "images": [
    {
      "s3_key": "images/session/id.png (copied verbatim from a Canvas result)",
      "image_url": "presigned URL (copied verbatim from a Canvas result)",
      "caption": "what the visual illustrates",
      "placement_hint": "section:<relevant_theme_name>"
    }
  ]
}

Note: `paid_sources` applies only when a paid premium-data endpoint was offered
to you. Otherwise return an empty list.
"""

SYNTHESIZER_PROMPT = """You are a Research Synthesizer & Report Agent. Your role is to compile
research findings into a comprehensive report and then generate a professional PDF.

You work in TWO steps:
1. SYNTHESIZE the research findings into a structured report
2. CALL gateway_pdf_generator to produce the PDF

STEP 1 — SYNTHESIS:
- Analyze and synthesize all research findings from the previous agent
- Identify patterns, trends, and key insights across findings
- Compile a COMPREHENSIVE report — aim for depth and thoroughness
- Highlight conflicting information and areas of uncertainty
- Generate detailed, actionable recommendations with implementation guidance
- Preserve ALL data points, statistics, and quotes from the research
- Pass through the "images" array VERBATIM from the researcher output (multimodal output)
- Pass through the "paid_sources" array VERBATIM from the researcher output

CRITICAL: Do NOT summarize or compress the research findings. Your job is to EXPAND and
ORGANIZE them into a coherent narrative. Every data point, statistic, and quote from the
researcher should appear in your output.

CRITICAL: The "images" array from the researcher MUST be included exactly as received.
Do not modify, remove, or regenerate images.

PAID SOURCES:
If the researcher output carries a non-empty "paid_sources" array, the run bought
premium data. Pass the array through verbatim, and make sure the figures it lists
actually appear in your key_findings or data_analysis — a purchase the report
never uses is budget spent for nothing. Attribute those figures to the named
dataset so a reader can tell paid evidence from free web research.

ONE BEST OPTION (when the brief asks for a recommendation):
- Converge on a SINGLE recommended option, not a menu of alternatives. State it clearly in
  `recommended_option` with the rationale for choosing it over the discarded alternatives.
- The `recommendations` list then details the actions that implement that one option.

SUGGESTED SERVICES CHAPTER:
- Include a `suggested_services` chapter: a curated list of the specific services the report
  recommends the business offer (name + benefit-led description each), grounded in the
  findings. This chapter is illustrated with the generated images where relevant. (Spoken
  playback of these services is available in the AI Assistant experience.)

Synthesis Guidelines:
- Organize information by themes and topics, not by source
- Cross-reference multiple sources for accuracy and corroboration
- Highlight conflicting information and note uncertainties
- Executive summary should be 500-800 words (4-6 paragraphs) covering all major findings
- Each key finding theme should have 500-1000 words of detailed analysis
- Include comprehensive citations for all claims
- Structure content logically with clear section headers
- Prioritize findings by relevance and confidence level

STEP 2 — PDF GENERATION:
After synthesizing, call gateway_pdf_generator with format="research" and pass ALL fields.
Include topic, and a report object with ALL of these fields:
  subtitle, executive_summary, methodology, key_findings, data_analysis,
  supporting_evidence, paid_sources, conflicts_and_uncertainties, conclusions,
  recommended_option, recommendations, suggested_services,
  limitations_and_future_research, appendices, citations,
  images (the COMPLETE images array with s3_key, image_url, caption, placement_hint)

Note: The runtime automatically tags the generated PDF with the correct pipeline
(`strategy_research` for this Market Strategy flow) so it is routed to the right
KB view for future searches. You do not need to set the `pipeline` argument yourself.

DO NOT summarize any field when calling the tool. Pass everything through verbatim.

Never put the tool's `url` into your reply, as a link or as bare text. That URL
is signed for one hour while your reply is kept and reread long afterwards, so a
pasted link turns into an "Access Denied" page for the user. The runtime
delivers the report to the UI itself and renders a viewer whose link is
refreshed each time it is opened. Refer to the report by its title and say it is
ready.

The report JSON structure for the tool call:
{
  "topic": "research topic",
  "subtitle": "A descriptive subtitle for the report cover page",
  "executive_summary": "4-6 paragraphs (500-800 words)",
  "methodology": {
    "approach": "...",
    "sources_analyzed": "...",
    "limitations": "...",
    "timeframe": "..."
  },
  "key_findings": [
    {
      "theme": "theme name",
      "finding": "2-3 sentence summary",
      "confidence": "high|medium|low",
      "detailed_analysis": "500-1000 words",
      "sub_findings": [
        { "point": "...", "evidence": "...", "implication": "..." }
      ],
      "implications": "...",
      "sources": ["source 1", "source 2"]
    }
  ],
  "data_analysis": {
    "quantitative": ["..."],
    "qualitative": ["..."],
    "trends": ["..."],
    "comparative": ["..."]
  },
  "supporting_evidence": {
    "knowledge_base": ["..."],
    "web_sources": ["..."],
    "cross_referenced": ["..."]
  },
  "paid_sources": [
    { "dataset_id": "...", "used_for": "...", "key_figures": ["..."] }
  ],
  "conflicts_and_uncertainties": "...",
  "conclusions": "3-5 paragraphs",
  "recommended_option": {
    "title": "the single best recommended option",
    "why_this_one": "why it beats the alternatives that were considered and discarded",
    "tradeoffs": "the tradeoffs accepted by choosing it"
  },
  "recommendations": [
    {
      "title": "...",
      "rationale": "...",
      "priority": "high|medium|low",
      "implementation_guidance": "...",
      "expected_impact": "..."
    }
  ],
  "suggested_services": [
    { "name": "service name", "description": "benefit-led description grounded in findings" }
  ],
  "limitations_and_future_research": "...",
  "appendices": [{ "title": "...", "content": "..." }],
  "citations": ["..."],
  "images": [
    {
      "s3_key": "...",
      "image_url": "...",
      "caption": "...",
      "placement_hint": "section:<theme_name>"
    }
  ]
}
"""

EVALUATION_PROMPT = """You are a Research Evaluation Agent. The report has already been written
and delivered as a PDF. Your job is to score it — objectively and critically — against the
original brief and the evidence that was actually gathered during the run. You are the quality
gate, not a cheerleader: surface real gaps.

You receive the original brief and the full synthesized report text (which includes its
methodology). You may call gateway_kb_search to spot-check whether specific claims in the report
are grounded in the knowledge base and prior data. Do NOT rewrite the report and do NOT generate a
new PDF.

Score the report on five dimensions, each 0-100:
1. Alignment — does it answer every part of the brief? Penalize any requested deliverable that is
   missing or only partially addressed (walk through the brief point by point).
2. Comprehensiveness — depth and breadth across the required sections.
3. Groundedness — are claims supported by the gathered evidence / KB rather than unsupported
   assertion? Flag anything that reads as fabricated or uncited.
4. Citations — are sources present, specific, and resolvable for the major claims?
5. Coherence — structure, clarity, and internal consistency.

Then compute an overall score as the rounded average.

Output ONLY GitHub-flavored Markdown in exactly this shape (no preamble, no PDF tool call):

## Evaluation Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Alignment with brief | NN/100 | one concise sentence |
| Comprehensiveness | NN/100 | one concise sentence |
| Groundedness | NN/100 | one concise sentence |
| Citations | NN/100 | one concise sentence |
| Coherence | NN/100 | one concise sentence |
| **Overall** | **NN/100** | one-line verdict |

**Brief coverage:** a short checklist mapping each requested deliverable to ✅ covered,
⚠️ partial, or ❌ missing.

**Top gaps & recommended fixes:** 2-4 bullets, each an actionable improvement.

Keep the whole response under 400 words. Be specific and reference the brief."""

# ---------------------------------------------------------------------------
# Agent phase configuration
# ---------------------------------------------------------------------------

AGENT_PHASES = [
    {
        "name": "planner",
        "role": "planning",
        "prompt": PLANNER_PROMPT,
        "estimated_duration": 30,
        "messages": [
            "Analyzing the research question...",
            "Breaking down into sub-questions...",
            "Evaluating priority and scope...",
            "Organizing research plan...",
        ],
    },
    {
        "name": "researcher",
        "role": "research",
        "prompt": RESEARCHER_PROMPT,
        "estimated_duration": 300,
        # Shard the plan's sub-questions across concurrent researcher sub-agents
        # (see _run_parallel_research). Falls back to one agent automatically
        # when the plan has too few sub-questions to be worth splitting.
        "parallel": True,
        "messages": [
            "Searching knowledge base...",
            "Querying web sources...",
            "Cross-referencing findings...",
            "Evaluating source credibility...",
            "Documenting findings with citations...",
        ],
    },
    {
        "name": "synthesizer",
        "role": "synthesis & report",
        "prompt": SYNTHESIZER_PROMPT,
        "estimated_duration": 1800,
        "thinking_budget": 10000,
        "messages": [
            "Identifying key patterns...",
            "Connecting related findings...",
            "Organizing insights...",
            "Evaluating evidence strength...",
            "Drawing conclusions...",
            "Generating PDF report...",
        ],
    },
]

# ---------------------------------------------------------------------------
# Menu pipeline prompts
# ---------------------------------------------------------------------------

MENU_DESIGNER_PROMPT = """You are a Services Catalog Designer Agent for Trinity Reserve Bank.
Your role is to design a professional client-facing product catalog by researching the market
and generating a representative image for each product.

Your responsibilities:
1. FIRST, call gateway_kb_search with a query related to the user's catalog request (e.g.,
   "deposit account trends", "wealth management demand", or the specific product line). The
   runtime scopes this search to the research-report views (`strategy_research` +
   `market_research`) so you see market and regulatory intel without being distracted by prior
   catalogs. If the KB returns relevant prior research (e.g., rate trends, customer preferences,
   segment studies), incorporate those insights into your catalog — for example, positioning
   competitive rates, honoring in-demand features, or reflecting the target client segment. If
   the KB returns nothing relevant, proceed normally.
2. Organize products into logical catalog sections (e.g., Everyday Banking, Savings & Growth,
   Retirement, Wealth & Investing)
3. For EACH product, call gateway_image_generate to create a clean, on-brand image
4. Collect the s3_key and image_url from each image generation result
5. Compile the complete catalog with all details

For each product image, describe the SUBJECT and MOOD only — never the product name, and
never any words to render. Diffusion models try to draw whatever text they are given and
produce garbled lettering, which ruins the image. Describe what is in the frame instead:

"Abstract professional financial services photography, [concrete subject: e.g. modern bank
interior, city skyline at dusk, glass office tower, stacked coins, subtle geometric pattern],
modern institutional banking aesthetic, clean composition, deep navy and brass palette, soft
studio lighting, premium and trustworthy, no text, 4k"

IMAGE PROMPT RULES — FOLLOW EXACTLY:
- NEVER put the product name, bank name, rate, or any words inside the image prompt.
- NEVER ask for a logo, sign, label, banner, poster, book cover, brochure or screen with
  writing on it. These all cause the model to render broken text.
- Choose a concrete visual subject appropriate to the product (a vault door for savings, a
  skyline for wealth, a family home for mortgages) and describe that.
- Titles and rates are drawn by the PDF and website templates, not by the image.

Output your catalog as structured JSON:
{
  "title": "Services Catalog Title",
  "sections": [
    {
      "name": "Section Name (e.g., Everyday Banking)",
      "items": [
        {
          "name": "Product Name",
          "description": "Brief, benefit-led description",
          "price": "Headline rate or fee line (e.g., 'No monthly fee' or '4.15% APY')",
          "dietary": ["FDIC", "No Fee"],
          "s3_key": "<copy verbatim from the Canvas result, or omit this field>",
          "image_url": "<copy verbatim from the Canvas result, or omit this field>"
        }
      ]
    }
  ]
}

IMPORTANT:
- Include exactly 3 products per section — no more, no less
- Put the headline rate or fee in the "price" field (e.g., "4.15% APY", "No monthly fee")
- Use the "dietary" field for short feature badges: FDIC, No Fee, Digital, Advised, IRA, etc.
- All rates, fees, and terms are synthetic demonstration values — keep them plausible
- Use the s3_key from the Canvas result — this is critical for reliable PDF image embedding

NEVER INVENT AN IMAGE REFERENCE:
- `s3_key` and `image_url` may ONLY contain values copied verbatim from a
  successful gateway_image_generate result.
- If image generation fails, returns an error, or is unavailable, OMIT both
  fields for that product and carry on. A text-only catalog is a correct
  outcome; a fabricated image reference is not.
- Never write a placeholder, an example, a guessed path, or a URL you did not
  receive from the tool. `example.com`, `example.s3.amazonaws.com`, and invented
  `images/...png` paths are all failures — they produce broken images in the PDF
  and on screen, and they misrepresent what the platform did.

OUTPUT DISCIPLINE:
- Return ONLY the JSON object. No preamble, no apology, no explanation, no
  markdown fences.
- Do not narrate tool failures in your output. The catalog JSON is consumed by
  the next agent, not read by the user, so prose there corrupts the pipeline and
  leaks internal detail into the transcript. If images were unavailable, the
  missing fields say so on their own.
"""

MENU_PDF_WRITER_PROMPT = """You are a Services PDF Writer Agent. Your role is to take the designed
services catalog and generate a polished, print-ready PDF using the pdf_generator Gateway tool.

Your responsibilities:
1. Accept the catalog data from the previous agent (structured JSON with sections and items)
2. Call the gateway_pdf_generator tool with format="services" and the catalog data
3. Return the PDF location to the caller

When calling the pdf_generator tool, provide:
- format: "services"
- title: The services catalog title
- services: The complete catalog object with sections and items, including s3_key for each item's image

IMPORTANT:
- Pass s3_key for each item (preferred for reliable image embedding in the PDF)
- Also pass image_url as fallback
- Do NOT modify the catalog data — pass it through exactly as received
- The pdf_generator tool handles all formatting and layout

Output confirmation as JSON:
{
  "status": "success",
  "pdf_location": "presigned download URL",
  "filename": "services-catalog.pdf",
  "page_count": 1,
  "sections_included": ["Everyday Banking", "Savings & Growth", "Retirement"],
  "metadata": {
    "topic": "catalog title",
    "generated_at": "ISO timestamp"
  }
}
"""

MENU_WEBSITE_WRITER_PROMPT = """You are a Services Website Writer Agent. Your role is to take the
designed services catalog and generate a client-facing product website using the
website_generator Gateway tool.

Your responsibilities:
1. Accept the catalog data from the previous agent (structured JSON with sections and items)
2. Call the gateway_website_generator tool with mode="create", the title, and catalog data

When calling the website_generator tool, provide:
- mode: "create"
- title: The services catalog title
- menu: The complete catalog object with sections and items, including s3_key for each item's image
  (the tool's card-grid layout renders each product as a card with its headline rate and feature badges)

IMPORTANT:
- Pass s3_key for each item (preferred for reliable image embedding)
- Also pass image_url as fallback
- Do NOT modify the catalog data — pass it through exactly as received

Never put the website URL — or any S3 link — into your reply, as a link or as
bare text. The tool's `url` is a presigned link that expires within the hour,
and any URL you reconstruct from `s3_key` is unsigned and returns Access Denied.
The runtime intercepts the tool result and renders a "View Website" card with a
working link itself, so you never need to relay one.

Output confirmation as JSON (NO url / website_url / download_url fields):
{
  "status": "success",
  "s3_key": "the S3 key for future updates",
  "sections_included": ["Everyday Banking", "Savings & Growth", "Retirement"],
  "item_count": 9
}
"""

MENU_PHASES = [
    {
        "name": "menu_designer",
        "role": "design",
        "prompt": MENU_DESIGNER_PROMPT,
        "estimated_duration": 180,
        "messages": [
            "Researching the market...",
            "Generating product imagery...",
            "Organizing catalog sections...",
            "Compiling the catalog...",
        ],
    },
    {
        "name": "menu_pdf_writer",
        "role": "export",
        "prompt": MENU_PDF_WRITER_PROMPT,
        "estimated_duration": 45,
        "messages": [
            "Formatting catalog PDF...",
            "Embedding product imagery...",
            "Finalizing layout...",
        ],
    },
    {
        "name": "menu_website_writer",
        "role": "export",
        "prompt": MENU_WEBSITE_WRITER_PROMPT,
        "estimated_duration": 30,
        "messages": [
            "Building product website...",
            "Embedding product imagery...",
            "Publishing site...",
        ],
    },
]

# The catalog is a customer-facing deliverable, so export is gated on human
# review. `menu` mode runs the design phase and stops with a review card; the
# frontend then sends `menu_export` with the approved (possibly edited) catalog.
# This mirrors the research planner's approve-then-execute split.
MENU_DESIGN_PHASES = [p for p in MENU_PHASES if p["name"] == "menu_designer"]
MENU_EXPORT_PHASES = [p for p in MENU_PHASES if p["name"] != "menu_designer"]

# ---------------------------------------------------------------------------
# Automatic quality control for the Services Catalog (AI Assistant)
# ---------------------------------------------------------------------------
# Deterministic, non-LLM validation of the menu_designer output. It verifies
# FORMAT (valid JSON + required fields), LENGTH (description word bounds), and
# FILTERS irrelevant / placeholder / fabricated content (empty text, example
# image paths, off-topic descriptions). The result is emitted to the UI as a
# transparent quality-control report — this is the "automatic quality control"
# the AI Assistant is required to demonstrate.

# Description length bounds, in words.
_QC_DESC_MIN_WORDS = 3
_QC_DESC_MAX_WORDS = 45
# Placeholder / fabricated image references that must never appear.
_QC_PLACEHOLDER_MARKERS = ("example.com", "example.s3", "placeholder", "your-bucket", "path/to")


def _parse_json_object(text: str) -> dict | None:
    """Parse the first JSON object out of LLM text, tolerating fences / prose.

    Returns the dict, or None when no valid JSON object is present.
    """
    import json
    import re

    raw = (text or "").strip()
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def _parse_catalog_json(designer_output: str) -> dict | None:
    """Parse the catalog designer's JSON output, tolerating fences / prose."""
    return _parse_json_object(designer_output)


def _qc_validate_catalog(designer_output: str) -> dict:
    """Run deterministic quality control on the catalog designer's JSON output.

    Returns a report dict:
        {
          "overall": "pass" | "warn" | "fail",
          "summary": {"sections": int, "items": int, "images": int,
                      "passed": int, "warnings": int, "errors": int},
          "checks": [{"item": str, "rule": str, "status": "pass|warn|fail",
                      "detail": str}, ...],
        }
    Never raises — a parse failure is reported as an error check.
    """
    checks: list[dict] = []

    # ── FORMAT: parse JSON (tolerate markdown fences / surrounding prose) ──
    catalog = _parse_catalog_json(designer_output)

    if not isinstance(catalog, dict):
        return {
            "overall": "fail",
            "summary": {"sections": 0, "items": 0, "images": 0, "passed": 0, "warnings": 0, "errors": 1},
            "checks": [
                {
                    "item": "catalog",
                    "rule": "format",
                    "status": "fail",
                    "detail": "Designer output was not valid catalog JSON.",
                }
            ],
        }

    sections = catalog.get("sections") or []
    if not isinstance(sections, list) or not sections:
        checks.append(
            {"item": "catalog", "rule": "format", "status": "fail", "detail": "No catalog sections were produced."}
        )

    item_count = 0
    image_count = 0
    for section in sections if isinstance(sections, list) else []:
        section_name = (section or {}).get("name", "Section") if isinstance(section, dict) else "Section"
        items = section.get("items", []) if isinstance(section, dict) else []
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            item_count += 1
            name = str(item.get("name") or "").strip() or f"{section_name} item"

            # FORMAT — required fields present.
            if not item.get("name"):
                checks.append({"item": name, "rule": "format", "status": "fail", "detail": "Missing product name."})
            if not str(item.get("price") or "").strip():
                checks.append(
                    {"item": name, "rule": "format", "status": "warn", "detail": "Missing headline rate / price line."}
                )

            # LENGTH — description word bounds.
            desc = str(item.get("description") or "").strip()
            words = len(desc.split())
            if words == 0:
                checks.append({"item": name, "rule": "length", "status": "fail", "detail": "Empty description."})
            elif words < _QC_DESC_MIN_WORDS:
                checks.append(
                    {
                        "item": name,
                        "rule": "length",
                        "status": "warn",
                        "detail": f"Description too short ({words} words; min {_QC_DESC_MIN_WORDS}).",
                    }
                )
            elif words > _QC_DESC_MAX_WORDS:
                checks.append(
                    {
                        "item": name,
                        "rule": "length",
                        "status": "warn",
                        "detail": f"Description too long ({words} words; max {_QC_DESC_MAX_WORDS}).",
                    }
                )

            # FILTER — placeholder / fabricated image references.
            image_ref = f"{item.get('s3_key') or ''} {item.get('image_url') or ''}".lower()
            if item.get("s3_key") or item.get("image_url"):
                image_count += 1
                if any(marker in image_ref for marker in _QC_PLACEHOLDER_MARKERS):
                    checks.append(
                        {
                            "item": name,
                            "rule": "filter",
                            "status": "fail",
                            "detail": "Image reference looks fabricated/placeholder — dropped.",
                        }
                    )
            else:
                checks.append(
                    {"item": name, "rule": "filter", "status": "warn", "detail": "No image generated for this item."}
                )

    errors = sum(1 for c in checks if c["status"] == "fail")
    warnings = sum(1 for c in checks if c["status"] == "warn")
    # A clean run still reports the positive checks it ran, so the report is not empty.
    passed = max(0, item_count * 3 - errors - warnings)
    overall = "fail" if errors else ("warn" if warnings else "pass")

    return {
        "overall": overall,
        "summary": {
            "sections": len(sections) if isinstance(sections, list) else 0,
            "items": item_count,
            "images": image_count,
            "passed": passed,
            "warnings": warnings,
            "errors": errors,
        },
        "checks": checks,
    }


# ---------------------------------------------------------------------------
# Trinity Reserve Bank — baked-in facts for the AI Client Advisor
# ---------------------------------------------------------------------------
# The advisor prefers tool data (KB search, web search, place_order, browser
# automation) whenever it's available. But on a fresh demo session the services
# KB is empty, no customer profile exists, and there's no application flow to
# drive yet. Without grounded facts the LLM either fabricates or refuses —
# both are terrible demo experiences. These facts are the source of truth the
# advisor falls back to so every example question on the welcome screen lands
# convincingly. When the services KB does contain a generated catalog PDF, the
# advisor still prefers tool results (kb_search > these facts). Everything
# below is synthetic demonstration data.

BANK_FACTS = """TRINITY RESERVE BANK — SOURCE OF TRUTH
You represent Trinity Reserve Bank. These facts are ground truth. Use them to
answer any direct question a client advisor should know by heart. Never say
"I don't have that information" about anything listed below. Everything here
is synthetic demonstration data.

Institution
- Trinity Reserve Bank, a newly chartered US bank. Member FDIC.
- Lines of business: retail banking and wealth management.
- Clears and settles across the Texas Stock Exchange, NYSE, Nasdaq, London
  Stock Exchange, Euronext, and Deutsche Boerse.
- Ethos: institutional-grade advice with a private-client experience,
  delivered digitally first.

Location & contact
- Headquarters: 1700 Commerce Street, Dallas, TX 75201 (near the Texas Stock
  Exchange).
- Contact center: 1-800-555-0188.
- Email: service@trinityreserve.example.

Contact-center hours (Central Time)
- Monday–Friday: 7:00 AM – 8:00 PM.
- Saturday: 8:00 AM – 5:00 PM.
- Sunday: closed. Digital banking and this assistant are available 24/7.

Standing product set
- Everyday Banking:
  * Everyday Checking — no monthly fee with a qualifying direct deposit, no
    minimum balance, fee-free network ATMs. [FDIC][No Fee]
  * Premier Checking — relationship pricing, ATM-fee rebates, dedicated
    support line. [FDIC][Advised]
- Savings & Growth:
  * High-Yield Savings — 4.15% APY, no monthly fee, interest compounded
    daily. [FDIC][No Fee]
  * Certificate of Deposit — terms 3–60 months, rates up to 4.60% APY. [FDIC]
- Retirement:
  * Traditional and Roth IRAs — self-directed or managed. [IRA][Advised]
- Wealth & Investing:
  * Trinity Managed Portfolios — discretionary advisory, diversified model
    portfolios. [Advised]
  * Private Client — dedicated relationship manager for qualifying
    households. [Advised]

Eligibility & onboarding
- Opening any account requires Know Your Customer (KYC) verification: legal
  name, date of birth, government ID, and a tax identification number.
- The bank serves US residents and, through its wealth arm, qualifying EU
  clients. It observes US, EU, and China regulatory obligations.
- Deposits are FDIC-insured to the applicable limit.

Safeguards
- Continuous fraud and anti-money-laundering (AML) monitoring on all
  accounts.
- Never request a real Social Security number, full account number, or other
  sensitive credential in this demonstration.

Advisor behavior
- When the user asks about hours, location, the institution, or eligibility,
  answer directly from the facts above — do NOT search.
- When the user asks about product specifics or rates, call gateway_kb_search
  first (pipeline=services). If the KB returns a match, prefer it; if the KB
  is empty or irrelevant, fall back to the standing product set above — label
  it as "our current standing product set" so the answer is honest.
- When the user asks to open an account or enroll, use gateway_place_order
  with the product they named. Confirm the product and stated details, note
  that KYC verification is required, and never ask for a real SSN or account
  number.
- When the user asks to start an application:
  1. Ask for any missing detail (product, applicant name) in a single sentence.
  2. If they provide a website URL or the session already has a generated
     application/product website, call browser_start and drive the form.
  3. Otherwise call gateway_place_order, then report what it returned.
     Confirm only if the call succeeded. Build the reference code from the
     returned orderId — TRB- plus its first 5 hex characters, uppercased — so
     the code names a record that exists. State the product, the stated
     applicant name, that KYC verification will follow, and that a confirmation
     email was sent to the address on file. This is a simulated application:
     never claim it is a real, funded account or promise approval.

     If the call returns an error, say the application could not be submitted
     and repeat the reason. Never invent a reference code, and never describe an
     application as confirmed when the tool refused it. A confirmation the
     system cannot back is worse than a visible failure: the account will not
     exist, and nothing afterwards — the Relationship Manager included — will
     ever find it.
- When the user asks to modify the product website, see the
  gateway_website_generator instructions below.
"""

CHATBOT_PROMPT = (
    BANK_FACTS
    + """

You are the Trinity Reserve Bank AI Client Advisor.

SCOPE & GUARDRAILS — MANDATORY:
- You assist ONLY with Trinity Reserve Bank: its products, accounts, rates,
  eligibility, onboarding/KYC, wealth and investing services, and the
  research/catalog generated on this platform.
- If asked about anything outside that scope — weather, general news, sports,
  medical/legal/tax advice, coding, celebrities, other companies, politics, or
  any unrelated topic — politely DECLINE in one short sentence and steer back to
  the bank. Example: "I can only help with Trinity Reserve Bank's products and
  services — would you like to hear about our accounts?" Never answer the
  out-of-scope question itself, even partially.
- NEVER reveal internal or confidential information. This includes bank
  EMPLOYEE SALARIES or compensation, staff records, another customer's data,
  and any internal/financial figures from the strategy report that are not
  public product facts. If asked (e.g. "what does a branch manager earn",
  "how much is the CEO paid"), DECLINE: "That's internal information I can't
  share — I can help with our products and services instead." Treat this as a
  data-leak-prevention (DLP) boundary and apply it consistently so it is
  visible when tested. Do not restate or paraphrase the confidential figure.

GROUNDING & ACCURACY — MANDATORY:
- Product, rate, and eligibility answers must be grounded in real content, not
  invented. Use BANK_FACTS above for institution/eligibility questions, and
  gateway_kb_search for product/services detail and anything from the bank's
  generated strategy report (the PDF produced by the Deep Research Agent).
- When you answer from a knowledge-base result, include the result's "url" so
  the user can verify the source PDF — this demonstrates the answer is grounded
  in the step-1 strategy document, not fabricated.
- If neither BANK_FACTS nor the knowledge base supports a claim, say so plainly
  rather than guessing. Never fabricate rates, figures, or policies.

RESPONSE STYLE — MANDATORY:
- Answer in 1-2 sentences. No filler, no preamble, no follow-up questions unless truly ambiguous.
- NEVER say "I don't have access to real-time information" or "Would you like me to search".
- NEVER narrate what you are doing. Just do it and give the answer.
- After a tool returns results, state the answer directly. Do not mention the tool or the search process.
- Do not offer unsolicited extra information. Answer exactly what was asked.

AUTO TOOL USE — MANDATORY:
- If the user asks about current events, dates, times, news, weather, prices, or anything that
  requires up-to-date information: IMMEDIATELY call gateway_web_search. Do NOT ask for permission.
- If the user asks about previously generated reports or catalogs: IMMEDIATELY call gateway_kb_search.
- Do not produce structured JSON output — respond in natural language.

Tool reference:
- gateway_kb_search: search knowledge base for product and services content (the runtime
  scopes this to the `services` pipeline for the advisor flow — you are answering product,
  account, and services questions from catalog PDFs). Include "url" fields from results so
  users can view source PDFs.
- gateway_web_search: current/real-time information from the web. Use automatically — never ask first.
- gateway_place_order: submit an account application or service enrollment for the user.
- gateway_retrieve_user_profile: the user's own records. The result carries an `accounts`
  list of applications they have already opened (product, applicant name, status, when).
  Use it for any question about the user's accounts — never gateway_kb_search, which holds
  product literature, not customer records. `found: false` with a non-empty `accounts`
  list is normal for a signed-in demo user; report the accounts anyway.
- gateway_website_generator: generate or update static websites for ANY topic.
  - Pick layout based on content:
    - layout="landing" for product / service landing pages (hero + feature sections).
      Call with mode="create", title, content={subtitle?, sections:[{heading, body, items?}]}.
      Use this for the bank's product overviews.
    - layout="article" for research summaries, long-form explainers, blog-style posts.
      Call with mode="create", title, content={subtitle?, sections:[{heading, body, items?}]}.
    - layout="menu" is a legacy card-grid layout with prices/badges; the Services Catalog
      pipeline uses it, but do not choose it for ad-hoc content here.
  - To update/redesign: you MUST generate the complete new HTML yourself, then call with
    mode="update", s3_key (from the original generation result), and html (the full HTML string
    you wrote). Do NOT ask the tool to generate the HTML — you write it.
  - When writing HTML for updates: use Tailwind CDN and inline CSS for animations.
    Write production-quality, on-brand HTML that fully implements the user's design vision.
    For EVERY card that needs an image, include an <img> tag with alt="exact item name"
    (e.g. alt="High-Yield Savings"). The src can be empty or a placeholder — the tool fills
    in the correct image URL automatically. Images are matched by alt text, so the alt MUST
    exactly match the item name.
  - To add images: call with mode="add_images", s3_key, and images array [{name, s3_key}].
  - Remember the s3_key from website generation results so you can apply edits later.

  WEBSITE IMAGE WORKFLOW — READ CAREFULLY:
  When the user asks to "add images", "generate images for the site", or "illustrate the
  site", you MUST follow this two-step pattern, regardless of the site's layout (menu,
  article, or landing):

  STEP 1: Call gateway_image_generate once per image needed. Each call returns
          {s3_key, image_url}. Collect all results into a list of {name, s3_key} objects
          where `name` exactly matches the subtitle/section/item name the image illustrates.

  STEP 2: Call gateway_website_generator with:
            mode="add_images"
            s3_key=<the site's existing s3_key>
            images=[{name: "<section or item name>", s3_key: "<from step 1>"}, ...]

  DO NOT call mode="update" with html=... to add images — that path cannot discover the
  newly generated S3 keys, and the images will be orphaned. mode="add_images" is the ONLY
  correct path for injecting freshly generated Nova Canvas images into an existing site.

  If the user ALSO wants copy/layout changes alongside new images, do add_images first,
  then call mode="update" with html=... afterwards — the update path preserves existing
  <img data-s3-key> attributes via _inject_images().
- gateway_extract_pdf_images: extract embedded images from a generated PDF using Code Interpreter.
  - Call with pdf_s3_key and the document JSON. Returns [{name, s3_key}] for each image.
  - Use when the user wants to add PDF images to a website — extract first, then call
    gateway_website_generator mode="add_images" with the results.

BROWSER AUTOMATION (start an application, browse a generated website):
When the user asks to start an account application, browse their product website, or take an
action on a live webpage, use the browser_* tools to drive an AgentCore cloud browser.
A live view is streamed into the chat the moment you call browser_start, so the user
watches every click.

Workflow:
1. browser_start — ONCE. Emits the live view to the user.
2. browser_navigate(url=...) — go to the generated website URL. The user will usually
   share the presigned S3 URL. If they don't, fall back to gateway_kb_search to find the
   latest website/catalog.
3. browser_get_text() — read the page (no selector = full page). Let the LLM decide what
   to interact with based on the text.
4. browser_type(selector="...", text="...") — fill fields. Prefer simple selectors
   like input[name="name"], input[type="email"], input[type="date"]. Never enter a real
   SSN or account number — use synthetic placeholder values only.
5. browser_click(selector="...") — click buttons like button:has-text("Apply").
6. browser_press_key(key="Enter") — submit forms if no explicit button.
7. browser_stop() — when done. Always clean up even on failure.

Keep selectors simple and fall back to broader queries (e.g., button[type="submit"]) if
a specific one fails. If the site has no application form, tell the user plainly — don't
fabricate a success.

Tool limits:
- If a tool returns no results, try ONE more time with a broader query.
- Never call the same tool more than 3 times total in a single response.
"""
)

# ---------------------------------------------------------------------------
# Generic Research Studio prompts (topic-agnostic, with images + data sources)
# ---------------------------------------------------------------------------

GENERIC_RESEARCHER_PROMPT = """You are a Deep Research Agent. Your role is to execute thorough research
on each sub-question using web searches, data sources, and image generation, producing detailed
findings with full citations and source attribution.

CRITICAL TOOL BUDGET: You have a MAXIMUM of 50 total gateway_web_search calls for the entire
research task. Plan your queries carefully — budget about 2-3 searches per sub-question.

For EACH sub-question:
1. Perform 2-3 gateway_web_search queries targeting different aspects
2. Optionally use gateway_data_sources (source="wikipedia") for background context
3. Optionally use gateway_data_sources (source="arxiv") for academic citations
4. Synthesize findings from the results
5. Write 2-3 detailed paragraphs of findings with specific data points

Data sources budget: max 3 gateway_data_sources calls total (use sparingly for background/citations).

Do NOT use gateway_kb_search — the knowledge base only contains previously generated reports,
not source material useful for new research.

Your responsibilities:
1. Perform targeted web research using gateway_web_search
2. Enrich with encyclopedic background (Wikipedia) and academic citations (arXiv) where relevant
3. Synthesize and organize findings with proper citations
4. Identify gaps in available information

VISUAL RESEARCH (REQUIRED):
After completing ALL text research, identify 2-3 key concepts that would benefit from visual
illustration. For each, call gateway_image_generate with a professional visualization prompt.
Use prompts like: "Professional infographic illustration of [concept], clean modern design,
data visualization style, blue and white color scheme, 4k quality"

Collect s3_key and image_url from each Canvas result. Budget: max 3 images.

Research Guidelines:
- NEVER repeat a search you have already run, and do not re-run one with only cosmetic
  wording changes. Repeating a query cannot produce new information — it only consumes
  your budget. Change the substance of the query or record the gap and move on.
- Work through the sub-questions in order and visit each one ONCE. When the last one is
  done, do the visual research, then stop calling tools and output the JSON.
- BUDGET YOUR SEARCHES: 2-3 searches per sub-question, 50 max total
- Use gateway_web_search as your primary research tool
- Use gateway_data_sources sparingly for background and academic depth
- Maintain full source attribution for every finding
- Include SPECIFIC numbers, dates, percentages, dollar amounts, and names
- Aim for depth over breadth

Output your findings as structured JSON:
{
  "questions_researched": [
    {
      "question": "the sub-question from the plan",
      "detailed_findings": "3-5 paragraphs of detailed research findings",
      "key_data_points": ["stat 1", "stat 2", "stat 3"],
      "web_findings": [
        {
          "content": "detailed finding (2-3 sentences minimum)",
          "source": "URL or source name",
          "relevance": "high|medium|low"
        }
      ]
    }
  ],
  "meta_analysis": {
    "patterns": "Common patterns across all sub-questions",
    "contradictions": "Areas where sources disagree",
    "evidence_strength": "Overall evidence quality assessment",
    "unexpected_findings": "Surprising discoveries"
  },
  "images": [
    {
      "s3_key": "images/session/id.png (from Canvas result)",
      "image_url": "presigned URL (from Canvas result)",
      "caption": "Description of what the image illustrates",
      "placement_hint": "section:<relevant_theme_name>"
    }
  ],
  "cross_references": "notes on corroboration between sources",
  "gaps": "identified information gaps",
  "key_insights": ["insight 1", "insight 2"],
  "citations": ["formatted citation 1", "formatted citation 2"]
}
"""

GENERIC_SYNTHESIZER_PROMPT = """You are a Research Synthesizer & Report Agent. Your role is to compile
research findings into a comprehensive report and then generate a professional PDF.

You work in TWO steps:
1. SYNTHESIZE the research findings into a structured report
2. CALL gateway_pdf_generator to produce the PDF with embedded images

STEP 1 — SYNTHESIS:
- Analyze and synthesize all research findings from the previous agent
- Identify patterns, trends, and key insights across findings
- Compile a COMPREHENSIVE report — aim for depth and thoroughness
- Highlight conflicting information and areas of uncertainty
- Generate detailed, actionable recommendations with implementation guidance
- Preserve ALL data points, statistics, and quotes from the research
- Pass through the "images" array VERBATIM from the researcher output
- Pass through the "paid_sources" array VERBATIM (premium datasets the run bought)

CRITICAL: Do NOT summarize or compress the research findings. Your job is to EXPAND and
ORGANIZE them into a coherent narrative. Every data point, statistic, and quote from the
researcher should appear in your output.

CRITICAL: The "images" array from the researcher MUST be included exactly as received.
Do not modify, remove, or regenerate images.

PAID SOURCES:
A non-empty "paid_sources" array means budget was spent on premium data. Pass it
through verbatim and ensure its figures appear in key_findings or data_analysis,
attributed to the named dataset — a purchase the report never uses is money spent
for nothing.

Synthesis Guidelines:
- Organize information by themes and topics, not by source
- Cross-reference multiple sources for accuracy
- Executive summary should be 500-800 words (4-6 paragraphs)
- Each key finding theme should have 500-1000 words of detailed analysis
- Include comprehensive citations for all claims

STEP 2 — PDF GENERATION:
After synthesizing, call gateway_pdf_generator with format="research" and pass ALL fields.
Include topic, and a report object with ALL of these fields:
  subtitle, executive_summary, methodology, key_findings, data_analysis,
  supporting_evidence, conflicts_and_uncertainties, conclusions,
  recommendations, limitations_and_future_research, appendices, citations,
  images (the COMPLETE images array with s3_key, image_url, caption, placement_hint)

Note: The runtime automatically tags the generated PDF with the correct pipeline
(`market_research` for this Market Intelligence / Research Studio flow) so it is routed
to the right KB view for future searches. You do not need to set the `pipeline` argument.

DO NOT summarize any field when calling the tool. Pass everything through verbatim.

Never put the tool's `url` into your reply, as a link or as bare text. That URL
is signed for one hour while your reply is kept and reread long afterwards, so a
pasted link turns into an "Access Denied" page for the user. The runtime
delivers the report to the UI itself and renders a viewer whose link is
refreshed each time it is opened. Refer to the report by its title and say it is
ready.

The report JSON structure for the tool call:
{
  "topic": "research topic",
  "subtitle": "A descriptive subtitle for the report cover page",
  "executive_summary": "4-6 paragraphs (500-800 words)",
  "methodology": {
    "approach": "...",
    "sources_analyzed": "...",
    "limitations": "...",
    "timeframe": "..."
  },
  "key_findings": [
    {
      "theme": "theme name",
      "finding": "2-3 sentence summary",
      "confidence": "high|medium|low",
      "detailed_analysis": "500-1000 words",
      "sub_findings": [
        { "point": "...", "evidence": "...", "implication": "..." }
      ],
      "implications": "...",
      "sources": ["source 1", "source 2"]
    }
  ],
  "data_analysis": {
    "quantitative": ["..."],
    "qualitative": ["..."],
    "trends": ["..."],
    "comparative": ["..."]
  },
  "supporting_evidence": {
    "knowledge_base": ["..."],
    "web_sources": ["..."],
    "cross_referenced": ["..."]
  },
  "conflicts_and_uncertainties": "...",
  "conclusions": "3-5 paragraphs",
  "recommendations": [
    {
      "title": "...",
      "rationale": "...",
      "priority": "high|medium|low",
      "implementation_guidance": "...",
      "expected_impact": "..."
    }
  ],
  "limitations_and_future_research": "...",
  "appendices": [{ "title": "...", "content": "..." }],
  "citations": ["..."],
  "images": [
    {
      "s3_key": "...",
      "image_url": "...",
      "caption": "...",
      "placement_hint": "section:<theme_name>"
    }
  ]
}
"""

ARCHIVE_CHAT_PROMPT = """You are a Research Archive Assistant. Your role is to help users explore
and query their library of previously generated research reports.

Your primary tool is gateway_kb_search — use it to find relevant reports, findings, and recommendations
from past research. The knowledge base contains all previously generated research PDFs.

Guidelines:
- Search the knowledge base for every user question
- Synthesize information from multiple reports when relevant
- Enable cross-report comparison and trend identification
- Always include presigned PDF URLs so users can view source documents
- Keep responses conversational and helpful
- When kb_search results include "url" fields, include them as: "View the source: <url>"
- The "documents" array in kb_search results contains deduplicated source PDFs with presigned URLs

Capabilities:
- Find specific reports by topic
- Summarize key findings across reports
- Compare recommendations from different research areas
- Identify common themes and trends
- Provide citations back to original reports

Tool limits:
- Use gateway_kb_search as your PRIMARY and MAIN tool
- If a search returns no results, try ONE more time with a broader query
- Never call the same tool more than 3 times total in a single response
- Do NOT call gateway_image_generate, gateway_web_search, or other research tools
"""

# ---------------------------------------------------------------------------
# Generic Research Studio phase configuration
# ---------------------------------------------------------------------------

GENERIC_RESEARCH_PHASES = [
    {
        "name": "planner",
        "role": "planning",
        "prompt": PLANNER_PROMPT,
        "estimated_duration": 30,
        "messages": [
            "Analyzing the research question...",
            "Breaking down into sub-questions...",
            "Evaluating priority and scope...",
            "Organizing research plan...",
        ],
    },
    {
        "name": "researcher",
        "role": "research",
        "prompt": GENERIC_RESEARCHER_PROMPT,
        "estimated_duration": 300,
        # Same shard-and-merge fan-out as the Market Strategy researcher.
        "parallel": True,
        "messages": [
            "Searching web sources...",
            "Querying data sources...",
            "Generating visual illustrations...",
            "Cross-referencing findings...",
            "Documenting findings with citations...",
        ],
    },
    {
        "name": "synthesizer",
        "role": "synthesis & report",
        "prompt": GENERIC_SYNTHESIZER_PROMPT,
        "estimated_duration": 1800,
        "thinking_budget": 10000,
        "messages": [
            "Identifying key patterns...",
            "Connecting related findings...",
            "Organizing insights...",
            "Preserving visual references...",
            "Drawing conclusions...",
            "Generating PDF report...",
        ],
    },
]

# The Bedrock model that acts as the LLM-as-a-judge. Deliberately DISTINCT from
# the orchestrator/generator model so the evaluation is not self-grading. Nova
# Pro is a lower-cost first-party model already enabled in this account, and
# `_build_model` treats it as temperature-only (no thinking config to reject).
# Overridable via env for a future swap.
EVALUATION_JUDGE_MODEL = os.environ.get("EVALUATION_JUDGE_MODEL", "us.amazon.nova-pro-v1:0")

# Evaluation phase — runs last, after the PDF exists, to score the report
# against the brief and the gathered evidence. It streams a markdown scorecard;
# it does not produce a PDF. Shared by both the Market Strategy and Market
# Intelligence execution pipelines. Runs on a distinct Bedrock judge model.
EVALUATION_PHASE = {
    "name": "evaluator",
    "role": "evaluation",
    "prompt": EVALUATION_PROMPT,
    "model_id": EVALUATION_JUDGE_MODEL,
    "estimated_duration": 60,
    "thinking_budget": 4096,
    "messages": [
        "Re-reading the original brief...",
        "Checking coverage of each deliverable...",
        "Spot-checking claims against the knowledge base...",
        "Scoring groundedness and citations...",
        "Compiling the evaluation scorecard...",
    ],
}

GENERIC_EXECUTION_PHASES = [p for p in GENERIC_RESEARCH_PHASES if p["name"] != "planner"] + [EVALUATION_PHASE]

UI_EVENT_INTERVAL = 2

# Execution-only phases (skip planner) for research_execute mode. Evaluation is
# appended so it runs after the synthesizer has produced and delivered the PDF.
RESEARCH_EXECUTION_PHASES = [p for p in AGENT_PHASES if p["name"] != "planner"] + [EVALUATION_PHASE]


# ---------------------------------------------------------------------------
# Plan extraction helper
# ---------------------------------------------------------------------------

import json as _json_module
import re as _re_module
from typing import Literal

from pydantic import BaseModel, Field


class PlanSubQuestion(BaseModel):
    """One researchable sub-question in a plan."""

    id: int = Field(description="1-based position in the plan")
    question: str
    priority: Literal["high", "medium", "low"] = "medium"
    type: Literal["web", "kb", "analysis"] = "web"
    rationale: str = Field(default="", description="Why this question matters")


class ResearchPlan(BaseModel):
    """The planner's output, as a schema rather than a prose contract.

    Passed to the agent as `structured_output_model`, so the provider constrains
    generation to this shape instead of the prompt asking for JSON and the code
    hoping to find some. Asking in prose failed in a way that was hard to
    recover from: the planner would answer the research question instead, the
    parse found nothing, and the approval step never appeared.

    Field names match what ResearchPlanCard renders and what the execute phase
    is handed, so nothing downstream changes.
    """

    research_topic: str
    objectives: list[str] = Field(default_factory=list)
    sub_questions: list[PlanSubQuestion] = Field(min_length=1)
    methodology: str = ""
    expected_deliverables: list[str] = Field(default_factory=list)
    dependencies: str = ""
    estimated_time: str = ""


def _extract_plan_json(text: str) -> dict | None:
    """Extract a JSON plan from planner agent text output.

    Handles ```json fences, raw JSON blocks, and partial matches.
    Returns the parsed dict or None if extraction fails.
    """
    if not text:
        return None

    # Try ```json ... ``` fenced block first
    fenced = _re_module.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, _re_module.DOTALL)
    if fenced:
        try:
            parsed = _json_module.loads(fenced.group(1))
            if _is_usable_plan(parsed):
                return parsed
        except _json_module.JSONDecodeError:
            pass

    # Try to find a raw JSON object
    # Look for the outermost { ... } that contains "research_topic" or "sub_questions"
    brace_start = text.find("{")
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[brace_start : i + 1]
                    try:
                        parsed = _json_module.loads(candidate)
                        if _is_usable_plan(parsed):
                            return parsed
                    except _json_module.JSONDecodeError:
                        pass
                    break

    return None


# Ceiling on planner loop iterations. The planner needs a turn or two to consult
# the knowledge base and one to emit the plan, so this is generous — it exists
# only to stop a model that never reaches the plan from spinning forever. Without
# it the UI sat at 0% indefinitely with no response and no error, because nothing
# was failing; the loop simply never finished.
PLANNER_MAX_TURNS = 8

# The same protection, for the pipeline phases that follow the plan. Only the
# planner had a ceiling, so a researcher that kept searching never stopped:
# observed on Nova 2 Lite re-issuing near-identical web_search queries
# ("regional bank CD rate strategies 2024", then the same query with "customer
# segmentation" twice), with the UI parked at 95% for six minutes and no error,
# because nothing was failing — the loop simply never finished.
#
# The researcher's ceiling is derived from the depth's own search budget rather
# than fixed, because that budget is what the prompt tells the model it may
# spend: 15 searches on quick, 50 on standard, 100 on deep. A fixed ceiling would
# contradict the instructions and cut off legitimate work on the deeper settings.
# The headroom covers the turns spent writing findings up after searching.
PHASE_TURN_HEADROOM = 8

# Phases with no search budget to derive from. The synthesizer writes from
# findings already gathered and only calls pdf_generator, so it needs few turns.
STATIC_PHASE_MAX_TURNS: dict[str, int] = {
    "synthesizer": 12,
    "pdf_writer": 12,
    "website_writer": 12,
    # The evaluator spot-checks a few claims via kb_search then writes a compact
    # scorecard — a small ceiling keeps its cost bounded.
    "evaluator": 8,
    # The catalog designer generates ONE IMAGE PER PRODUCT: up to 4 sections of 3
    # products, plus the opening kb_search and the final JSON write. On the
    # 20-turn default it ran out after the first few images and the rest of the
    # catalog shipped with no imagery at all, which is what made PDFs and web
    # pages look half-finished. Sized for 12 image calls with headroom.
    "menu_designer": 42,
    "menu_pdf_writer": 12,
    "menu_website_writer": 12,
}
DEFAULT_PHASE_MAX_TURNS = 20


def _phase_turn_limit(agent_name: str, search_budget: int | None = None) -> int:
    """Turn ceiling for a pipeline phase.

    A ceiling has to exist for every phase: its absence is what turned a looping
    model into a frozen UI rather than a visible failure.
    """
    if agent_name == "researcher" and search_budget:
        return search_budget + PHASE_TURN_HEADROOM
    return STATIC_PHASE_MAX_TURNS.get(agent_name, DEFAULT_PHASE_MAX_TURNS)


def _plan_from_result(result) -> dict | None:  # noqa: ANN001 - strands AgentResult
    plan_obj = getattr(result, "structured_output", None)
    return plan_obj.model_dump() if plan_obj else None


# The planner sees only the knowledge-base search, not the whole gateway.
#
# Its prompt names exactly one tool, so the other sixteen were surface with no
# purpose — and that surface was the difference between working and not. Measured
# planning the same query:
#
#   Nova 2 Lite, all 17 tools     -> 8 turns, limit_turns, no plan, no output
#   Nova 2 Lite, kb_search only   -> a usable plan in 5.9s, kb_search called once
#   Claude Haiku, kb_search only  -> a usable plan in 10.5s, kb_search called 3x
#
# So restricting the toolset is what lets the knowledge-base step survive on
# Nova, rather than dropping it there. Fewer tools is also cheaper and faster on
# every model, which is why this applies to all of them and not just Nova.
PLANNER_GATEWAY_FILTER: dict = {"allowed": [_re_module.compile(r".*kb_search$")]}


def _planner_supports_schema(model_id: str) -> bool:
    """Whether this model can be asked for the plan as a constrained tool call.

    Measured across every model in the UI selector, planning the same query:

      Claude Sonnet 5 / Opus 5 / Opus 4.7 / Sonnet 4.6 / Haiku 4.5
          schema honoured -> a usable plan in 1-4 turns
      Nova 2 Lite
          schema, with tools    -> 8 turns, limit_turns, no plan
          schema, without tools -> 2 turns, limit_turns, no plan
          prose,  kb_search only -> a usable plan in 5.9s

    Nova 2 Lite never calls a forced tool, whatever else is attached, so it has
    to be asked in prose. It plans well that way and returns parseable JSON in a
    few seconds. Its trouble with tools is separate and handled by narrowing the
    planner's toolset (see PLANNER_GATEWAY_FILTER), which is what lets the
    knowledge-base step survive here rather than being dropped.

    So the model decides the strategy rather than the code trying one and
    recovering. Gating on the family is coarse but honest about what was
    measured; the alternative — attempting a schema call on every model and
    falling back — costs Nova roughly a minute of dead work per run.
    """
    return "anthropic" in model_id


def _plan_via_schema(agent, query: str) -> dict | None:  # noqa: ANN001 - strands Agent
    """Ask for the plan as a constrained tool call."""
    result = agent(query, structured_output_model=ResearchPlan, limits={"turns": PLANNER_MAX_TURNS})
    if result.stop_reason == "limit_turns":
        print(f"[ORCHESTRATOR] Planner hit the {PLANNER_MAX_TURNS}-turn ceiling without a plan")
    return _plan_from_result(result)


def _plan_via_prompt(agent, query: str) -> tuple[dict | None, str]:  # noqa: ANN001
    """Ask in prose and parse the reply. Used for models without schema support."""
    result = agent(query, limits={"turns": PLANNER_MAX_TURNS})
    text = str(result) if result else ""
    if result.stop_reason == "limit_turns":
        print(f"[ORCHESTRATOR] Planner hit the {PLANNER_MAX_TURNS}-turn ceiling without a plan")
    return _extract_plan_json(text), text


def _retry_plan_toolless(model, model_id: str, system_prompt: str, query: str) -> dict | None:  # noqa: ANN001
    """Last attempt, with no tools attached at all.

    Competing tools are what a weaker model gets lost in, so removing them is the
    strongest position left to ask from. Tries the schema first where the model
    supports it, then prose, because on Nova the prose path is the one that
    works. Costs the knowledge-base check, which only shapes the plan and is
    worth giving up to get one at all.
    """
    agent = Agent(name="PlannerRetryAgent", system_prompt=system_prompt, model=model)
    if _planner_supports_schema(model_id):
        plan = _plan_from_result(agent(query, structured_output_model=ResearchPlan, limits={"turns": 2}))
        if plan:
            return plan
    return _extract_plan_json(str(agent(query, limits={"turns": 2}) or ""))


def _is_usable_plan(parsed: object) -> bool:
    """True only for a plan the approval card can actually render.

    ResearchPlanCard maps over `sub_questions` while initialising its editable
    state, so a plan carrying only `objectives` — which the previous check
    accepted — threw during render and left the user with no card and no error.
    The questions are also the whole point of the plan, so a plan without them
    is not worth approving.
    """
    if not isinstance(parsed, dict):
        return False
    questions = parsed.get("sub_questions")
    return isinstance(questions, list) and len(questions) > 0


# The three source lanes the plan card renders under each question. Every plan
# should visibly draw on all three so the demo shows the agent combining the
# knowledge base, live web, and its own analysis — the researcher queries all
# sources at execution time regardless, so this only aligns the plan labels.
_PLAN_SOURCE_TYPES = ("web", "kb", "analysis")

# Words that hint a question is naturally a knowledge-base lookup (prior/internal
# material) rather than live web research. Used only to pick a sensible donor
# when the planner forgot to tag any question `kb`.
_KB_AFFINITY_WORDS = (
    "prior",
    "previous",
    "existing",
    "past",
    "baseline",
    "internal",
    "history",
    "historical",
    "already",
    "our ",
    "trinity",
)


def _ensure_source_coverage(plan: dict) -> dict:
    """Guarantee the plan tags at least one question per source lane.

    The planner intermittently omits a lane (most often `kb`), which makes the
    approval card look like the agent skipped a whole source. Reassigning a
    label is safe: `type` is an advisory lane shown on the card, and the
    researcher hits the KB, the web, and its own analysis for every shard no
    matter how questions are tagged. We only relabel when a lane is missing,
    and we take the donor from an over-represented lane so no other required
    lane drops to zero.
    """
    if not isinstance(plan, dict):
        return plan
    questions = plan.get("sub_questions")
    if not isinstance(questions, list):
        return plan

    editable = [q for q in questions if isinstance(q, dict)]
    # With fewer questions than lanes we cannot cover all three without leaving
    # a lane empty elsewhere, so leave the planner's assignment untouched.
    if len(editable) < len(_PLAN_SOURCE_TYPES):
        return plan

    for q in editable:
        if q.get("type") not in _PLAN_SOURCE_TYPES:
            q["type"] = "web"

    for missing in [t for t in _PLAN_SOURCE_TYPES if all(q["type"] != t for q in editable)]:
        counts: dict[str, int] = {}
        for q in editable:
            counts[q["type"]] = counts.get(q["type"], 0) + 1
        # Donors must come from a lane with a spare (count >= 2) so we never
        # empty a lane we already satisfied.
        donors = [q for q in editable if counts.get(q["type"], 0) >= 2]
        if not donors:
            break
        if missing == "kb":
            preferred = [
                q
                for q in donors
                if any(word in str(q.get("question", "")).lower() for word in _KB_AFFINITY_WORDS)
            ]
            donors = preferred or donors
        # Pull from the most over-represented lane for a stable, sensible choice.
        donor = max(donors, key=lambda q: counts.get(q["type"], 0))
        donor["type"] = missing

    return plan


# ---------------------------------------------------------------------------
# Research depth configuration
# ---------------------------------------------------------------------------

DEPTH_CONFIGS = {
    "quick": {
        "sub_questions": "3-4",
        "search_budget": 15,
        "searches_per_q": "1-2",
        "thinking_budget": 2048,
        "max_tokens": 16384,
        "exec_summary_words": "200-300",
        "exec_summary_paragraphs": "2-3",
        "finding_words": "150-300",
        "researcher_paragraphs": "1-2",
    },
    "standard": {
        "sub_questions": "5-8",
        "search_budget": 50,
        "searches_per_q": "2-3",
        "thinking_budget": 10000,
        "max_tokens": 65535,
        "exec_summary_words": "500-800",
        "exec_summary_paragraphs": "4-6",
        "finding_words": "500-1000",
        "researcher_paragraphs": "3-5",
    },
    "deep": {
        "sub_questions": "10-15",
        "search_budget": 100,
        "searches_per_q": "3-5",
        "thinking_budget": 16000,
        "max_tokens": 65535,
        "exec_summary_words": "800-1200",
        "exec_summary_paragraphs": "6-8",
        "finding_words": "800-1500",
        "researcher_paragraphs": "3-5",
    },
}


def _apply_depth_to_phases(phases: list[dict], depth: str) -> list[dict]:
    """Return a copy of agent phases with planner/researcher prompts adjusted for research depth."""
    cfg = DEPTH_CONFIGS.get(depth, DEPTH_CONFIGS["standard"])
    adjusted = []
    for phase in phases:
        p = dict(phase)
        if phase["name"] == "planner":
            # Adjust sub-question count in planner prompt
            prompt = p["prompt"]
            prompt = prompt.replace(
                "5-8 focused sub-questions",
                f"{cfg['sub_questions']} focused sub-questions",
            )
            prompt = prompt.replace(
                "Decompose the query into 5-8",
                f"Decompose the query into {cfg['sub_questions']}",
            )
            p["prompt"] = prompt
        elif phase["name"] == "researcher":
            # Carry the budget the prompt states, so the turn ceiling is derived
            # from it rather than guessed at separately and drifting from it.
            p["search_budget"] = cfg["search_budget"]
            # Adjust search budget in researcher prompt
            prompt = p["prompt"]
            prompt = prompt.replace(
                "MAXIMUM of 50 total gateway_web_search calls",
                f"MAXIMUM of {cfg['search_budget']} total gateway_web_search calls",
            )
            prompt = prompt.replace(
                "budget about 2-3 searches per sub-question",
                f"budget about {cfg['searches_per_q']} searches per sub-question",
            )
            prompt = prompt.replace(
                "2-3 searches per sub-question, 50 max total",
                f"{cfg['searches_per_q']} searches per sub-question, {cfg['search_budget']} max total",
            )
            # Adjust researcher paragraph depth
            researcher_paras = cfg.get("researcher_paragraphs", "3-5")
            prompt = prompt.replace(
                "2-3 detailed paragraphs",
                f"{researcher_paras} paragraphs",
            )
            prompt = prompt.replace(
                "3-5 paragraphs of detailed research findings",
                f"{researcher_paras} paragraphs of detailed research findings",
            )
            p["prompt"] = prompt
        elif phase["name"] == "synthesizer":
            # Adjust synthesizer prompt for depth — quick mode should be concise
            prompt = p["prompt"]
            prompt = prompt.replace(
                "500-800 words",
                f"{cfg['exec_summary_words']} words",
            )
            prompt = prompt.replace(
                "4-6 paragraphs",
                f"{cfg['exec_summary_paragraphs']} paragraphs",
            )
            prompt = prompt.replace(
                "500-1000 words",
                f"{cfg['finding_words']} words",
            )
            # For quick mode, replace the "EXPAND and ORGANIZE" instruction with concise guidance
            if depth == "quick":
                prompt = prompt.replace(
                    "CRITICAL: Do NOT summarize or compress the research findings. Your job is to EXPAND and\nORGANIZE them into a coherent narrative. Every data point, statistic, and quote from the\nresearcher should appear in your output.",
                    "Be concise but thorough. Organize the research findings into a coherent narrative.\nInclude the most important data points and statistics.",
                )
            p["prompt"] = prompt
            p["thinking_budget"] = cfg["thinking_budget"]
            p["max_tokens"] = cfg["max_tokens"]
        adjusted.append(p)
    return adjusted


# ---------------------------------------------------------------------------
# Shared helpers (same pattern as standalone agents)
# ---------------------------------------------------------------------------


def _effort_for_budget(thinking_budget: int) -> str:
    """Map a legacy thinking token budget onto Claude's `output_config.effort`.

    Current Claude models take a qualitative effort level rather than a token
    budget. Valid values are low / medium / high ("none" is rejected). The phase
    tables still express depth as budgets (2048 quick → 16000 deep), so translate
    rather than rewrite every call site.
    """
    if thinking_budget >= 10000:
        return "high"
    if thinking_budget >= 4096:
        return "medium"
    return "low"


def _build_model(
    model_id: str, temperature: float, max_tokens: int = 65535, thinking_budget: int = 4096, **extra_kwargs
) -> BedrockModel:
    """Build a BedrockModel with model-appropriate extended thinking config.

    - Claude Sonnet/Opus: adaptive thinking + output_config.effort, temperature
                          omitted (thinking requires temperature=1)
    - Claude Haiku:       temperature only, no thinking (rejects adaptive)
    - Nova Pro+:          reasoningConfig.maxReasoningEffort = "medium", temperature preserved
    - Nova Lite/Micro:    temperature only, no reasoning (not supported)
    - Other models:       temperature only, no thinking

    Uses a 30-minute read timeout. The synthesizer phase processes the entire
    researcher output (often 100k+ tokens) with extended thinking, which can take
    well over 15 minutes before the first streaming token arrives.

    max_tokens controls the output budget (thinking + response). Default 65535 —
    the maximum supported by Nova 2 Lite (Bedrock rejects 65536). It is clamped
    to the selected model's own ceiling, because the depth table and the model
    are chosen independently: Claude Haiku 4.5 caps output at 64000 and rejects
    anything higher with a ValidationException.

    Args:
        thinking_budget: Requested depth of Claude reasoning, expressed as a token
            budget for historical reasons. The current Claude API takes a
            qualitative effort level instead, so this is mapped onto
            low/medium/high by `_effort_for_budget`. Default 4096.
    """
    is_claude_thinking = "anthropic" in model_id and "haiku" not in model_id
    is_nova = "nova" in model_id and "sonic" not in model_id
    # reasoningConfig is a Nova 2 feature. Testing only for "nova" caught the
    # first generation too, and nova-pro-v1 rejects it outright:
    #   Malformed input request: the provided reasoning config value is invalid
    # which made Nova Pro unusable on every call. Requiring "nova-2" keeps the
    # field for a future Nova 2 Pro without sending it to a v1 model.
    is_nova_reasoning = is_nova and "nova-2" in model_id and "lite" not in model_id and "micro" not in model_id

    kwargs = dict(extra_kwargs)
    kwargs["model_id"] = model_id
    # Pin streaming ON explicitly rather than relying on the default.
    #
    # Strands reads it as `config.get("streaming", True)`, and the config type is
    # `bool | None` — so a present-but-None value is falsy and silently selects
    # the non-streaming branch. That branch calls
    # `convert_non_streaming_to_streaming`, which indexes `response["output"]`
    # unguarded and dies with a bare `KeyError: 'output'` if the response lacks
    # it. Setting it True closes that path for every phase.
    kwargs.setdefault("streaming", True)
    kwargs["max_tokens"] = clamp_max_tokens(model_id, max_tokens)
    kwargs["boto_client_config"] = BotocoreConfig(
        read_timeout=1800,
        connect_timeout=60,
        retries={"max_attempts": 3, "mode": "adaptive"},
    )

    if is_claude_thinking:
        # Claude thinking requires temperature=1 (SDK default), so don't set it.
        #
        # The legacy {"thinking": {"type": "enabled", "budget_tokens": N}} shape is
        # REJECTED by current Claude models with:
        #   "thinking.type.enabled" is not supported for this model. Use
        #   "thinking.type.adaptive" and "output_config.effort" ...
        # Probed against every model in the frontend selector: adaptive+effort is
        # accepted by claude-sonnet-5, opus-5, opus-4-7 AND sonnet-4-6, so it is
        # the one shape that works across the whole list. (Haiku rejects adaptive
        # and is already excluded above; Nova uses reasoningConfig below.)
        kwargs["additional_request_fields"] = {
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": _effort_for_budget(thinking_budget)},
        }
    elif is_nova_reasoning:
        kwargs["temperature"] = temperature
        kwargs["additional_request_fields"] = {"reasoningConfig": {"type": "enabled", "maxReasoningEffort": "medium"}}
    else:
        kwargs["temperature"] = temperature

    return BedrockModel(**kwargs)


def _create_gateway_mcp_client(access_token: str, tool_filters: dict | None = None) -> MCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication.

    `tool_filters` narrows which gateway tools the agent can see, e.g.
    ``{"allowed": [re.compile(r".*kb_search")]}``. Used by the planner, which
    only needs the knowledge-base search and cannot rely on every model coping
    with all seventeen — see `_planner_gateway_filter`.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    print(f"[ORCHESTRATOR] Creating Gateway MCP client for stack: {stack_name}")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[ORCHESTRATOR] Gateway URL from SSM: {gateway_url}")

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
        tool_filters=tool_filters,
    )

    print("[ORCHESTRATOR] Gateway MCP client created successfully")
    return gateway_client


# ---------------------------------------------------------------------------
# AgentCore Payments (preview) — paid data access for the research phase
# ---------------------------------------------------------------------------
# The Deep Research Agent can buy access to a paywalled premium-data endpoint
# via the x402 protocol, inside a budget the user approved with the plan.
#
# Everything here is best-effort and OFF unless fully configured: the payment
# manager ARN and a wallet instrument must both be present, and the SDK must be
# importable. A missing piece means the researcher runs exactly as before with
# no paid tool attached — never a failed run.

# Default per-run ceiling, in USD. Small on purpose: the merchant charges
# fractions of a cent per query, so a dollar is a generous research budget and
# a cheap blast radius.
DEFAULT_PAYMENT_BUDGET_USD = "1.00"
PAYMENT_SESSION_EXPIRY_MINUTES = 60


def _payment_setting(name: str) -> str:
    """Read a payment setting from the environment, then SSM.

    SSM rather than runtime env vars because the PaymentManager is created after
    the runtime in the stack, and the wallet instrument is created out-of-band
    (CloudFormation has no PaymentInstrument resource). Mirrors how the
    guardrail parameters are resolved.
    """
    env_value = os.environ.get(name.upper())
    if env_value:
        return env_value
    stack_name = os.environ.get("STACK_NAME", "")
    if not stack_name:
        return ""
    try:
        return get_ssm_parameter(f"/{stack_name}/{name.lower()}") or ""
    except Exception:
        # Absent parameter is the normal "payments not configured" case.
        return ""


@lru_cache(maxsize=1)
def _payments_settings() -> tuple[str, str, str]:
    """(payment_manager_arn, payment_instrument_id, x402_merchant_url).

    Cached: these are per-deployment constants, and an unconfigured stack would
    otherwise re-query SSM on every phase.
    """
    return (
        _payment_setting("payment_manager_arn"),
        _payment_setting("payment_instrument_id"),
        _payment_setting("x402_merchant_url"),
    )


def _payments_configured() -> bool:
    """True only when a payment manager, a wallet, and a merchant all exist."""
    manager, instrument, merchant = _payments_settings()
    return bool(manager and instrument and merchant)


def _build_payments_plugin(user_id: str, budget_usd: str = "", agent_name: str = "researcher"):
    """Build the Strands payments plugin, or return None when unavailable.

    The plugin supplies its own HTTP tool (`provide_http_request` defaults to
    True) and, with `auto_session`, creates the budgeted PaymentSession itself —
    so the budget ceiling is enforced by the service, not by prompt wording.
    """
    if not _payments_configured():
        return None
    try:
        from bedrock_agentcore.payments.integrations.config import AgentCorePaymentsPluginConfig
        from bedrock_agentcore.payments.integrations.strands.plugin import AgentCorePaymentsPlugin
    except ImportError as exc:
        print(f"[PAYMENTS] SDK unavailable, skipping paid data access: {exc}")
        return None

    manager_arn, instrument_id, _ = _payments_settings()
    budget = budget_usd or os.environ.get("PAYMENT_BUDGET_USD") or DEFAULT_PAYMENT_BUDGET_USD
    try:
        config = AgentCorePaymentsPluginConfig(
            payment_manager_arn=manager_arn,
            payment_instrument_id=instrument_id,
            user_id=user_id,
            region=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
            agent_name=agent_name,
            # One budgeted session per agent, created and enforced by the
            # service. When the ceiling is hit, further payments are denied.
            auto_session=True,
            auto_session_budget=budget,
            auto_session_expiry_minutes=PAYMENT_SESSION_EXPIRY_MINUTES,
        )
        plugin = AgentCorePaymentsPlugin(config=config)
        print(f"[PAYMENTS] Paid data access enabled for {agent_name} (budget ${budget})")
        return plugin
    except Exception as exc:
        # A payments misconfiguration must never take down a research run.
        print(f"[PAYMENTS] Failed to initialize, continuing without paid data: {exc}")
        return None


def _read_payment_spend(plugin) -> dict | None:  # noqa: ANN001 - AgentCorePaymentsPlugin
    """Read ACTUAL spend from the plugin's payment session.

    The run report previously showed an estimated cost derived from per-unit
    assumptions. This returns the real figure the service accounted for, so the
    number the user sees is money actually committed rather than arithmetic.

    Returns None when unavailable (no session opened, or the read fails) — a
    telemetry gap must never fail a research run.
    """
    if plugin is None:
        return None
    try:
        session = plugin.get_payment_session()
    except Exception as exc:
        logger.debug("Payment session read failed: %s", exc)
        return None
    if not isinstance(session, dict):
        return None

    def _amount(field: str) -> str:
        value = session.get(field)
        if isinstance(value, dict):
            return str(value.get("value", ""))
        return str(value) if value is not None else ""

    limits = session.get("limits")
    max_spend = ""
    if isinstance(limits, dict):
        max_amount = limits.get("maxSpendAmount")
        if isinstance(max_amount, dict):
            max_spend = str(max_amount.get("value", ""))

    return {
        "spent": _amount("spentAmount"),
        "remaining": _amount("remainingAmount"),
        "budget": max_spend,
        "currency": "USD",
        "status": str(session.get("status", "")),
        "session_id": str(session.get("paymentSessionId", "")),
    }


def latest_report_id(user_id: str, pipeline: str = "strategy_research") -> str:
    """Most recent completed report id for a user and pipeline, or "".

    Reads the run-history table `pdf_generator` writes. The sort key is
    `report#{iso_timestamp}#{report_id}`, so a descending query returns newest
    first without needing a secondary index.

    Returns "" on any failure — an unresolvable pin must fall back to the
    pipeline-wide filter rather than fail the run.
    """
    table_name = os.environ.get("METADATA_TABLE", "")
    if not table_name or not user_id:
        return ""
    try:
        import boto3

        response = (
            boto3.resource("dynamodb")
            .Table(table_name)
            .query(
                KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
                ExpressionAttributeValues={":pk": f"user#{user_id}", ":sk": "report#"},
                ScanIndexForward=False,
                Limit=25,
            )
        )
    except Exception as exc:
        logger.warning("Could not resolve latest report for pinning: %s", exc)
        return ""

    for item in response.get("Items", []):
        if item.get("pipeline") == pipeline:
            return str(item.get("report_id", ""))
    return ""


def _decimal_or_default(value: str, default: float = 1.0) -> float:
    """Parse a USD budget string, falling back rather than raising.

    A malformed budget must not abort a research run; the floor keeps a typo
    like "" or "abc" from silently authorizing an unbounded spend.
    """
    try:
        parsed = float(str(value).strip().lstrip("$"))
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _payment_prompt_addendum() -> str:
    """Prompt guidance for the paid data source, only when one is configured."""
    if not _payments_configured():
        return ""
    _, _, merchant_url = _payments_settings()
    merchant_url = merchant_url.rstrip("/")
    return f"""

PAID PREMIUM DATA (optional, budgeted):
A paywalled premium-data endpoint is available at {merchant_url}. It sells
per-query datasets that are otherwise unavailable to web search:
  - exchange-activity     multi-venue listing & trading activity (TXSE, NYSE, Nasdaq, EU)
  - deposit-benchmarks    regional deposit pricing benchmarks
  - compensation-bands    banking compensation bands by role
  - fraud-signals         account-fraud typology prevalence

How to use it:
1. GET {merchant_url} to see the catalog and the price per query.
2. GET {merchant_url}/data/<dataset-id> to buy and read one dataset.
   The endpoint answers HTTP 402 and payment is handled for you automatically.

Spend rules — MANDATORY:
- Buy a dataset ONLY when it directly answers one of your assigned
  sub-questions. Free web search first; pay only for what search cannot give you.
- Buy each dataset at most ONCE.
- You are working inside an approved budget. If a payment is refused, the budget
  is exhausted — record the gap and continue with what you have. Do not retry.

USING WHAT YOU BOUGHT — MANDATORY:
Paying for a dataset and then leaving it out of your output wastes the budget and
makes the purchase invisible in the final report. Every dataset you buy MUST show
up in your JSON:
- Copy its specific figures into `key_data_points` for the relevant
  sub-question — the actual numbers, named (e.g. "Savings market median 3.95%
  APY vs top decile 4.35% (paid: deposit-benchmarks)").
- Add a `web_findings` entry summarising it, with
  `"source": "PAID: <dataset-id>"` so its provenance is unambiguous.
- List every dataset you purchased in the top-level `paid_sources` array:
    "paid_sources": [
      {{"dataset_id": "deposit-benchmarks", "used_for": "which sub-question it answered",
        "key_figures": ["figure 1", "figure 2"]}}
    ]
- If you bought nothing, return `"paid_sources": []`. Never list a dataset you
  did not actually receive a 200 response for.
"""


def _load_guardrail_params() -> dict:
    """Load guardrail params from SSM if available.

    Returns kwargs suitable for ``BedrockModel(guardrail_id=..., guardrail_version=...)``.
    Strands SDK >=1.28 uses separate ``guardrail_id`` and ``guardrail_version`` params
    (the old ``guardrail_config`` dict is deprecated).
    """
    stack_name = os.environ.get("STACK_NAME", "")
    if not stack_name:
        return {}
    try:
        gid = get_ssm_parameter(f"/{stack_name}/guardrail_id")
        gver = get_ssm_parameter(f"/{stack_name}/guardrail_version")
        if gid and gver:
            print(f"[ORCHESTRATOR] Guardrail loaded: {gid} v{gver}")
            return {"guardrail_id": gid, "guardrail_version": gver}
    except Exception as e:
        print(f"[ORCHESTRATOR] Guardrail not available: {e}")
    return {}


def _create_agent(
    name: str,
    system_prompt: str,
    user_id: str,
    session_id: str,
    gateway_client: MCPClient,
    bedrock_model: BedrockModel,
    extra_tools: list | None = None,
    pipeline_scope: PipelineScopeHook | None = None,
    plugins: list | None = None,
) -> Agent:
    """Create a Strands Agent with Gateway MCP + Memory (identical to standalone pattern).

    The caller decides which gateway tools the agent sees, by passing a client
    built with `tool_filters`. The planner passes a narrowed one; the pipeline
    phases pass the full set.
    """
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    agentcore_memory_config = AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=user_id)

    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )

    # Provide user context (user_id injection is handled by UserScopeHook, not prompt)
    augmented_prompt = system_prompt
    if user_id:
        augmented_prompt += f'\n\nContext: You are assisting user "{user_id}".'

    # Hooks force-inject the verified user_id and mode-specific KB read filter /
    # pdf_generator pipeline write into all relevant Gateway tool calls.
    hooks: list = []
    if user_id:
        hooks.append(UserScopeHook(user_id))
    if pipeline_scope is not None:
        hooks.append(pipeline_scope)

    agent = Agent(
        name=f"{name.title().replace('_', '')}Agent",
        system_prompt=augmented_prompt,
        tools=[gateway_client, *(extra_tools or [])],
        model=bedrock_model,
        hooks=hooks,
        # AgentCore Payments attaches here: the plugin adds its own HTTP tool
        # and intercepts HTTP 402 responses to pay and retry.
        plugins=plugins or [],
        session_manager=session_manager,
        trace_attributes={
            "user.id": user_id,
            "session.id": session_id,
            "agent.role": name,
        },
    )
    return agent


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


async def _handle_chatbot(
    query, user_id, session_id, requested_model="", system_prompt_override=None, mode: str = "chatbot"
):
    """Handle chatbot mode — streams text, tool calls, and thinking in real time.

    Uses Strands callback_handler to push events from the agent thread into a
    thread-safe queue.  The async loop polls the queue and yields SSE events
    that the frontend parser (strands.ts) already understands.

    Args:
        system_prompt_override: If provided, replaces the default CHATBOT_PROMPT.
        mode: Chatbot sub-mode ("chatbot" or "archive_chat"). Drives the
            PipelineScopeHook that scopes KB searches to `menu` (chatbot) or
            everything (archive_chat).
    """
    import json as _json
    import queue as thread_queue

    print(f"[CHATBOT] Starting chatbot for user: {user_id}, session: {session_id}")

    try:
        access_token = get_gateway_access_token()
        gateway_client = _create_gateway_mcp_client(access_token)

        model_id = requested_model or os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6")
        print(f"[CHATBOT] Using model: {model_id}")
        guardrail_kwargs = _load_guardrail_params()
        bedrock_model = _build_model(model_id, temperature=0.3, guardrail_latest_message=True, **guardrail_kwargs)
    except Exception as e:
        print(f"[CHATBOT] Setup failed: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": f"Setup failed: {e}"}
        return

    # ── Queue sentinels ──
    _DONE = object()
    _HEARTBEAT = object()
    _ERROR = object()
    tq: thread_queue.Queue = thread_queue.Queue()

    # ── Callback handler — fires inside the agent thread ──
    _prev_tool_use_id = [None]  # track by toolUseId only (not full dict)
    _tool_use_active = [False]  # suppress data tokens during tool calls
    _tool_use_active_since = [0.0]  # monotonic timestamp when flag was last raised
    # If the `message` event that clears the flag never arrives (LLM error,
    # partial stream, etc.), streamed text is swallowed indefinitely. Reset
    # the flag if `data` arrives more than this many seconds after the flag
    # was raised — the user sees a bit of in-tool-call text leak through,
    # which is strictly better than a stuck UI.
    _TOOL_USE_ACTIVE_TIMEOUT_SEC = 30.0

    def _callback_handler(**kwargs):
        """Push streaming events onto the thread-safe queue."""

        # Tool use streaming (mirrors Strands ToolUseStreamEvent shape)
        # Check this FIRST so we can set the suppression flag before data handling
        current_tool_use = kwargs.get("current_tool_use")
        if current_tool_use and current_tool_use.get("name"):
            _tool_use_active[0] = True
            _tool_use_active_since[0] = time.monotonic()
            tool_use_id = current_tool_use.get("toolUseId", "")
            tool_name = current_tool_use.get("name", "")

            # Emit tool_use_start only on first sight of a NEW tool call ID
            if tool_use_id != _prev_tool_use_id[0]:
                _prev_tool_use_id[0] = tool_use_id
                tq.put(
                    (
                        "stream",
                        {
                            "current_tool_use": {
                                "toolUseId": tool_use_id,
                                "name": tool_name,
                            },
                            "delta": {"toolUse": {"input": ""}},
                        },
                    )
                )

            # Emit tool_use_delta for partial input
            delta = kwargs.get("delta")
            if delta:
                raw_delta = delta if isinstance(delta, dict) else getattr(delta, "__dict__", {})
                tool_input = ""
                if isinstance(raw_delta, dict):
                    tu = raw_delta.get("toolUse", {})
                    if isinstance(tu, dict):
                        tool_input = tu.get("input", "")
                    else:
                        tool_input = getattr(tu, "input", "")
                if tool_input:
                    tq.put(
                        (
                            "stream",
                            {
                                "current_tool_use": {
                                    "toolUseId": tool_use_id,
                                    "name": tool_name,
                                },
                                "delta": {"toolUse": {"input": tool_input}},
                            },
                        )
                    )

        # Incremental text — only emit when NOT inside a tool call.
        # Recovery: if the flag has been stuck for more than the timeout,
        # assume the clearing `message` event is lost and allow the text
        # through.
        data = kwargs.get("data", "")
        if data:
            if _tool_use_active[0]:
                stuck_for = time.monotonic() - _tool_use_active_since[0]
                if stuck_for > _TOOL_USE_ACTIVE_TIMEOUT_SEC:
                    print(
                        f"[CHATBOT] _tool_use_active stuck for {stuck_for:.1f}s — "
                        "resetting flag and emitting pending text"
                    )
                    _tool_use_active[0] = False
                    _prev_tool_use_id[0] = None
                    tq.put(("stream", {"data": data}))
            else:
                tq.put(("stream", {"data": data}))

        # Reasoning / thinking text
        reasoning = kwargs.get("reasoningText", "")
        if reasoning:
            tq.put(("stream", {"thinking": {"agent": "chatbot", "content": reasoning}}))

        # Complete message (contains toolResult blocks after tool execution)
        # This fires after tool execution completes — clear the suppression flag
        message = kwargs.get("message")
        if message:
            _tool_use_active[0] = False
            _prev_tool_use_id[0] = None
            try:
                msg_dict = message if isinstance(message, dict) else getattr(message, "__dict__", {})
                tq.put(("stream", {"message": msg_dict}))
            except Exception as exc:
                logger.debug("Failed to push chatbot stream message to SSE queue: %s", exc)

    chatbot_prompt = system_prompt_override or CHATBOT_PROMPT

    _pipeline_cfg = mode_config(mode)
    _pipeline_scope = PipelineScopeHook(
        write_pipeline=_pipeline_cfg.get("write"),
        read_filter=_pipeline_cfg.get("read_filter"),
        is_archive=_pipeline_cfg.get("archive", False),
    )
    print(
        f"[CHATBOT] Pipeline scope (mode={mode}): write={_pipeline_cfg.get('write')!r}, "
        f"read_filter={_pipeline_cfg.get('read_filter')!r}, archive={_pipeline_cfg.get('archive', False)}"
    )

    # Browser tools are only useful for the client advisor (mode="chatbot").
    # archive_chat is a read-only KB search experience — its prompt forbids
    # browser usage, so we don't attach the tools there either.
    browser_tools = BROWSER_TOOLS if mode == "chatbot" else []

    try:
        agent = _create_agent(
            "chatbot",
            chatbot_prompt,
            user_id,
            session_id,
            gateway_client,
            bedrock_model,
            extra_tools=browser_tools,
            pipeline_scope=_pipeline_scope,
        )
        # Attach our streaming callback handler
        agent.callback_handler = _callback_handler
        # Bridge browser tool UI events into this turn's SSE queue
        set_browser_ui_queue(tq)
    except Exception as e:
        print(f"[CHATBOT] Failed to create agent: {e}")
        yield {"status": "error", "error": f"Failed to create chatbot: {e}"}
        return

    def _run_agent_sync():
        try:
            agent(query)
        except Exception as exc:
            tq.put((_ERROR, exc))
        finally:
            tq.put((_DONE, None))

    _stop_heartbeat = threading.Event()

    def _heartbeat_thread():
        while not _stop_heartbeat.wait(10):
            tq.put((_HEARTBEAT, None))

    heartbeat_thread = threading.Thread(target=_heartbeat_thread, daemon=True)
    heartbeat_thread.start()

    loop = asyncio.get_running_loop()
    agent_future = loop.run_in_executor(None, _run_agent_sync)

    try:
        while True:
            while tq.empty():
                await asyncio.sleep(0.05)

            tag, value = tq.get_nowait()

            if tag is _DONE:
                break
            if tag is _ERROR:
                raise value
            if tag is _HEARTBEAT:
                yield {"data": "", "heartbeat": True}
            elif tag == "ui":
                # Browser tool pushed a generative UI event
                yield {"_ui": value}
            elif tag == "stream":
                # Serialize any non-dict values to ensure JSON compatibility
                try:
                    _json.dumps(value, default=str)
                    yield value
                except (TypeError, ValueError):
                    pass
    except Exception as e:
        print(f"[CHATBOT] Error: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": f"Chatbot error: {e}"}
        return
    finally:
        _stop_heartbeat.set()
        heartbeat_thread.join(timeout=2)
        agent_future.cancel()
        # Ensure any active browser session is released at end of turn
        try:
            browser_cleanup()
        finally:
            set_browser_ui_queue(None)

    yield {"result": {"stop_reason": "end_turn"}}


async def _run_plan_only(query, user_id, session_id, requested_model="", research_depth="standard", mode: str = ""):
    """Run ONLY the planner phase and emit a ResearchPlan UI component.

    The stream ends after emitting the plan — the frontend displays it for
    user review/editing. The user then sends a second request with
    mode="research_execute" containing the approved plan.
    """
    import queue as thread_queue

    print(f"[ORCHESTRATOR] Running plan-only for user: {user_id}, depth: {research_depth}")

    try:
        access_token = get_gateway_access_token()
        # Plan-only mode runs the planner and nothing else, and the planner needs
        # just the knowledge-base search, so the full toolset is never built here.
        model_id = requested_model or os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6")
        bedrock_model = _build_model(model_id, temperature=0.1)
    except Exception as e:
        print(f"[ORCHESTRATOR] Plan setup failed: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": f"Setup failed: {e}"}
        return

    adjusted_phases = _apply_depth_to_phases(AGENT_PHASES, research_depth)
    planner_phase = adjusted_phases[0]  # planner is always first

    # Emit phase start
    yield {"agent_phase": {"agent": "planner", "phase": "planning", "status": "start"}}
    yield {
        "_ui": {
            "component": "AgentActivity",
            "props": {
                "agent": "planner",
                "phase": "planning",
                "progress": 0,
                "activity": planner_phase["messages"][0],
                "elapsed": 0,
                "done": False,
            },
        }
    }

    try:
        _pipeline_cfg = mode_config(mode)
        _pipeline_scope = PipelineScopeHook(
            write_pipeline=_pipeline_cfg.get("write"),
            read_filter=_pipeline_cfg.get("read_filter"),
            is_archive=_pipeline_cfg.get("archive", False),
        )
        print(
            f"[ORCHESTRATOR] Plan-only pipeline scope: write={_pipeline_cfg.get('write')!r}, "
            f"read_filter={_pipeline_cfg.get('read_filter')!r}, archive={_pipeline_cfg.get('archive', False)}"
        )
        use_schema = _planner_supports_schema(model_id)
        print(
            f"[ORCHESTRATOR] Planner strategy for {model_id}: {'schema' if use_schema else 'prompt'} + kb_search only"
        )
        # A second, narrowed client: the pipeline's own client keeps the full
        # toolset for the researcher and synthesizer phases.
        planner_gateway = _create_gateway_mcp_client(access_token, PLANNER_GATEWAY_FILTER)
        agent = _create_agent(
            "planner",
            planner_phase["prompt"],
            user_id,
            session_id,
            planner_gateway,
            bedrock_model,
            pipeline_scope=_pipeline_scope,
        )
    except Exception as e:
        print(f"[ORCHESTRATOR] Failed to create planner agent: {e}")
        yield {"status": "error", "error": f"Failed to create planner: {e}"}
        return

    # Run planner in thread with heartbeats
    agent_text = ""
    structured_plan: dict | None = None
    start_time = time.monotonic()
    _DONE = object()
    _HEARTBEAT = object()
    _ERROR = object()
    tq: thread_queue.Queue = thread_queue.Queue()

    def _run_planner_sync():
        try:
            # Where the model supports it, the plan is requested as a constrained
            # tool call, which still runs the tool loop so the planner can consult
            # the knowledge base and cannot answer in prose. Where it does not,
            # the plan is asked for in prose and parsed — see
            # `_planner_supports_schema` for what was measured.
            if use_schema:
                tq.put(("plan", _plan_via_schema(agent, query)))
                tq.put(("text", ""))
            else:
                parsed, text = _plan_via_prompt(agent, query)
                tq.put(("plan", parsed))
                tq.put(("text", text))
        except Exception as exc:
            tq.put((_ERROR, exc))
        finally:
            tq.put((_DONE, None))

    _stop_heartbeat = threading.Event()

    def _heartbeat_fn():
        while not _stop_heartbeat.wait(10):
            tq.put((_HEARTBEAT, None))

    hb_thread = threading.Thread(target=_heartbeat_fn, daemon=True)
    hb_thread.start()

    loop = asyncio.get_running_loop()
    agent_future = loop.run_in_executor(None, _run_planner_sync)

    try:
        while True:
            while tq.empty():
                await asyncio.sleep(0.1)

            tag, value = tq.get_nowait()
            if tag is _DONE:
                break
            if tag is _ERROR:
                raise value
            if tag is _HEARTBEAT:
                yield {"data": "", "heartbeat": True}
            elif tag == "plan":
                structured_plan = value
            elif tag == "text":
                agent_text = value
    except Exception as e:
        print(f"[ORCHESTRATOR] Planner error: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": f"Planner failed: {e}"}
        return
    finally:
        _stop_heartbeat.set()
        hb_thread.join(timeout=2)
        agent_future.cancel()

    # Emit planner complete
    elapsed = time.monotonic() - start_time
    yield {
        "_ui": {
            "component": "AgentActivity",
            "props": {
                "agent": "planner",
                "phase": "planning",
                "progress": 100,
                "activity": "Complete",
                "elapsed": round(elapsed),
                "done": True,
            },
        }
    }
    yield {"agent_phase": {"agent": "planner", "phase": "planning", "status": "end"}}

    # Whichever strategy ran has already parsed its own result; agent_text is
    # only populated on the prose path and is re-parsed here as a cheap backstop.
    plan = structured_plan if _is_usable_plan(structured_plan) else _extract_plan_json(agent_text)

    if plan is None:
        print("[ORCHESTRATOR] Planner produced no plan; retrying with no tools attached")
        try:
            plan = await asyncio.get_running_loop().run_in_executor(
                None,
                _retry_plan_toolless,
                bedrock_model,
                model_id,
                planner_phase["prompt"],
                query,
            )
        except Exception as exc:  # noqa: BLE001 - reported below, not raised
            print(f"[ORCHESTRATOR] Planner retry failed: {exc}")

    if plan:
        _ensure_source_coverage(plan)
        print(f"[ORCHESTRATOR] Plan extracted: {plan.get('research_topic', 'unknown')}")
        yield {
            "_ui": {
                "component": "ResearchPlan",
                "props": {
                    "plan": plan,
                    "query": query,
                },
            }
        }
    else:
        # Do NOT fall back to emitting the planner's prose. Doing that rendered
        # as an ordinary assistant answer, which looked like the run had
        # succeeded while the researcher and synthesizer never started and no
        # approval card existed to start them — the pipeline appeared to stall
        # for no visible reason. Failing loudly is the honest outcome.
        print("[ORCHESTRATOR] Could not extract plan JSON after retry")
        yield {
            "status": "error",
            "error": ("The planner did not return a usable research plan. Send the request again to retry."),
        }
        return

    yield {"result": {"stop_reason": "end_turn"}}


@app.entrypoint
async def orchestrate(payload: dict, context: RequestContext):
    """Route to chatbot, research, research_execute, menu, generic_research, or archive_chat based on mode.

    - mode="chatbot": Single conversational agent (client advisor)
    - mode="research" (default): Runs planner only, emits plan for user approval
    - mode="research_execute": Runs researcher -> synthesizer -> pdf_writer with approved plan
    - mode="menu": 2-phase pipeline (menu_designer -> menu_pdf_writer)
    - mode="generic_research": Generic topic planner, emits plan for approval
    - mode="generic_research_execute": Runs enhanced researcher (images+data sources) -> synthesizer -> pdf_writer
    - mode="archive_chat": Research archive assistant (KB search across all reports)
    """
    query = payload.get("prompt", payload.get("query", ""))
    session_id = payload.get("runtimeSessionId", payload.get("session_id", "default"))
    mode = payload.get("mode", "research")
    # Allow frontend to override model — falls back to env var or default
    requested_model = payload.get("model_id", "")
    # Research depth: quick / standard / deep — controls sub-question count and search budget
    research_depth = payload.get("research_depth", "standard")
    # Spend ceiling for paid premium data, approved by the user alongside the
    # research plan. Empty means "use the deployment default".
    payment_budget_usd = str(payload.get("payment_budget_usd", "") or "")

    if not query:
        yield {"data": "No query provided."}
        return

    try:
        user_id = extract_user_id_from_context(context)
    except Exception as e:
        print(f"[ORCHESTRATOR] Failed to extract user_id: {e}")
        yield {"status": "error", "error": str(e)}
        return

    # ── Archive chat mode: KB search across all research reports ──
    if mode == "archive_chat":
        async for event in _handle_chatbot(
            query,
            user_id,
            session_id,
            requested_model,
            system_prompt_override=ARCHIVE_CHAT_PROMPT,
            mode="archive_chat",
        ):
            yield event
        return

    # ── Chatbot mode: single conversational agent ──
    if mode == "chatbot":
        async for event in _handle_chatbot(query, user_id, session_id, requested_model, mode="chatbot"):
            yield event
        return

    # ── Generic research plan-only: reuses planner (already topic-agnostic) ──
    if mode == "generic_research":
        async for event in _run_plan_only(
            query, user_id, session_id, requested_model, research_depth, mode="generic_research"
        ):
            yield event
        return

    # ── Generic research execute: enhanced pipeline with images + data sources ──
    if mode == "generic_research_execute":
        plan = payload.get("plan", {})
        if plan:
            import json as _grej

            plan_text = _grej.dumps(plan, indent=2) if isinstance(plan, dict) else str(plan)
            initial_accumulated = f"Approved research plan:\n{plan_text}\n\nOriginal query: {query}"
        else:
            initial_accumulated = query

        adjusted_generic = _apply_depth_to_phases(GENERIC_EXECUTION_PHASES, research_depth)
        async for event in _run_pipeline(
            adjusted_generic,
            query,
            user_id,
            session_id,
            requested_model,
            initial_accumulated=initial_accumulated,
            mode="generic_research_execute",
            payment_budget_usd=payment_budget_usd,
        ):
            yield event
        return

    # ── Research plan-only mode (default "research"): run planner, emit plan for approval ──
    if mode == "research":
        async for event in _run_plan_only(query, user_id, session_id, requested_model, research_depth, mode="research"):
            yield event
        return

    # ── Research execute mode: run execution phases with approved plan ──
    if mode == "research_execute":
        plan = payload.get("plan", {})
        if plan:
            import json as _rej

            plan_text = _rej.dumps(plan, indent=2) if isinstance(plan, dict) else str(plan)
            initial_accumulated = f"Approved research plan:\n{plan_text}\n\nOriginal query: {query}"
        else:
            initial_accumulated = query

        adjusted_exec = _apply_depth_to_phases(RESEARCH_EXECUTION_PHASES, research_depth)
        async for event in _run_pipeline(
            adjusted_exec,
            query,
            user_id,
            session_id,
            requested_model,
            initial_accumulated=initial_accumulated,
            mode="research_execute",
            payment_budget_usd=payment_budget_usd,
        ):
            yield event
        return

    # ── Services Catalog export: continue after the user approved the catalog ──
    #
    # The catalog is a customer-facing deliverable, so exporting it is gated on
    # human review (mirroring the research plan approval). This mode receives the
    # reviewed — and possibly edited — catalog and runs only the export phases.
    if mode == "menu_export":
        catalog = payload.get("catalog", {})
        if catalog:
            import json as _mej

            catalog_text = _mej.dumps(catalog, indent=2) if isinstance(catalog, dict) else str(catalog)
            initial_accumulated = (
                f"Approved services catalog (reviewed by the user; use it EXACTLY as given, "
                f"including any edited descriptions):\n{catalog_text}\n\nOriginal query: {query}"
            )
        else:
            initial_accumulated = query

        async for event in _run_pipeline(
            MENU_EXPORT_PHASES,
            query,
            user_id,
            session_id,
            requested_model,
            initial_accumulated=initial_accumulated,
            # Keep the `menu` scope so the PDF is still tagged `services`.
            mode="menu",
        ):
            yield event
        return

    # ── Menu mode: design only, then stop for review ──
    #
    # The catalog is pinned to ONE research run so it cannot be grounded in a
    # semantic blend of every past run. The caller may name the run; otherwise
    # the latest completed strategy report is used. `market_research` stays
    # unpinned — it is supplementary context, and a user who never ran Market
    # Intelligence would otherwise get nothing.
    pinned: list[str] = []
    if mode == "menu":
        requested_report = str(payload.get("report_id", "") or "").strip()
        resolved = requested_report or latest_report_id(user_id, "strategy_research")
        if resolved:
            pinned = [resolved]
        else:
            print("[ORCHESTRATOR] No strategy report found to pin — catalog will use pipeline scope only")

    phases = MENU_DESIGN_PHASES if mode == "menu" else AGENT_PHASES
    async for event in _run_pipeline(
        phases,
        query,
        user_id,
        session_id,
        requested_model,
        mode=mode,
        pinned_report_ids=pinned,
    ):
        yield event


# Matches virtual-hosted (bucket.s3.amazonaws.com / bucket.s3.region.amazonaws.com)
# and path-style (s3.amazonaws.com/bucket/...) object URLs.
_S3_OBJECT_URL_RE = _re_module.compile(
    r"https?://[^\s<>\"')\]]+?\.s3[.\-][^\s<>\"')\]]*?amazonaws\.com/[^\s<>\"')\]]+"
    r"|https?://s3[.\-][^\s<>\"')\]]*?amazonaws\.com/[^\s<>\"')\]]+",
    _re_module.IGNORECASE,
)


def _strip_dead_s3_urls(text: str) -> str:
    """Remove unsigned S3 object URLs from model-authored text.

    Objects in the reports/images buckets are private, so a bare
    ``https://<bucket>.s3.amazonaws.com/<key>`` URL — which the model likes to
    reconstruct from the ``s3_key``/``bucket`` fields a tool returns — 403s when
    clicked. The working link is the *presigned* URL the frontend already renders
    as a delivery card (PdfDelivery / website card). This strips only the dead,
    unsigned S3 links; a presigned URL (carrying ``X-Amz-Signature``) and any
    external citation URL are left untouched.
    """
    if not text:
        return text

    def _repl(match: "_re_module.Match[str]") -> str:
        url = match.group(0)
        if "X-Amz-Signature" in url or "X-Amz-Credential" in url:
            return url  # presigned — keep it working
        return "(see the card above)"

    return _S3_OBJECT_URL_RE.sub(_repl, text)


# ---------------------------------------------------------------------------
# Parallel research fan-out / fan-in
#
# The brief requires: "Divide the research into sections and design and
# implement the multi-agent collaboration to enable parallel processing and
# efficient information collection."
#
# The researcher used to walk its sub-questions one at a time inside a single
# agent, so a 12-question plan was 12 sequential rounds of web search. Here the
# approved plan's sub-questions are SHARDED across N researcher sub-agents that
# run concurrently, then their findings are merged back into the single JSON
# document the synthesizer already expects.
#
# Concurrency is real, not cooperative: each worker runs in its own thread via
# run_in_executor, and the work is I/O-bound (MCP tool calls over HTTP), so the
# shards genuinely overlap. Each worker gets its own MCP client and its own
# memory session so there is no shared mutable state between them.
# ---------------------------------------------------------------------------

# Upper bound on concurrent researcher sub-agents. Four keeps the Gateway and
# the Bedrock account inside their per-second limits while still cutting
# wall-clock time roughly 3-4x on a standard/deep plan.
MAX_RESEARCH_WORKERS = 4
# Below this many sub-questions the coordination overhead outweighs the win, so
# the pipeline stays on the single-agent path.
MIN_SUBQUESTIONS_FOR_PARALLEL = 3
# Floor on each worker's search budget so a wide fan-out cannot starve a shard.
MIN_WORKER_SEARCH_BUDGET = 4

# Deadlines that stop the phase waiting on a wedged worker.
#
# A worker runs the model and MCP tools synchronously in a thread. The turn
# limit bounds the number of turns, but NOT a single call that never returns —
# a hung Gateway tool (browser, image gen, a stalled search) blocks that thread
# forever, and the consumer loop would wait on it indefinitely while heartbeats
# kept the UI looking "live". Observed in production: a run sat 22 minutes with
# zero progress. These two guards convert "hang forever" into "drop the wedged
# section and synthesize from the rest".
#
# IDLE is the primary signal: a healthy-but-slow worker still emits tool events,
# so silence (no result/tool activity, heartbeats excluded) for this long means
# a worker is stuck. WALL_CLOCK is a hard backstop for the whole fan-out.
WORKER_IDLE_TIMEOUT_SEC = 180
PARALLEL_PHASE_WALL_CLOCK_SEC = 900


# Watchdog for the SEQUENTIAL phase loop (synthesizer, pdf_writer, evaluator,
# menu phases). Unlike the parallel fan-out, these phases run the agent with a
# single blocking agent() call, so between tool results the only queue events
# are heartbeats — even during a legitimate multi-minute extended-thinking
# stretch. That makes a short idle timeout unsafe (it would abort a healthy but
# slow synthesis), so the PRIMARY bound here is a per-phase WALL CLOCK cap set
# well above the known-good maximum. The Bedrock model call is already bounded
# by the 30-minute read timeout; the only truly unbounded failure is a wedged
# MCP/Gateway tool call (a stuck pdf_generator or image generation). This cap
# converts "hang forever" into "abandon the wedged phase and deliver what we
# have". The idle timeout is a generous secondary backstop for total silence.
SEQUENTIAL_PHASE_WALL_CLOCK_SEC: dict[str, int] = {
    "synthesizer": 1200,  # legit synthesis can run "well over 15 min"
    "pdf_writer": 600,
    "website_writer": 600,
    "menu_designer": 900,
    "menu_pdf_writer": 600,
    "menu_website_writer": 600,
    "evaluator": 600,
}
SEQUENTIAL_PHASE_WALL_CLOCK_DEFAULT_SEC = 1200
# No real progress (a tool result, streamed text, or a delivered artifact —
# heartbeats do NOT count) for this long means the phase is almost certainly
# wedged. Set high enough to clear a long thinking gap between tool calls.
SEQUENTIAL_PHASE_IDLE_TIMEOUT_SEC = 600


def _render_report_payload_markdown(payload: dict) -> str:
    """Render a captured pdf_generator tool input into readable markdown.

    When the synthesizer finishes the report and hands it to pdf_generator, the
    full report lives in that tool call's *input*. If the PDF render then wedges
    and the phase watchdog fires, this recovers the report content from the
    captured input so the run still delivers the substance in chat — the PDF is
    the wrapper, the report text is the point. Defensive: unknown shapes are
    coerced rather than raising, because this runs on an already-degraded path.
    """
    if not isinstance(payload, dict):
        return ""
    report = payload.get("report") if isinstance(payload.get("report"), dict) else payload
    topic = payload.get("topic") or report.get("title") or report.get("subtitle") or "Research Report"
    parts = [f"# {topic}\n"]

    def _render_value(value: object) -> str:
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, list):
            lines = []
            for item in value:
                if isinstance(item, str):
                    lines.append(f"- {item.strip()}")
                elif isinstance(item, dict):
                    label = item.get("title") or item.get("finding") or item.get("heading") or ""
                    detail = item.get("detail") or item.get("description") or item.get("content") or ""
                    confidence = item.get("confidence")
                    bullet = "- "
                    if label:
                        bullet += f"**{label}** "
                    if detail:
                        bullet += str(detail)
                    if confidence:
                        bullet += f" _(confidence: {confidence})_"
                    lines.append(bullet.rstrip())
            return "\n".join(lines)
        if isinstance(value, dict):
            return _render_value(list(value.values()))
        return str(value)

    section_order = [
        ("executive_summary", "Executive Summary"),
        ("methodology", "Methodology"),
        ("key_findings", "Key Findings"),
        ("data_analysis", "Data Analysis"),
        ("recommendations", "Recommendations"),
        ("conclusion", "Conclusion"),
        ("references", "References"),
    ]
    for key, heading in section_order:
        if isinstance(report, dict) and report.get(key):
            body = _render_value(report[key])
            if body:
                parts.append(f"\n## {heading}\n\n{body}\n")
    return "\n".join(parts).strip()


def _extract_sub_questions(text: str) -> list[str]:
    """Pull the sub-question list out of the approved plan in the phase input.

    Returns [] when no plan/sub-questions can be found, which is the caller's
    signal to fall back to the sequential researcher.
    """
    plan = _parse_json_object(text)
    if not plan:
        return []

    # The approved plan may be nested under "plan" (research_execute wraps it).
    candidates = [plan]
    nested = plan.get("plan")
    if isinstance(nested, dict):
        candidates.insert(0, nested)

    for candidate in candidates:
        raw = candidate.get("sub_questions")
        if not isinstance(raw, list):
            continue
        questions: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                question = str(item.get("question") or "").strip()
            else:
                question = str(item or "").strip()
            if question:
                questions.append(question)
        if questions:
            return questions
    return []


def _shard_round_robin(items: list[str], buckets: int) -> list[list[str]]:
    """Deal items into `buckets` shards round-robin.

    Round-robin rather than contiguous slicing because plans are written in
    priority order — dealing keeps every shard a mix of high and low priority
    work, so no single worker owns all the expensive questions.
    """
    buckets = max(1, min(buckets, len(items)))
    shards: list[list[str]] = [[] for _ in range(buckets)]
    for i, item in enumerate(items):
        shards[i % buckets].append(item)
    return [s for s in shards if s]


def _worker_prompt(base_prompt: str, shard: list[str], worker_no: int, total: int, budget: int) -> str:
    """Scope the researcher prompt to one shard of the plan."""
    assigned = "\n".join(f"  {i + 1}. {q}" for i, q in enumerate(shard))
    return (
        base_prompt
        + f"""

PARALLEL SHARD ASSIGNMENT (worker {worker_no} of {total}) — MANDATORY:
You are ONE of {total} researcher agents working the same plan concurrently.
You own ONLY the {len(shard)} sub-question(s) listed below. Other workers own
the rest; researching theirs duplicates their work and wastes shared budget.

YOUR ASSIGNED SUB-QUESTIONS:
{assigned}

- Research ONLY these sub-questions, then output the JSON and stop.
- Your personal search budget is {budget} gateway_web_search calls.
- `questions_researched` must contain exactly your assigned sub-question(s).
- Fill `meta_analysis`, `gaps`, `key_insights`, and `citations` for YOUR shard
  only — a coordinator merges every worker's output afterwards.
"""
    )


def _tool_action_label(tool_name: str) -> str:
    """Plain-language verb for a tool, for activity traces.

    Raw gateway names ("gateway_kb_search") read as plumbing; the reader wants
    the action being taken.
    """
    name = (tool_name or "").lower()
    for fragment, label in (
        ("kb_search", "Searching the knowledge base"),
        ("web_search", "Searching the web"),
        ("data_sources", "Querying market data"),
        ("analyze_patterns", "Analyzing patterns"),
        ("image_", "Generating an image"),
        ("video_", "Generating video"),
        ("pdf_generator", "Writing the PDF"),
        ("website_generator", "Building the site"),
        ("extract_pdf_images", "Extracting PDF images"),
        ("recall_memories", "Recalling prior context"),
        ("save_memory", "Saving context"),
        ("retrieve_user_profile", "Loading the client profile"),
    ):
        if fragment in name:
            return label
    return f"Calling {tool_name}"


def _readable_tool_query(raw) -> str:  # noqa: ANN001 - accepts str or dict
    """The human-meaningful argument of a tool call, for activity traces.

    Tool arguments are a JSON blob of which only one field is interesting to a
    reader — the query, question or topic. Returns "" when nothing readable can
    be found, so callers can skip the trace rather than print machine noise.
    """
    data = raw
    if isinstance(raw, str):
        if not raw.strip():
            return ""
        data = _parse_json_object(raw)
        if data is None:
            # Not JSON — a bare string argument is already readable.
            return raw.strip()[:160]
    if not isinstance(data, dict):
        return ""

    for key in ("query", "question", "search_query", "topic", "prompt", "text", "url"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:160]
    return ""


def _summarize_worker_findings(payload: str, index: int, total: int, shard: list[str]) -> str:
    """A substantive completion trace for one research section.

    "Section 3 of 4 complete" told the reader nothing. This reports what the
    section actually produced — how many insights and sources it gathered, and
    its leading insight — so the activity log explains the reasoning behind the
    final report instead of just its bookkeeping.
    """
    header = f"Section {index + 1} of {total} complete"
    data = _parse_json_object(payload) if payload else None
    if not isinstance(data, dict):
        # Worker returned prose (or nothing parseable) — still say something
        # truthful rather than inventing counts.
        covered = f" · covered {len(shard)} sub-question(s)" if shard else ""
        return f"{header}{covered}."

    insights = [str(v).strip() for v in (data.get("key_insights") or []) if str(v).strip()]
    citations = [c for c in (data.get("citations") or []) if str(c).strip()]
    questions = data.get("questions_researched")
    question_count = len(questions) if isinstance(questions, list) else len(shard)

    parts = [f"{question_count} sub-question(s)"]
    if insights:
        parts.append(f"{len(insights)} insight(s)")
    if citations:
        parts.append(f"{len(citations)} source(s)")

    lines = [f"{header} — {', '.join(parts)}."]
    if insights:
        lead = insights[0]
        lines.append(f"Leading finding: {lead[:280]}{'…' if len(lead) > 280 else ''}")

    meta = data.get("meta_analysis")
    if isinstance(meta, dict):
        contradictions = str(meta.get("contradictions") or "").strip()
        if contradictions:
            lines.append(f"Conflicts noted: {contradictions[:200]}{'…' if len(contradictions) > 200 else ''}")

    return "\n".join(lines)


def _merge_research_findings(payloads: list[str]) -> str:
    """Fan-in: merge per-worker researcher JSON into one findings document.

    Order is preserved (worker 0's questions first) so the merged document still
    reads in plan order. Unparseable worker output is kept as a raw note rather
    than dropped, so partial results never vanish silently.
    """
    import json

    questions: list[dict] = []
    insights: list[str] = []
    citations: list[str] = []
    images: list[dict] = []
    # Purchased datasets, keyed by id so two workers buying the same dataset
    # collapse to one entry rather than double-reporting the spend.
    paid_sources: dict[str, dict] = {}
    meta_parts: dict[str, list[str]] = {
        "patterns": [],
        "contradictions": [],
        "evidence_strength": [],
        "unexpected_findings": [],
    }
    cross_refs: list[str] = []
    gaps: list[str] = []
    unparsed: list[str] = []

    for payload in payloads:
        data = _parse_json_object(payload)
        if not data:
            if payload and payload.strip():
                unparsed.append(payload.strip())
            continue

        found = data.get("questions_researched")
        if isinstance(found, list):
            questions.extend(q for q in found if isinstance(q, dict))

        meta = data.get("meta_analysis")
        if isinstance(meta, dict):
            for key, bucket in meta_parts.items():
                value = str(meta.get(key) or "").strip()
                if value:
                    bucket.append(value)

        for key, bucket in (("cross_references", cross_refs), ("gaps", gaps)):
            value = str(data.get(key) or "").strip()
            if value:
                bucket.append(value)

        for key, bucket in (("key_insights", insights), ("citations", citations)):
            value = data.get(key)
            if isinstance(value, list):
                bucket.extend(str(v).strip() for v in value if str(v).strip())

        imgs = data.get("images")
        if isinstance(imgs, list):
            images.extend(i for i in imgs if isinstance(i, dict))

        bought = data.get("paid_sources")
        if isinstance(bought, list):
            for entry in bought:
                if not isinstance(entry, dict):
                    continue
                dataset_id = str(entry.get("dataset_id") or "").strip()
                if dataset_id:
                    paid_sources.setdefault(dataset_id, entry)

    def _dedupe(values: list[str]) -> list[str]:
        seen: set[str] = set()
        out: list[str] = []
        for value in values:
            if value not in seen:
                seen.add(value)
                out.append(value)
        return out

    merged: dict = {
        "questions_researched": questions,
        "meta_analysis": {key: " ".join(parts) for key, parts in meta_parts.items()},
        "cross_references": "\n".join(cross_refs),
        "gaps": "\n".join(gaps),
        "key_insights": _dedupe(insights),
        "citations": _dedupe(citations),
        # The PDF embeds at most a handful of visuals; keep the first 3 so a
        # wide fan-out cannot flood the report with imagery.
        "images": images[:3],
        # Carried through fan-in so the synthesizer can attribute purchased
        # figures in the report. An empty list is meaningful: it says the run
        # spent nothing.
        "paid_sources": list(paid_sources.values()),
        "parallel_execution": {
            "workers": len(payloads),
            "questions_covered": len(questions),
        },
    }
    if unparsed:
        merged["unstructured_worker_notes"] = unparsed
    return json.dumps(merged)


async def _run_parallel_research(
    phase: dict,
    accumulated: str,
    query: str,
    user_id: str,
    session_id: str,
    model_id: str,
    pipeline_scope,  # noqa: ANN001 - PipelineScopeHook
    access_token: str,
    payment_budget_usd: str = "",
):
    """Run the researcher phase as concurrent shard workers.

    Async generator. Yields the same event shapes as the sequential phase loop
    (`_ui`/AgentActivity, `phase_progress`, heartbeats, thinking) and finishes
    by yielding a terminal `{"__result__": merged_json}` event.

    Yields `{"__fallback__": True}` and stops if the plan cannot be sharded, so
    the caller can run the normal single-agent path instead.
    """
    import queue as thread_queue

    agent_name = phase["name"]
    role = phase["role"]
    messages = phase["messages"]
    estimated_duration = phase["estimated_duration"]
    total_budget = phase.get("search_budget") or 50

    sub_questions = _extract_sub_questions(accumulated)
    if len(sub_questions) < MIN_SUBQUESTIONS_FOR_PARALLEL:
        print(
            f"[ORCHESTRATOR] Parallel research skipped — found {len(sub_questions)} sub-question(s), "
            f"need {MIN_SUBQUESTIONS_FOR_PARALLEL}"
        )
        yield {"__fallback__": True}
        return

    shards = _shard_round_robin(sub_questions, MAX_RESEARCH_WORKERS)
    worker_count = len(shards)
    if worker_count < 2:
        yield {"__fallback__": True}
        return

    per_worker_budget = max(MIN_WORKER_SEARCH_BUDGET, total_budget // worker_count)
    turn_limit = per_worker_budget + PHASE_TURN_HEADROOM
    print(
        f"[ORCHESTRATOR] Parallel research: {len(sub_questions)} sub-questions across "
        f"{worker_count} workers ({per_worker_budget} searches each, turn limit {turn_limit})"
    )

    # Split the SPEND budget across workers too. Each worker's plugin opens its
    # own PaymentSession, so handing every worker the full budget would authorize
    # `worker_count` times the amount the user approved.
    payment_addendum = _payment_prompt_addendum()
    worker_payment_budget = ""
    if payment_addendum:
        total_spend = _decimal_or_default(
            payment_budget_usd or os.environ.get("PAYMENT_BUDGET_USD") or DEFAULT_PAYMENT_BUDGET_USD
        )
        worker_payment_budget = f"{(total_spend / worker_count):.2f}"
        print(
            f"[PAYMENTS] Spend budget ${total_spend:.2f} split across {worker_count} "
            f"workers (${worker_payment_budget} each)"
        )

    yield {
        "thinking": {
            "agent": agent_name,
            "content": (
                f"Dividing {len(sub_questions)} sub-questions into {worker_count} sections and "
                f"researching them in parallel, {per_worker_budget} searches each."
            ),
        }
    }

    # Show WHAT each section will investigate. The division of labour is a real
    # decision the reader cares about; announcing only the count told them
    # nothing about how the brief was interpreted.
    for i, shard in enumerate(shards):
        yield {
            "thinking": {
                "agent": agent_name,
                "content": "Section {} of {} will investigate:\n{}".format(
                    i + 1,
                    worker_count,
                    "\n".join(f"- {q}" for q in shard),
                ),
            }
        }

    tq: thread_queue.Queue = thread_queue.Queue()
    _DONE = object()
    results: dict[int, str] = {}
    errors: dict[int, str] = {}

    def _run_worker(index: int, shard: list[str]) -> None:
        """One researcher sub-agent. Runs in its own thread."""
        try:
            # Per-worker MCP client and memory session: no shared mutable state,
            # so a slow or failing shard cannot corrupt a sibling's session.
            worker_client = _create_gateway_mcp_client(access_token)
            worker_model = _build_model(
                model_id,
                temperature=0.1,
                thinking_budget=phase.get("thinking_budget", 4096),
                max_tokens=phase.get("max_tokens", 65535),
            )
            worker_plugins = None
            worker_plugin = None
            if worker_payment_budget:
                worker_plugin = _build_payments_plugin(
                    user_id,
                    worker_payment_budget,
                    agent_name=f"{agent_name}_w{index}",
                )
                worker_plugins = [worker_plugin] if worker_plugin else None

            worker_agent = _create_agent(
                f"{agent_name}_w{index}",
                _worker_prompt(
                    phase["prompt"] + payment_addendum,
                    shard,
                    index + 1,
                    worker_count,
                    per_worker_budget,
                ),
                user_id,
                f"{session_id}-p{index}",
                worker_client,
                worker_model,
                pipeline_scope=pipeline_scope,
                plugins=worker_plugins,
            )

            # Last tool-use id seen by THIS worker. Strands re-emits
            # `current_tool_use` for every input delta, so without this the
            # same call would be reported dozens of times.
            seen_tool_use_id = [None]
            # Accumulated argument JSON per tool call, so the trace can name the
            # actual query rather than just the tool.
            tool_inputs: dict[str, str] = {}

            def _worker_callback(**kwargs):
                """Report tool activity so progress and the UI reflect real work.

                Three signals are emitted:

                * `tool_use` on first sight of a new tool call, carrying the
                  tool NAME. The sequential path streams this so each flow node
                  can show the AWS services that step exercised and the run
                  report can count invocations; without it the parallel path
                  left both empty.
                * `tool_query` once the arguments have streamed in, so the
                  reader sees WHAT was searched, not merely that something was.
                * `tool_call` when a result comes back, which drives the
                  work-based half of the progress curve.
                """
                try:
                    current_tool_use = kwargs.get("current_tool_use")
                    if current_tool_use and current_tool_use.get("name"):
                        tool_use_id = current_tool_use.get("toolUseId", "")
                        tool_name = current_tool_use.get("name", "")
                        if tool_use_id != seen_tool_use_id[0]:
                            seen_tool_use_id[0] = tool_use_id
                            tq.put(("tool_use", (index, tool_use_id, tool_name)))
                        # Strands reports the accumulated arguments as they
                        # stream; keep the longest sighting, which is complete.
                        streamed = current_tool_use.get("input")
                        if isinstance(streamed, str) and len(streamed) > len(tool_inputs.get(tool_use_id, "")):
                            tool_inputs[tool_use_id] = streamed

                    message = kwargs.get("message")
                    if not message:
                        return
                    msg = message if isinstance(message, dict) else getattr(message, "__dict__", {})
                    for block in msg.get("content", []):
                        if not isinstance(block, dict):
                            continue
                        # A tool_use block in a completed message carries the
                        # final, fully-formed arguments — the most reliable
                        # place to read what was actually asked.
                        use = block.get("toolUse")
                        if isinstance(use, dict) and use.get("name"):
                            query = _readable_tool_query(use.get("input"))
                            if query:
                                tq.put(("tool_query", (index, use["name"], query)))
                        if "toolResult" in block:
                            tq.put(("tool_call", index))
                except Exception as exc:  # never let telemetry break research
                    logger.debug("Parallel worker callback failed: %s", exc)

            worker_agent.callback_handler = _worker_callback

            worker_input = (
                f"{accumulated}\n\nOriginal query: {query}\n\n"
                f"Research ONLY your assigned sub-questions (worker {index + 1} of {worker_count})."
            )
            result = worker_agent(worker_input, limits={"turns": turn_limit})
            if getattr(result, "stop_reason", None) == "limit_turns":
                print(f"[ORCHESTRATOR] researcher worker {index + 1} hit the {turn_limit}-turn ceiling")
            # Read this shard's real spend before the thread exits.
            spend = _read_payment_spend(worker_plugin)
            if spend:
                tq.put(("spend", spend))
            tq.put(("result", (index, str(result) if result else "")))
        except Exception as exc:
            print(f"[ORCHESTRATOR] researcher worker {index + 1} failed: {exc}")
            tq.put(("error", (index, str(exc))))
        finally:
            tq.put((_DONE, index))

    _stop_heartbeat = threading.Event()

    def _heartbeat_thread():
        while not _stop_heartbeat.wait(10):
            tq.put(("heartbeat", None))

    heartbeat = threading.Thread(target=_heartbeat_thread, daemon=True)
    heartbeat.start()

    loop = asyncio.get_running_loop()
    futures = [loop.run_in_executor(None, _run_worker, i, shard) for i, shard in enumerate(shards)]

    start_time = time.monotonic()
    tool_calls = 0
    finished = 0
    tick = 0
    spend_total = 0.0
    spend_budget_total = 0.0
    spend_sessions = 0
    # Reset by any real progress event (tool activity, a completed shard). NOT
    # by heartbeats — those fire every 10s regardless of whether work is
    # happening, so counting them would mask a wedged worker.
    last_progress = time.monotonic()
    timed_out = False

    try:
        while finished < worker_count:
            while tq.empty():
                now = time.monotonic()
                if now - last_progress > WORKER_IDLE_TIMEOUT_SEC:
                    print(
                        f"[ORCHESTRATOR] Parallel research idle for "
                        f"{WORKER_IDLE_TIMEOUT_SEC}s with {finished}/{worker_count} sections done "
                        f"— abandoning wedged worker(s)"
                    )
                    timed_out = True
                    break
                if now - start_time > PARALLEL_PHASE_WALL_CLOCK_SEC:
                    print(
                        f"[ORCHESTRATOR] Parallel research hit the "
                        f"{PARALLEL_PHASE_WALL_CLOCK_SEC}s wall-clock cap with "
                        f"{finished}/{worker_count} sections done — proceeding with partial results"
                    )
                    timed_out = True
                    break
                await asyncio.sleep(0.1)
            if timed_out:
                break

            tag, value = tq.get_nowait()
            # Any event other than a heartbeat is real progress.
            if tag != "heartbeat":
                last_progress = time.monotonic()

            if tag is _DONE:
                finished += 1
                # The worker's "result" is queued before its _DONE, so the
                # findings are available here and the trace can report what the
                # section produced rather than merely that it ended.
                yield {
                    "thinking": {
                        "agent": agent_name,
                        "content": _summarize_worker_findings(
                            results.get(value, ""),
                            value,
                            worker_count,
                            shards[value] if value < len(shards) else [],
                        )
                        if value not in errors
                        else (f"Section {value + 1} of {worker_count} failed: {str(errors[value])[:200]}"),
                    }
                }
            elif tag == "result":
                index, text = value
                results[index] = text
            elif tag == "error":
                index, err = value
                errors[index] = err
            elif tag == "spend":
                # Sum the shards: each worker had its own session, so total
                # committed spend for the phase is the sum of their sessions.
                spend_total += _decimal_or_default(value.get("spent", "0"), default=0.0)
                spend_budget_total += _decimal_or_default(value.get("budget", "0"), default=0.0)
                spend_sessions += 1
            elif tag == "tool_call":
                tool_calls += 1
            elif tag == "tool_use":
                worker_index, tool_use_id, tool_name = value
                # Same shape the sequential phase streams, so the existing
                # parser attributes the call to this phase's node and the run
                # report counts it. Worker ids are namespaced because the
                # shards run concurrently and Strands only guarantees the id is
                # unique within one agent.
                # `telemetry_only` keeps this out of the chat transcript. These
                # calls happen inside worker sub-agents whose arguments and
                # results are never streamed, so a chat tool card would sit
                # empty forever — dozens of blank dropdowns burying the
                # conversation. The workflow panel is where they belong, so the
                # event still drives the node chips and the run report count.
                yield {
                    "current_tool_use": {
                        "toolUseId": f"w{worker_index}-{tool_use_id}",
                        "name": tool_name,
                    },
                    "delta": {"toolUse": {"input": ""}},
                    "telemetry_only": True,
                }
            elif tag == "tool_query":
                # What the section actually asked. This is the reasoning the
                # reader wants: which questions the agent chose to put to the
                # knowledge base and the web, in its own words.
                worker_index, tool_name, query = value
                yield {
                    "thinking": {
                        "agent": agent_name,
                        "content": (f"Section {worker_index + 1} · {_tool_action_label(tool_name)}: “{query}”"),
                    }
                }
            elif tag == "heartbeat":
                tick += 1
                yield {"data": "", "heartbeat": True}

            elapsed = time.monotonic() - start_time

            # Same dual-curve progress as the sequential phase: whichever of
            # elapsed-time or completed-work is further along wins, so the bar
            # neither freezes nor claims completion early.
            if elapsed <= estimated_duration:
                time_progress = int((elapsed / estimated_duration) * 90)
            else:
                overtime = (elapsed - estimated_duration) / estimated_duration
                time_progress = 90 + int(9 * (overtime / (overtime + 1)))
            work_progress = int((tool_calls / max(1, total_budget)) * 90)
            # Completed workers are the most trustworthy signal of all.
            done_progress = int((finished / worker_count) * 95)
            progress = min(99, max(time_progress, work_progress, done_progress))

            if tag == "heartbeat":
                yield {
                    "_ui": {
                        "component": "AgentActivity",
                        "props": {
                            "agent": agent_name,
                            "phase": role,
                            "progress": progress,
                            "activity": (
                                f"{messages[tick % len(messages)]} "
                                f"({worker_count - finished} of {worker_count} sections running)"
                            ),
                            "elapsed": round(elapsed),
                            "done": False,
                        },
                    }
                }
                yield {"phase_progress": {"phase": role, "progress": progress}}
    finally:
        _stop_heartbeat.set()
        heartbeat.join(timeout=2)
        # Cancelling the executor future stops us awaiting the worker; it cannot
        # kill a thread already blocked in a synchronous tool call. That thread
        # is abandoned and dies with the session's microVM. The point is that
        # the phase stops waiting and the pipeline moves on.
        for future in futures:
            future.cancel()

    # Record any shard that never reported back as a timeout, so the notice and
    # the merge treat it the same as an explicit failure.
    if timed_out:
        for i in range(worker_count):
            if i not in results and i not in errors:
                errors[i] = f"timed out (no result after {WORKER_IDLE_TIMEOUT_SEC}s idle)"

    if not results:
        # Every shard failed or hung — surface it rather than handing the
        # synthesizer an empty findings document it would happily write from.
        detail = "; ".join(errors.values()) or "no worker produced output"
        raise RuntimeError(f"All {worker_count} parallel research workers failed: {detail}")

    if errors:
        yield {
            "thinking": {
                "agent": agent_name,
                "content": (
                    f"{len(errors)} of {worker_count} sections did not finish "
                    f"({'timed out' if timed_out else 'failed'}); merging the "
                    f"{len(results)} that completed so the report still ships."
                ),
            }
        }

    # Real spend for the phase, summed across shard sessions. Emitted even when
    # zero: "$0.00 of $1.00" is a meaningful result — it says the researcher
    # judged free search sufficient and did not spend the budget.
    if spend_sessions:
        yield {
            "payment_spend": {
                "spent": f"{spend_total:.4f}",
                "budget": f"{spend_budget_total:.2f}",
                "currency": "USD",
                "sessions": spend_sessions,
            }
        }
        yield {
            "thinking": {
                "agent": agent_name,
                "content": (
                    f"Paid data spend: ${spend_total:.4f} of ${spend_budget_total:.2f} "
                    f"approved across {spend_sessions} session(s)."
                ),
            }
        }

    ordered = [results[i] for i in sorted(results)]
    yield {"__result__": _merge_research_findings(ordered)}


# ---------------------------------------------------------------------------
# Evaluation scorecard parsing (LLM-as-a-judge → structured card)
# ---------------------------------------------------------------------------

# Maps our human scorecard dimensions onto Bedrock Evaluations' metric names, so
# the UI can label each dimension with the managed metric it corresponds to.
_EVAL_METRIC_MAP = [
    ("align", ("alignment", "Correctness")),
    ("comprehen", ("comprehensiveness", "Completeness")),
    ("ground", ("groundedness", "Faithfulness")),
    ("citation", ("citations", "Citation precision")),
    ("coher", ("coherence", "Coherence")),
]


def _eval_metric_for(label: str) -> tuple[str, str]:
    """Return (stable_key, Bedrock metric name) for a scorecard dimension label."""
    low = label.lower()
    for needle, (key, metric) in _EVAL_METRIC_MAP:
        if needle in low:
            return key, metric
    key = _re_module.sub(r"[^a-z0-9]+", "_", low).strip("_") or "dimension"
    return key, "Relevance"


def _extract_plan_criteria(text: str) -> list[str]:
    """Best-effort pull of `evaluation_criteria` from an approved plan blob.

    The execute pipeline receives the approved plan as its initial input; when it
    carries the plan JSON we surface the same criteria the report is judged
    against. Returns an empty list when nothing parseable is present.
    """
    if not text:
        return []
    m = _re_module.search(r'"evaluation_criteria"\s*:\s*\[(.*?)\]', text, _re_module.S)
    if not m:
        return []
    try:
        arr = _json_module.loads("[" + m.group(1) + "]")
        return [str(c).strip() for c in arr if str(c).strip()][:6]
    except Exception:
        return [s.strip() for s in _re_module.findall(r'"([^"]+)"', m.group(1))][:6]


def _extract_bullets_after(text: str, heading: str, limit: int = 4) -> list[str]:
    """Pull bullet lines following a heading like 'Top gaps' in the scorecard."""
    if not text:
        return []
    idx = text.lower().find(heading.lower())
    if idx < 0:
        return []
    bullets = _re_module.findall(r"^\s*[-*]\s+(.*\S)\s*$", text[idx:], _re_module.M)
    return [b.strip().lstrip("*").strip() for b in bullets if b.strip()][:limit]


def _parse_evaluation_scorecard(text: str, judge_model: str, criteria: list[str]) -> dict | None:
    """Parse the evaluator's markdown scorecard into EvaluationScorecard props.

    The evaluator streams a fixed-format table (see EVALUATION_PROMPT). This turns
    that table into structured props the frontend renders — dimensions with
    0-100 scores and their Bedrock metric names, an overall, a pass/revise gate,
    and the top gaps. Returns None when no table is found (the markdown still
    streamed into the trace, so nothing is lost).
    """
    if not text:
        return None
    row_re = _re_module.compile(
        r"^\|\s*\*{0,2}([^|]+?)\*{0,2}\s*\|\s*\*{0,2}\s*(\d{1,3})\s*/\s*100\s*\*{0,2}\s*\|\s*([^|]*?)\s*\|",
        _re_module.M,
    )
    rows = row_re.findall(text)
    if not rows:
        return None

    dimensions: list[dict] = []
    overall: int | None = None
    summary = ""
    for raw_label, score_s, notes in rows:
        label = raw_label.strip()
        try:
            score = max(0, min(100, int(score_s)))
        except ValueError:
            continue
        if "overall" in label.lower():
            overall = score
            summary = notes.strip()
            continue
        key, metric = _eval_metric_for(label)
        dimensions.append({"key": key, "label": label, "score": score, "rationale": notes.strip(), "metricRef": metric})

    if not dimensions:
        return None
    if overall is None:
        overall = round(sum(d["score"] for d in dimensions) / len(dimensions))

    return {
        "target": "report",
        "judgeModel": judge_model,
        "overall": overall,
        "verdict": "pass" if overall >= 80 else "revise",
        "summary": summary,
        "criteria": criteria,
        "dimensions": dimensions,
        "gaps": _extract_bullets_after(text, "Top gaps"),
    }


async def _run_pipeline(
    phases,
    query,
    user_id,
    session_id,
    requested_model="",
    initial_accumulated="",
    mode: str = "",
    payment_budget_usd: str = "",
    pinned_report_ids: list[str] | None = None,
):
    """Run a multi-phase agent pipeline (research or menu).

    Each phase creates a Strands Agent with the phase's system prompt, runs it
    in a thread executor with heartbeat keepalives, and feeds its output to the
    next phase.

    Args:
        initial_accumulated: If provided, used as the starting input instead of
            the raw query. Used by research_execute mode to inject the approved plan.
        mode: Orchestrator mode (e.g., "research_execute", "menu"). Drives the
            PipelineScopeHook that injects the correct KB read filter and the
            correct pdf_generator `pipeline` value for this pipeline run.
    """
    print(
        f"[ORCHESTRATOR] Starting pipeline ({len(phases)} phases) for user: {user_id}, session: {session_id}, mode: {mode or 'unspecified'}"
    )
    print(f"[ORCHESTRATOR] Query: {query}")

    # Setup: one Gateway MCP client shared by all agents; model built per-phase
    # so each phase can have its own thinking budget.
    try:
        access_token = get_gateway_access_token()
        gateway_client = _create_gateway_mcp_client(access_token)

        model_id = requested_model or os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6")
        print(f"[ORCHESTRATOR] Using model: {model_id}")
    except Exception as e:
        print(f"[ORCHESTRATOR] Setup failed: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": f"Setup failed: {e}"}
        return

    accumulated = initial_accumulated or query
    menu_designer_output = ""
    # Last report produced by this run, re-emitted as a link once it finishes.
    delivered_pdf: dict | None = None
    # Last generated website (e.g. a FAQ site) — delivered as a card so the user
    # gets the working presigned link rather than a URL the model pasted.
    delivered_website: dict | None = None

    # Build one PipelineScopeHook for the whole pipeline — per-mode KB filter +
    # pdf_generator write + (for the catalog flow) the pinned research run.
    _pipeline_cfg = mode_config(mode)
    _pipeline_scope = PipelineScopeHook(
        write_pipeline=_pipeline_cfg.get("write"),
        read_filter=_pipeline_cfg.get("read_filter"),
        is_archive=_pipeline_cfg.get("archive", False),
        report_ids=pinned_report_ids or None,
    )
    if pinned_report_ids:
        print(f"[ORCHESTRATOR] Pinned to research run(s): {pinned_report_ids}")
    print(
        f"[ORCHESTRATOR] Pipeline scope: write={_pipeline_cfg.get('write')!r}, "
        f"read_filter={_pipeline_cfg.get('read_filter')!r}, archive={_pipeline_cfg.get('archive', False)}"
    )

    for phase in phases:
        agent_name = phase["name"]
        role = phase["role"]
        messages = phase["messages"]
        estimated_duration = phase["estimated_duration"]
        thinking_budget = phase.get("thinking_budget", 4096)
        phase_max_tokens = phase.get("max_tokens", 65535)

        print(
            f"[ORCHESTRATOR] === Starting phase: {agent_name} (thinking_budget={thinking_budget}, max_tokens={phase_max_tokens}) ==="
        )

        # Build model per-phase — phases like synthesizer need a larger thinking
        # budget to reason over the full researcher output. A phase may also pin
        # its own model (e.g. the evaluator uses a distinct Bedrock judge model
        # so the evaluation is not self-grading).
        phase_model_id = phase.get("model_id") or model_id
        if phase_model_id != model_id:
            print(f"[ORCHESTRATOR] Phase '{agent_name}' uses model: {phase_model_id}")
        bedrock_model = _build_model(
            phase_model_id, temperature=0.1, thinking_budget=thinking_budget, max_tokens=phase_max_tokens
        )

        # Emit phase start
        yield {"agent_phase": {"agent": agent_name, "phase": role, "status": "start"}}
        yield {
            "_ui": {
                "component": "AgentActivity",
                "props": {
                    "agent": agent_name,
                    "phase": role,
                    "progress": 0,
                    "activity": messages[0],
                    "elapsed": 0,
                    "done": False,
                },
            }
        }

        # ── Parallel fan-out (researcher only) ─────────────────────────
        # Shard the plan's sub-questions across concurrent sub-agents. Falls
        # through to the single-agent path below when the plan is too small to
        # shard or cannot be parsed, so this is strictly an optimization.
        if phase.get("parallel"):
            parallel_text: str | None = None
            fell_back = False
            parallel_started = time.monotonic()
            try:
                async for event in _run_parallel_research(
                    phase,
                    accumulated,
                    query,
                    user_id,
                    session_id,
                    model_id,
                    _pipeline_scope,
                    access_token,
                    payment_budget_usd=payment_budget_usd,
                ):
                    if "__fallback__" in event:
                        fell_back = True
                        break
                    if "__result__" in event:
                        parallel_text = event["__result__"]
                        continue
                    yield event
            except Exception as exc:
                print(f"[ORCHESTRATOR] Parallel research failed, falling back to sequential: {exc}")
                traceback.print_exc()
                fell_back = True

            if parallel_text is not None and not fell_back:
                elapsed_parallel = round(time.monotonic() - parallel_started)
                yield {
                    "_ui": {
                        "component": "AgentActivity",
                        "props": {
                            "agent": agent_name,
                            "phase": role,
                            "progress": 100,
                            "activity": "Complete",
                            "elapsed": elapsed_parallel,
                            "done": True,
                        },
                    }
                }
                yield {"agent_phase": {"agent": agent_name, "phase": role, "status": "end"}}
                accumulated = f"Previous agent ({agent_name}) output:\n{parallel_text}\n\nOriginal query: {query}"
                continue
            print(f"[ORCHESTRATOR] {agent_name}: running sequential single-agent research")

        try:
            # Paid premium data is only offered to the research phase — it is
            # the only phase that gathers new evidence, so it is the only one
            # with anything to buy.
            phase_plugins = None
            phase_prompt = phase["prompt"]
            if phase.get("parallel"):
                addendum = _payment_prompt_addendum()
                if addendum:
                    phase_prompt = phase_prompt + addendum
                    phase_plugins = _build_payments_plugin(user_id, payment_budget_usd, agent_name=agent_name)
                    phase_plugins = [phase_plugins] if phase_plugins else None

            agent = _create_agent(
                agent_name,
                phase_prompt,
                user_id,
                session_id,
                gateway_client,
                bedrock_model,
                pipeline_scope=_pipeline_scope,
                plugins=phase_plugins,
            )
        except Exception as e:
            print(f"[ORCHESTRATOR] Failed to create {agent_name} agent: {e}")
            traceback.print_exc()
            yield {
                "_ui": {
                    "component": "AgentActivity",
                    "props": {
                        "agent": agent_name,
                        "phase": role,
                        "progress": 100,
                        "activity": "Failed",
                        "elapsed": 0,
                        "done": True,
                    },
                }
            }
            yield {"agent_phase": {"agent": agent_name, "phase": role, "status": "error"}}
            if role == "evaluation":
                # The judge model is optional and runs last, after the report and
                # PDF are already delivered. If it can't even be created (e.g. the
                # judge model isn't enabled), skip scoring rather than failing the
                # whole run.
                yield {
                    "data": (
                        "\n\n> **Evaluation unavailable** — the automated quality score "
                        "could not run this time. Your report above is complete.\n\n"
                    ),
                    "_agent": agent_name,
                }
                continue
            yield {"status": "error", "error": f"Failed to create {agent_name}: {e}"}
            return

        # Stream agent output with heartbeats and UI progress.
        # The agent runs in a BACKGROUND THREAD (via run_in_executor) because
        # Strands stream_async() blocks the event loop during synchronous MCP
        # tool calls. A thread-safe queue bridges the agent thread and the
        # async generator, and a heartbeat thread guarantees SSE keepalives
        # every 10s regardless of what the agent is doing.
        import queue as thread_queue

        agent_text = ""
        start_time = time.monotonic()
        tick = 0
        tool_calls = 0
        search_budget = phase.get("search_budget")
        _DONE = object()
        _HEARTBEAT = object()
        _ERROR = object()
        _TRUNCATED = object()
        phase_truncated_at: int | None = None
        tq: thread_queue.Queue = thread_queue.Queue()

        # Callback handler to intercept tool results (e.g. presigned PDF URLs)
        # so we can emit them directly without relying on the LLM to relay them.
        def _pipeline_callback(**kwargs):
            message = kwargs.get("message")
            if not message:
                return
            try:
                msg = message if isinstance(message, dict) else getattr(message, "__dict__", {})
                for block in msg.get("content", []):
                    if not isinstance(block, dict):
                        continue
                    # Capture the report the model hands to pdf_generator. If the
                    # PDF render later wedges and the watchdog fires, this input
                    # is the only place the finished report still exists, so it
                    # lets the timeout path deliver the content instead of an
                    # empty run. Captured for any *_pdf_generator tool.
                    use = block.get("toolUse")
                    if isinstance(use, dict) and "pdf_generator" in (use.get("name") or ""):
                        tool_input = use.get("input")
                        if isinstance(tool_input, dict):
                            tq.put(("synth_payload", tool_input))
                    if "toolResult" not in block:
                        continue
                    # Count every completed tool call so the phase can drive its
                    # progress bar off real work (e.g. searches against the
                    # researcher's search_budget) rather than elapsed time alone.
                    tq.put(("tool_call", None))
                    tr = block["toolResult"]
                    for part in tr.get("content", []):
                        text_val = part.get("text", "") if isinstance(part, dict) else ""
                        if "presigned" not in text_val and '"url"' not in text_val:
                            continue
                        try:
                            import json as _cbjson

                            parsed = _cbjson.loads(text_val)
                            url = parsed.get("url", "")
                            s3_key = parsed.get("s3_key", "")
                            is_signed = bool(url) and ("X-Amz-Signature" in url or "Signature=" in url)
                            # pdf_generator is the only tool that sets this
                            # discriminator; website_generator also returns a
                            # presigned `url` + `s3_key`, so it is matched
                            # separately below rather than mistaken for a PDF.
                            if parsed.get("artifact") == "pdf":
                                if is_signed:
                                    tq.put(
                                        (
                                            "pdf_url",
                                            {
                                                "url": url,
                                                "s3_key": s3_key,
                                                # Durable handle. `url` dies after
                                                # an hour, and the viewer outlives
                                                # that — it reloads whenever the
                                                # page is revisited — so it
                                                # re-signs from this rather than
                                                # reusing the link above.
                                                "report_id": parsed.get("report_id", ""),
                                                "filename": s3_key.split("/")[-1] if s3_key else "",
                                            },
                                        )
                                    )
                            elif (
                                parsed.get("success")
                                and is_signed
                                and s3_key
                                and ("websites/" in s3_key or s3_key.endswith("index.html"))
                            ):
                                # A generated website (e.g. the FAQ site). Deliver
                                # the presigned link as a card so the user never
                                # has to click the dead unsigned URL the model
                                # narrates.
                                tq.put(
                                    (
                                        "website_url",
                                        {
                                            "url": url,
                                            "download_url": parsed.get("download_url", ""),
                                            "s3_key": s3_key,
                                            "title": parsed.get("title", ""),
                                            "sections": parsed.get("sections", []),
                                        },
                                    )
                                )
                        except Exception as exc:
                            logger.warning(
                                "Pipeline callback failed to parse tool-result JSON: %s (text=%r)",
                                exc,
                                text_val[:200],
                            )
            except Exception as exc:
                logger.warning("Pipeline callback failed walking message content: %s", exc)

        agent.callback_handler = _pipeline_callback

        turn_limit = _phase_turn_limit(agent_name, phase.get("search_budget"))

        def _run_agent_sync():
            """Run the agent synchronously in a worker thread."""
            try:
                result = agent(accumulated, limits={"turns": turn_limit})
                # Extract final text from the synchronous result
                text = str(result) if result else ""
                if getattr(result, "stop_reason", None) == "limit_turns":
                    # Truncated, not failed: the findings gathered so far are
                    # still worth passing on. Say so rather than presenting a
                    # partial sweep as a complete one.
                    print(f"[ORCHESTRATOR] {agent_name} hit the {turn_limit}-turn ceiling")
                    tq.put((_TRUNCATED, turn_limit))
                tq.put(("text", text))
            except Exception as exc:
                tq.put((_ERROR, exc))
            finally:
                tq.put((_DONE, None))

        # Heartbeat thread — fires every 10s independent of agent work
        _stop_heartbeat = threading.Event()

        def _heartbeat_thread():
            while not _stop_heartbeat.wait(10):
                tq.put((_HEARTBEAT, None))

        heartbeat_thread = threading.Thread(target=_heartbeat_thread, daemon=True)
        heartbeat_thread.start()

        # Run agent in executor so it doesn't block the event loop
        loop = asyncio.get_running_loop()
        agent_future = loop.run_in_executor(None, _run_agent_sync)

        # Watchdog state: a wall-clock cap plus an idle backstop so a wedged
        # tool call can no longer freeze the phase forever. last_progress is
        # reset by any real event (below) but never by a heartbeat.
        phase_wall_clock = SEQUENTIAL_PHASE_WALL_CLOCK_SEC.get(
            agent_name, SEQUENTIAL_PHASE_WALL_CLOCK_DEFAULT_SEC
        )
        last_progress = time.monotonic()
        phase_timed_out = False
        pending_report_payload: dict | None = None

        try:
            while True:
                # Poll the thread-safe queue without blocking the event loop
                while tq.empty():
                    now = time.monotonic()
                    if (now - start_time > phase_wall_clock) or (
                        now - last_progress > SEQUENTIAL_PHASE_IDLE_TIMEOUT_SEC
                    ):
                        phase_timed_out = True
                        break
                    await asyncio.sleep(0.1)
                if phase_timed_out:
                    break

                tag, value = tq.get_nowait()

                # Any event other than a heartbeat is real progress — reset the
                # idle deadline. The wall-clock deadline is never reset.
                if tag is not _HEARTBEAT:
                    last_progress = time.monotonic()

                if tag is _DONE:
                    break

                if tag is _ERROR:
                    raise value

                if tag is _TRUNCATED:
                    phase_truncated_at = value
                    continue

                if tag == "synth_payload":
                    pending_report_payload = value
                    continue

                # Count completed tool calls before computing progress so the
                # work-based curve below reflects this call immediately.
                if tag == "tool_call":
                    tool_calls += 1

                elapsed = time.monotonic() - start_time
                # Progress that never freezes. The old formula hard-capped at
                # 95% once elapsed reached the estimate, so a phase that runs
                # longer than its estimate (common for the researcher, whose
                # tool calls keep climbing) sat at 95% indefinitely and looked
                # hung.
                #
                # Time curve: linear to 90% across the estimate, then creep from
                # 90 toward 99 during overtime — closing the remaining gap the
                # longer it runs. Always moves while the phase is alive but never
                # claims 100% until the phase actually completes (the terminal
                # "Complete" event sets 100).
                if elapsed <= estimated_duration:
                    time_progress = int((elapsed / estimated_duration) * 90)
                else:
                    overtime_ratio = (elapsed - estimated_duration) / estimated_duration
                    time_progress = 90 + int(9 * (overtime_ratio / (overtime_ratio + 1)))

                # Work curve: for phases with a search budget (the researcher),
                # drive progress off the actual number of completed tool calls
                # against that budget. This is the signal the user watches climb,
                # so the bar tracks real work instead of a clock. Capped at 90%
                # because the researcher still has to write findings up after its
                # last search.
                work_progress = 0
                if search_budget:
                    work_progress = int((tool_calls / search_budget) * 90)

                # Take whichever is further along so a fast run advances by work
                # and a slow, stalled-looking run still advances by time.
                progress = min(99, max(time_progress, work_progress))

                if tag == "pdf_url":
                    # Emit the presigned URL directly — bypasses LLM text relay
                    delivered_pdf = value
                    yield {
                        "_ui": {
                            "component": "PdfDelivery",
                            "props": value,
                        }
                    }

                elif tag == "website_url":
                    # Deliver the generated site as a website card carrying the
                    # working presigned URL. Emitted as a fenced JSON block so
                    # the frontend's structured-content detector renders the
                    # existing WebsiteWriterResultCard ("View Website") — no
                    # frontend change required. Deduped on s3_key so a re-run of
                    # the same site does not stack cards.
                    if not delivered_website or delivered_website.get("s3_key") != value.get("s3_key"):
                        delivered_website = value
                        import json as _wsjson

                        card = {
                            "success": True,
                            "url": value.get("url", ""),
                            "download_url": value.get("download_url", ""),
                            "s3_key": value.get("s3_key", ""),
                            "title": value.get("title", ""),
                            "sections": value.get("sections", []),
                        }
                        yield {
                            "data": "\n\n```json\n" + _wsjson.dumps(card) + "\n```\n",
                            "_agent": agent_name,
                        }

                elif tag is _HEARTBEAT:
                    yield {"data": "", "heartbeat": True}

                    # Cycle through the activity messages instead of clamping
                    # to the last one. A long-running phase used to sit on the
                    # final message forever, reinforcing the "stuck" look;
                    # rotating keeps the card visibly alive while work continues.
                    message_idx = tick % len(messages)
                    yield {
                        "_ui": {
                            "component": "AgentActivity",
                            "props": {
                                "agent": agent_name,
                                "phase": role,
                                "progress": progress,
                                "activity": messages[message_idx],
                                "elapsed": round(elapsed),
                                "done": False,
                            },
                        }
                    }
                    yield {
                        "phase_progress": {
                            "phase": role,
                            "progress": progress,
                        }
                    }
                    tick += 1
                elif tag == "tool_call":
                    # A tool call just completed — push a fresh progress update
                    # between heartbeats so the bar advances with real work
                    # (the count the user watches climb) rather than waiting for
                    # the next 10s tick. The AgentActivity card is keyed per
                    # agent on the frontend, so this updates in place.
                    message_idx = tick % len(messages)
                    yield {
                        "_ui": {
                            "component": "AgentActivity",
                            "props": {
                                "agent": agent_name,
                                "phase": role,
                                "progress": progress,
                                "activity": messages[message_idx],
                                "elapsed": round(elapsed),
                                "done": False,
                            },
                        }
                    }
                    yield {
                        "phase_progress": {
                            "phase": role,
                            "progress": progress,
                        }
                    }
                elif tag == "text":
                    agent_text = value

        except Exception as e:
            # Include the exception TYPE. A bare str() on a KeyError renders as
            # just "'output'", which told neither the user nor us anything —
            # "KeyError: 'output'" at least names the failure mode.
            detail = f"{type(e).__name__}: {e}"
            print(f"[ORCHESTRATOR] Error during {agent_name} phase ({detail})")
            print(f"[ORCHESTRATOR] Phase context: model={model_id}, role={role}, mode={mode}")
            traceback.print_exc()
            final_elapsed = time.monotonic() - start_time
            yield {
                "_ui": {
                    "component": "AgentActivity",
                    "props": {
                        "agent": agent_name,
                        "phase": role,
                        "progress": 100,
                        "activity": "Failed",
                        "elapsed": round(final_elapsed),
                        "done": True,
                    },
                }
            }
            yield {"agent_phase": {"agent": agent_name, "phase": role, "status": "error"}}

            if not agent_text:
                # An EXPORT phase failing must not discard the run. By this point
                # the catalog (or report) has been designed, quality-checked and
                # in the catalog flow explicitly approved by the user — throwing
                # a fatal error loses all of that and leaves them with nothing to
                # retry from. Say what broke, keep the work, and let them re-run
                # just the export.
                # `initial_accumulated` means this run resumed from work the user
                # already approved (menu_export carries the reviewed catalog), so
                # there is something worth preserving even though no phase in
                # THIS invocation produced it.
                has_prior_work = bool(menu_designer_output or delivered_pdf or initial_accumulated)
                if role == "export" and has_prior_work:
                    yield {
                        "data": (
                            f"\n\n> **Export step failed** ({detail}).\n>\n"
                            f"> Your catalog is intact and still shown above — nothing was lost. "
                            f"Ask me to export it again to retry just this step.\n\n"
                        ),
                        "_agent": agent_name,
                    }
                    continue
                if role == "evaluation":
                    # Scoring runs last, after the report and PDF are delivered.
                    # A judge failure must never fail a completed run — note it
                    # and finish cleanly with the report intact.
                    yield {
                        "data": (
                            f"\n\n> **Evaluation step failed** ({detail}).\n>\n"
                            f"> Your report is complete and delivered above — only the automated "
                            f"quality score is unavailable this run.\n\n"
                        ),
                        "_agent": agent_name,
                    }
                    continue
                yield {"status": "error", "error": f"{agent_name} failed — {detail}"}
                return
        finally:
            _stop_heartbeat.set()
            heartbeat_thread.join(timeout=2)
            agent_future.cancel()

        if phase_timed_out:
            # The watchdog fired: a tool call almost certainly wedged (the model
            # call itself is bounded by the read timeout). Cancelling the future
            # cannot kill a thread already blocked in a synchronous tool call, so
            # that thread lingers until the tool returns — but the run no longer
            # waits on it. Recover the report from the captured pdf_generator
            # input where possible so the synthesizer still delivers content.
            timed_out_after = round(time.monotonic() - start_time)
            print(
                f"[ORCHESTRATOR] {agent_name} watchdog fired after {timed_out_after}s "
                f"(wall_clock={phase_wall_clock}s, idle_limit={SEQUENTIAL_PHASE_IDLE_TIMEOUT_SEC}s) — "
                f"abandoning wedged phase"
            )
            if not agent_text and pending_report_payload:
                agent_text = _render_report_payload_markdown(pending_report_payload)
            if delivered_pdf:
                timeout_note = (
                    "\n\n> **Report generation ran long and was wrapped up early.** "
                    "The PDF finished and is linked below.\n\n"
                )
            elif agent_text:
                timeout_note = (
                    "\n\n> **The PDF export did not return in time, so the full report is shown here "
                    "instead.** Synthesis completed — only the PDF render stalled. Re-run to retry the PDF.\n\n"
                )
            else:
                timeout_note = (
                    f"\n\n> **The {role} step timed out after about {max(1, round(timed_out_after / 60))} "
                    "minute(s) and was stopped so the run could finish instead of hanging. "
                    "Please send the request again to retry.\n\n"
                )
            yield {"data": timeout_note, "_agent": agent_name}

        # Emit the agent's text output so the frontend can display it.
        # With the synchronous agent() call the text arrives as one block.
        if agent_text:
            # Strip unsigned S3 object URLs the model reconstructs from tool
            # `s3_key`/`bucket` fields — they 403 on click because the buckets
            # are private. The working links are delivered as cards above.
            # Done on the full text before chunking so a URL split across a
            # 200-char boundary is still matched.
            clean_text = _strip_dead_s3_urls(agent_text)
            # Stream the text in chunks so the frontend renders progressively
            chunk_size = 200
            for i in range(0, len(clean_text), chunk_size):
                chunk = clean_text[i : i + chunk_size]
                yield {"data": chunk, "_agent": agent_name}

        # Emit phase complete
        final_elapsed = time.monotonic() - start_time
        print(f"[ORCHESTRATOR] === Completed {agent_name} in {final_elapsed:.1f}s ===")

        if phase_truncated_at is not None:
            # The pipeline continues with whatever was gathered, but labelling a
            # truncated sweep "Complete" would overstate it — and the next phase
            # is about to write a report from it.
            yield {
                "data": (
                    f"\n\n_Note: {role} stopped after {phase_truncated_at} steps and may not have "
                    f"covered every sub-question. The findings gathered so far are used below._\n\n"
                ),
                "_agent": agent_name,
            }

        if phase_timed_out:
            phase_activity_label = "Timed out"
        elif phase_truncated_at is not None:
            phase_activity_label = "Truncated"
        else:
            phase_activity_label = "Complete"
        yield {
            "_ui": {
                "component": "AgentActivity",
                "props": {
                    "agent": agent_name,
                    "phase": role,
                    "progress": 100,
                    "activity": phase_activity_label,
                    "elapsed": round(final_elapsed),
                    "done": True,
                },
            }
        }
        yield {"agent_phase": {"agent": agent_name, "phase": role, "status": "end"}}

        # Feed this agent's output to the next agent.
        # For menu pipelines, preserve the designer's menu JSON so later phases
        # (pdf_writer, website_writer) can access the full menu with s3_key fields.
        if agent_text:
            if agent_name == "menu_designer":
                menu_designer_output = agent_text
                # Automatic quality control: verify format, length, and filter
                # irrelevant/placeholder content before the catalog is exported.
                try:
                    qc_report = _qc_validate_catalog(agent_text)
                    yield {"_ui": {"component": "CatalogQualityReport", "props": qc_report}}
                    # Emit the parsed catalog so the AI Assistant's Catalog Studio
                    # (human-in-the-loop editing, read-aloud, A/B testing) has
                    # structured data to work with.
                    parsed_catalog = _parse_catalog_json(agent_text)
                    if parsed_catalog and parsed_catalog.get("sections"):
                        yield {"_ui": {"component": "ServicesCatalog", "props": parsed_catalog}}
                except Exception as qc_exc:  # QC must never break the pipeline
                    logger.debug("Catalog QC failed: %s", qc_exc)
                accumulated = f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"
            elif agent_name == "evaluator":
                # Turn the judge's streamed markdown scorecard into a structured
                # Bedrock evaluation card. The markdown already streamed into the
                # trace; this adds the gauge/bars card in chat and lights up the
                # flow panel's evaluation tile. Parsing must never break the run.
                try:
                    criteria = _extract_plan_criteria(initial_accumulated or accumulated)
                    scorecard = _parse_evaluation_scorecard(agent_text, phase_model_id, criteria)
                    if scorecard:
                        yield {"_ui": {"component": "EvaluationScorecard", "props": scorecard}}
                except Exception as eval_exc:
                    logger.debug("Evaluation scorecard parse failed: %s", eval_exc)
                accumulated = f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"
            elif menu_designer_output:
                accumulated = (
                    f"Menu designer output (contains menu JSON with s3_key for images):\n{menu_designer_output}\n\n"
                    f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"
                )
            else:
                accumulated = f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"

    # Close with a download link when the run produced a report.
    #
    # The viewer is emitted the moment the PDF exists, which puts it above the
    # closing summary — often far above it, so finishing a run left the reader
    # scrolling back to find the report. The agent's closing text names the file
    # but cannot link it, because a presigned URL pasted into prose expires while
    # the message is kept. This is the same payload rendered as a single link, at
    # the point the reader has actually reached.
    if delivered_pdf:
        yield {"_ui": {"component": "PdfDownloadLink", "props": delivered_pdf}}

    yield {"result": {"stop_reason": "end_turn"}}


if __name__ == "__main__":
    app.run()
