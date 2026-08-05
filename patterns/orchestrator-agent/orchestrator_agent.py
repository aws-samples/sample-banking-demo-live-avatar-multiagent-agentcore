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
2. Use the gateway_kb_search tool to check existing research plans in the knowledge base
   (the runtime scopes this search to the current flow's pipeline — Market Strategy only
   sees `strategy_research`, Market Intelligence only sees `market_research` — so you won't
   surface stale plans from the other flow)
3. Decompose the query into 5-8 focused sub-questions
4. Assign priority (high/medium/low) and research type (web/kb/analysis) to each
5. Create a structured research plan that other agents can execute

Guidelines:
- Break complex topics into specific, researchable sub-questions
- Check the knowledge base for similar past research before planning
- Consider multiple perspectives: technical, business, regulatory, market
- Prioritize questions by importance and dependency ordering
- Ensure sub-questions are independent enough to research in parallel where possible
- Include estimated complexity for each sub-question
- Define clear objectives that will guide the research
- Specify expected deliverables so stakeholders know what to expect

Output your plan as structured JSON (and ONLY JSON, no other text):
{
  "research_topic": "...",
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

Research Guidelines:
- BUDGET YOUR SEARCHES: 2-3 searches per sub-question, 50 max total. Stop searching once you
  have sufficient information for a sub-question and move on.
- Use gateway_web_search exclusively — it is your only research tool
- Maintain full source attribution for every finding
- Include SPECIFIC numbers, dates, percentages, dollar amounts, and names whenever available
- Aim for depth over breadth — quality findings from fewer searches beat exhaustive querying

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
  "citations": ["formatted citation 1", "formatted citation 2"]
}
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

CRITICAL: Do NOT summarize or compress the research findings. Your job is to EXPAND and
ORGANIZE them into a coherent narrative. Every data point, statistic, and quote from the
researcher should appear in your output.

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
  supporting_evidence, conflicts_and_uncertainties, conclusions,
  recommendations, limitations_and_future_research, appendices, citations

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
  "citations": ["..."]
}
"""

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
3. For EACH product, call gateway_nova_canvas_generate to create a clean, on-brand image
4. Collect the s3_key and image_url from each Canvas generation result
5. Compile the complete catalog with all details

For each product image, use a prompt like:
"Professional financial services imagery representing [product name], modern institutional
banking aesthetic, clean composition, deep navy and brass palette, soft studio lighting,
premium and trustworthy, 4k"

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
  successful gateway_nova_canvas_generate result.
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
3. Return the website URL to the caller

When calling the website_generator tool, provide:
- mode: "create"
- title: The services catalog title
- menu: The complete catalog object with sections and items, including s3_key for each item's image
  (the tool's card-grid layout renders each product as a card with its headline rate and feature badges)

IMPORTANT:
- Pass s3_key for each item (preferred for reliable image embedding)
- Also pass image_url as fallback
- Do NOT modify the catalog data — pass it through exactly as received

Output confirmation as JSON:
{
  "status": "success",
  "website_url": "presigned URL to view the website",
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
  3. Otherwise, "confirm" the intake directly: state the product, the stated
     applicant name, that KYC verification will follow, a plausible reference
     code (format TRB-XXXXX, 5 hex chars uppercase), and that a confirmation
     email was sent to the address on file. This is a simulated application —
     never claim it is a real, funded account or promise approval.
- When the user asks to modify the product website, see the
  gateway_website_generator instructions below.
"""

CHATBOT_PROMPT = (
    BANK_FACTS
    + """

You are the Trinity Reserve Bank AI Client Advisor. You can also help with
research, analysis, creative tasks, and general knowledge when asked.

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

  STEP 1: Call gateway_nova_canvas_generate once per image needed. Each call returns
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
illustration. For each, call gateway_nova_canvas_generate with a professional visualization prompt.
Use prompts like: "Professional infographic illustration of [concept], clean modern design,
data visualization style, blue and white color scheme, 4k quality"

Collect s3_key and image_url from each Canvas result. Budget: max 3 images.

Research Guidelines:
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

CRITICAL: Do NOT summarize or compress the research findings. Your job is to EXPAND and
ORGANIZE them into a coherent narrative. Every data point, statistic, and quote from the
researcher should appear in your output.

CRITICAL: The "images" array from the researcher MUST be included exactly as received.
Do not modify, remove, or regenerate images.

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
- Do NOT call gateway_nova_canvas_generate, gateway_web_search, or other research tools
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

GENERIC_EXECUTION_PHASES = [p for p in GENERIC_RESEARCH_PHASES if p["name"] != "planner"]

UI_EVENT_INTERVAL = 2

# Execution-only phases (skip planner) for research_execute mode
RESEARCH_EXECUTION_PHASES = [p for p in AGENT_PHASES if p["name"] != "planner"]


# ---------------------------------------------------------------------------
# Plan extraction helper
# ---------------------------------------------------------------------------

import json as _json_module
import re as _re_module


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
            return _json_module.loads(fenced.group(1))
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
                        if isinstance(parsed, dict) and (
                            "research_topic" in parsed or "sub_questions" in parsed or "objectives" in parsed
                        ):
                            return parsed
                    except _json_module.JSONDecodeError:
                        pass
                    break

    return None


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
    is_nova_reasoning = is_nova and "lite" not in model_id and "micro" not in model_id

    kwargs = dict(extra_kwargs)
    kwargs["model_id"] = model_id
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


def _create_gateway_mcp_client(access_token: str) -> MCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication."""
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
    )

    print("[ORCHESTRATOR] Gateway MCP client created successfully")
    return gateway_client


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
) -> Agent:
    """Create a Strands Agent with Gateway MCP + Memory (identical to standalone pattern)."""
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
        gateway_client = _create_gateway_mcp_client(access_token)
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
        agent = _create_agent(
            "planner",
            planner_phase["prompt"],
            user_id,
            session_id,
            gateway_client,
            bedrock_model,
            pipeline_scope=_pipeline_scope,
        )
    except Exception as e:
        print(f"[ORCHESTRATOR] Failed to create planner agent: {e}")
        yield {"status": "error", "error": f"Failed to create planner: {e}"}
        return

    # Run planner in thread with heartbeats
    agent_text = ""
    start_time = time.monotonic()
    _DONE = object()
    _HEARTBEAT = object()
    _ERROR = object()
    tq: thread_queue.Queue = thread_queue.Queue()

    def _run_planner_sync():
        try:
            result = agent(query)
            text = str(result) if result else ""
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

    # Extract plan JSON and emit ResearchPlan UI component
    plan = _extract_plan_json(agent_text)
    if plan:
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
        # Fallback: couldn't parse plan JSON, emit raw text and continue with full pipeline
        print("[ORCHESTRATOR] Could not extract plan JSON, falling back to raw output")
        yield {"data": agent_text}

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
        ):
            yield event
        return

    # ── Menu mode ──
    phases = MENU_PHASES if mode == "menu" else AGENT_PHASES
    async for event in _run_pipeline(phases, query, user_id, session_id, requested_model, mode=mode):
        yield event


async def _run_pipeline(
    phases,
    query,
    user_id,
    session_id,
    requested_model="",
    initial_accumulated="",
    mode: str = "",
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

    # Build one PipelineScopeHook for the whole pipeline — per-mode KB filter + pdf_generator write.
    _pipeline_cfg = mode_config(mode)
    _pipeline_scope = PipelineScopeHook(
        write_pipeline=_pipeline_cfg.get("write"),
        read_filter=_pipeline_cfg.get("read_filter"),
        is_archive=_pipeline_cfg.get("archive", False),
    )
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
        # budget to reason over the full researcher output.
        bedrock_model = _build_model(
            model_id, temperature=0.1, thinking_budget=thinking_budget, max_tokens=phase_max_tokens
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

        try:
            agent = _create_agent(
                agent_name,
                phase["prompt"],
                user_id,
                session_id,
                gateway_client,
                bedrock_model,
                pipeline_scope=_pipeline_scope,
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
        _DONE = object()
        _HEARTBEAT = object()
        _ERROR = object()
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
                    if not isinstance(block, dict) or "toolResult" not in block:
                        continue
                    tr = block["toolResult"]
                    for part in tr.get("content", []):
                        text_val = part.get("text", "") if isinstance(part, dict) else ""
                        if "presigned" not in text_val and '"url"' not in text_val:
                            continue
                        try:
                            import json as _cbjson

                            parsed = _cbjson.loads(text_val)
                            url = parsed.get("url", "")
                            if url and ("X-Amz-Signature" in url or "Signature=" in url):
                                tq.put(
                                    (
                                        "pdf_url",
                                        {
                                            "url": url,
                                            "s3_key": parsed.get("s3_key", ""),
                                            # Durable handle. `url` dies after an
                                            # hour, and the viewer outlives that
                                            # — it reloads whenever the page is
                                            # revisited — so it re-signs from this
                                            # rather than reusing the link above.
                                            "report_id": parsed.get("report_id", ""),
                                            "filename": parsed.get("s3_key", "").split("/")[-1]
                                            if parsed.get("s3_key")
                                            else "",
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

        def _run_agent_sync():
            """Run the agent synchronously in a worker thread."""
            try:
                result = agent(accumulated)
                # Extract final text from the synchronous result
                text = str(result) if result else ""
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

        try:
            while True:
                # Poll the thread-safe queue without blocking the event loop
                while tq.empty():
                    await asyncio.sleep(0.1)

                tag, value = tq.get_nowait()

                if tag is _DONE:
                    break

                if tag is _ERROR:
                    raise value

                elapsed = time.monotonic() - start_time
                progress = min(95, int((elapsed / estimated_duration) * 100))

                if tag == "pdf_url":
                    # Emit the presigned URL directly — bypasses LLM text relay
                    yield {
                        "_ui": {
                            "component": "PdfDelivery",
                            "props": value,
                        }
                    }

                elif tag is _HEARTBEAT:
                    yield {"data": "", "heartbeat": True}

                    message_idx = min(tick, len(messages) - 1)
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
                elif tag == "text":
                    agent_text = value

        except Exception as e:
            print(f"[ORCHESTRATOR] Error during {agent_name} phase: {e}")
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
            # Continue to next phase if we have partial output
            if not agent_text:
                yield {"status": "error", "error": f"{agent_name} failed: {e}"}
                return
        finally:
            _stop_heartbeat.set()
            heartbeat_thread.join(timeout=2)
            agent_future.cancel()

        # Emit the agent's text output so the frontend can display it.
        # With the synchronous agent() call the text arrives as one block.
        if agent_text:
            # Stream the text in chunks so the frontend renders progressively
            chunk_size = 200
            for i in range(0, len(agent_text), chunk_size):
                chunk = agent_text[i : i + chunk_size]
                yield {"data": chunk, "_agent": agent_name}

        # Emit phase complete
        final_elapsed = time.monotonic() - start_time
        print(f"[ORCHESTRATOR] === Completed {agent_name} in {final_elapsed:.1f}s ===")

        yield {
            "_ui": {
                "component": "AgentActivity",
                "props": {
                    "agent": agent_name,
                    "phase": role,
                    "progress": 100,
                    "activity": "Complete",
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
                accumulated = f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"
            elif menu_designer_output:
                accumulated = (
                    f"Menu designer output (contains menu JSON with s3_key for images):\n{menu_designer_output}\n\n"
                    f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"
                )
            else:
                accumulated = f"Previous agent ({agent_name}) output:\n{agent_text}\n\nOriginal query: {query}"

    yield {"result": {"stop_reason": "end_turn"}}


if __name__ == "__main__":
    app.run()
