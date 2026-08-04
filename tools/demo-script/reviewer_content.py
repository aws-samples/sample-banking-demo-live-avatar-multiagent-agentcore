"""Reviewer-facing demo walkthrough.

Organised around the four sections of Gartner's brief. Each section answers
three questions in the same order, every time:

    1. What Gartner asked for
    2. What we will show, as ordered demo steps
    3. Which capabilities and services are in focus

Deliberately excluded, because it is our working material rather than theirs:
narration prose, persona numbering, second-by-second time budgets, scoring
strategy, and service-availability verification notes. Those live in
docs/demo-script-narrated.docx and docs/capabilities-mapping.md.

Every section follows the same rhythm on camera: introduce the feature briefly,
show the code that implements it, then show the running application.
"""

from __future__ import annotations

TITLE = "Demo Walkthrough"
SUBTITLE = "Building on Amazon Bedrock AgentCore"
KICKER = "Gartner Magic Quadrant / Critical Capabilities\nAI Application Development Platforms 2026"
META = (
    "Four sections, matching the structure of Gartner's demonstration brief",
    "Framing: how a developer using AWS builds this end to end",
    "Every section: introduce the feature, show the code, show the application",
    "Runtime: 60 minutes  ·  all capabilities generally available as of 1 August 2026",
)

# Column widths reused across the "what we show" tables.
STEP_W = [0.5, 2.5, 2.4, 1.7]
CAP_W = [1.9, 5.2]


def write_body(doc, *, narration, labelled, bullets, table, beat, meta) -> None:
    _how_to_read(doc, bullets=bullets, table=table, meta=meta)
    _scenario(doc, meta=meta)
    _section_1(doc, bullets=bullets, table=table, meta=meta)
    _section_2(doc, bullets=bullets, table=table, meta=meta)
    _section_3(doc, bullets=bullets, table=table, meta=meta)
    _section_4(doc, bullets=bullets, table=table, meta=meta)
    _close(doc, bullets=bullets, table=table, meta=meta)


# ---------------------------------------------------------------------------
# How to read this
# ---------------------------------------------------------------------------


def _how_to_read(doc, *, bullets, table, meta) -> None:
    doc.add_heading("How to read this document", level=1)

    doc.add_paragraph(
        "Gartner's brief is organised into four demonstrations. This document keeps that "
        "structure exactly, so a reviewer can read one section, watch the corresponding part "
        "of the recording, and check them against each other without holding anything else "
        "in mind."
    )

    p = doc.add_paragraph()
    r = p.add_run("The framing question throughout is: how would a developer using AWS build this end to end?")
    r.bold = True

    doc.add_paragraph(
        "That question sets the rhythm of every step. We introduce a capability in a sentence "
        "or two, show the code or configuration that uses it, and then show the running "
        "application doing the thing. No capability is asserted from a slide, and no feature "
        "appears without the code behind it."
    )

    doc.add_heading("The four sections", level=2)
    table(
        doc,
        ["Section", "Demonstration", "Approx. runtime"],
        [
            ["1", "Deep research agent, across the full development lifecycle", "30 min"],
            ["2", "External customer AI assistant, grounded on the section 1 output", "10 min"],
            ["3", "Customer agent: account opening, grounding, guardrails, DLP, reporting", "11 min"],
            ["4", "Voice experience and the avatar", "4 min"],
        ],
        widths=[0.8, 5.4, 1.4],
    )
    doc.add_paragraph(
        "The remaining five minutes cover the opening scenario and the closing handoff of "
        "source code and deployment artifacts."
    )

    doc.add_heading("What each section contains", level=2)
    bullets(
        doc,
        [
            "Gartner asked for — the requirement in Gartner's own terms, condensed.",
            "What we show — ordered demo steps. Each step names what appears on screen, "
            "whether it is code or the running application, and the requirement it answers.",
            "Capabilities in focus — the AWS services and AgentCore capabilities doing the work.",
        ],
    )

    doc.add_heading("One platform, named on screen", level=2)
    doc.add_paragraph(
        "All four applications are built on Amazon Bedrock AgentCore. The platform is the "
        "continuity between sections rather than the storyline: each time a requirement comes "
        "up, a named capability answers it on screen. Eleven AgentCore capabilities do work "
        "across the hour."
    )
    table(
        doc,
        ["Capability", "What it does across the four applications"],
        [
            ["Harness", "The research agent declared as configuration, running without orchestration code"],
            ["Runtime", "Production deployment, session isolation, agent-to-agent calls, long-running jobs"],
            ["Gateway", "Every tool published as MCP, plus first-party web search and human elicitation"],
            ["Memory", "Analyst preferences, session summaries and recall across runs"],
            ["Identity", "Agents acting as the signed-in user rather than a shared service account"],
            ["Policy", "Deterministic allow and deny in front of every tool call"],
            ["Code Interpreter", "Quantitative analysis and chart generation in a sandbox"],
            ["Browser", "Sources with no API, plus human takeover mid-run"],
            ["Observability", "Traces, spans, latency, token and cost attribution"],
            ["Evaluations", "Quality gates, online and batch scoring, user simulation"],
            ["Optimization", "Prompt and tool-description recommendations, configuration bundles, A/B tests"],
        ],
        widths=CAP_W,
    )
    meta(
        doc,
        "Scope note: the agent registry and agent payments are in public preview and are "
        "therefore not demonstrated. Photorealistic avatar rendering is a partner layer on "
        "top of the AWS voice stream and is disclosed as such in section 4.",
    )


# ---------------------------------------------------------------------------
# Scenario
# ---------------------------------------------------------------------------


def _scenario(doc, *, meta) -> None:
    doc.add_heading("The scenario", level=1)
    doc.add_paragraph(
        "Trinity Reserve Bank is a newly chartered US bank in Dallas, four hundred yards from "
        "the Texas Stock Exchange. It runs retail banking and wealth management, and clears "
        "against TXSE, NYSE, Nasdaq and the major European venues."
    )
    doc.add_paragraph(
        "The bank needs an AI application that researches its market, serves the strategy team "
        "inside the bank, and serves customers outside it, under US, European and Chinese "
        "regulatory obligations. That single requirement produces the four applications in "
        "Gartner's brief, which is why they share a knowledge base, a guardrail policy and an "
        "identity model rather than being four unrelated demos."
    )
    meta(doc, "All data, customers, holdings and figures shown are synthetic.")


# ---------------------------------------------------------------------------
# Section 1
# ---------------------------------------------------------------------------


def _section_1(doc, *, bullets, table, meta) -> None:
    doc.add_heading("Section 1 — Deep research agent", level=1)
    doc.add_paragraph(
        "The longest section, because Gartner asks to see the whole development lifecycle here "
        "and not just a finished agent. It is organised by lifecycle phase, in the order "
        "Gartner names them: design, implementation, testing, deployment, operationalization."
    )

    doc.add_heading("1.1 Gartner asked for", level=2)
    bullets(
        doc,
        [
            "A deep research agent built with an agentic framework, with the platform "
            "supporting design, implementation, testing, deployment and operationalization.",
            "Take the user's input, use LLMs to optimise and refine the query, and break it "
            "down into sub-questions or specific aspects to investigate.",
            "Generate a research plan defining key objectives, research methods, evaluation "
            "criteria and expected outcomes, with humans in the loop to review and refine.",
            "Use tool calling and MCP, such as web search APIs, to gather results.",
            "Divide the research into sections, with multi-agent collaboration for parallel "
            "processing and efficient information collection.",
            "A human in the loop to refine or adjust the content.",
            "Multimodal input, such as data-analysis charts, and multimodal output, such as "
            "graphics, logos and storefronts.",
            "Combine each section, plus an introduction and conclusion, into a comprehensive final report.",
            "One chapter featuring a suggested list of services, using text, images and speech.",
            "Citations for all sources, exported as PDF.",
            "Across the lifecycle: IDE, low-code, high-code and graphical development; model "
            "catalog; testing and validation; data preparation; tracing; evaluation; debugging; "
            "agent operations; observability; orchestration; cost management; control processes.",
        ],
    )

    doc.add_heading("1.2 What we show — design", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "1",
                "Gartner's problem statement pasted into the IDE, with a MiFID II suitability "
                "PDF and a TXSE listing-volume chart dragged into the same message",
                "Kiro IDE. Multimodal input is a design input, not just a runtime feature",
                "Multimodal input; IDE-based development",
            ],
            [
                "2",
                "A spec generated as requirements, then design, then tasks. One requirement is "
                "edited to demand a resolvable source and page citation, and the design and "
                "tasks re-derive from it",
                "Code: .kiro/specs/ files, reviewed and edited in the editor",
                "Design phase; control processes",
            ],
            [
                "3",
                "Steering files that apply security standards, data residency and model "
                "selection policy to every generation in the workspace",
                "Code: .kiro/steering/ — governance as code, in git",
                "Control processes",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("1.3 What we show — implementation", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "4",
                "The agent declared as configuration — model, system prompt, tools, memory — "
                "then deployed with a single command and answering its first question",
                "Code: harness configuration in git, then the running agent",
                "Agentic framework; low-code altitude",
            ],
            [
                "5",
                "The model catalog, swapping the model behind the same agent, and guardrails "
                "evaluating inside the agent loop rather than bolted on after",
                "Application, with the config diff shown alongside",
                "Model catalog",
            ],
            [
                "6",
                "Tools published through one gateway as MCP: existing Lambda functions, an "
                "OpenAPI service, and first-party web search with domain and date filters",
                "Code: gateway/tools/ handlers and the target config, then tool calls in the app",
                "Tool calling and MCP; web search",
            ],
            [
                "7",
                "The agent calling a tool as the signed-in analyst, and a policy denying a "
                "tool call deterministically at the gateway before the model is reached",
                "Code: the identity hook and the Cedar policy, then the blocked call in the app",
                "Control processes",
            ],
            [
                "8",
                "The query refined by an LLM and decomposed into sub-questions, producing a "
                "research plan that names objectives, methods, evaluation criteria and "
                "expected outcomes, with per-section search queries derived from it",
                "Application, with the emitted plan file shown as structured output",
                "Query refinement; research plan; search-query generation",
            ],
            [
                "9",
                "Two human-in-the-loop patterns: the run pausing for plan approval and "
                "resuming with state intact, and the agent eliciting a content correction "
                "mid-execution",
                "Code: the pause/resume and elicitation wiring, then both pauses in the app",
                "Human in the loop, on the plan and on the content",
            ],
            [
                "10",
                "The same agent exported to framework code, then scaled out on Runtime as a "
                "supervisor with parallel section agents and a synthesis pass",
                "Code: the exported multi-agent implementation, then the parallel run",
                "Multi-agent collaboration; parallel processing; high-code altitude; orchestration",
            ],
            [
                "11",
                "Memory carrying analyst preferences and prior findings into a later session",
                "Application, with the memory configuration alongside",
                "Agent state management",
            ],
            [
                "12",
                "Charts computed in a sandbox and fed back to the agent as images, and a "
                "source with no API reached through a managed browser with human takeover",
                "Application, with the tool definitions shown",
                "Data preparation; multimodal input",
            ],
            [
                "13",
                "The final report assembled from all sections with an introduction and "
                "conclusion, every claim carrying a clickable source and page, exported as a "
                "PDF. One chapter presents suggested services as text, generated imagery and "
                "spoken narration",
                "Application, with the synthesis prompt and citation rule shown",
                "Final report; citations; PDF export; multimodal output including speech",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("1.4 What we show — testing and validation", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "14",
                "Tests generated from the spec, including a custom evaluator that fails the "
                "build when any regulatory claim lacks a resolvable citation",
                "Code: the test and evaluator, run in the terminal",
                "Testing and validation",
            ],
            [
                "15",
                "Evaluation scores on the run, then a failing score traced to the exact span "
                "that caused it, fixed, and re-verified",
                "Application: evaluation results into the trace view",
                "Evaluation; tracing; debugging",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("1.5 What we show — deployment and operationalization", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "16",
                "The whole application deployed as infrastructure as code, with an evaluation "
                "gate in the pipeline, versioned endpoints and a rollback. The same agent "
                "container deployed to Kubernetes to show the hybrid path",
                "Code: the CDK stacks and pipeline definition, then a live deploy",
                "Deployment; orchestration",
            ],
            [
                "17",
                "Agent operations: dashboards, span trees with latency and token counts, and "
                "cost attributed per session and per component including indirect costs",
                "Application: observability and cost views",
                "Agent operations; observability; cost management",
            ],
            [
                "18",
                "Recommendations proposing an improved system prompt from real traces, "
                "promoted as a versioned configuration change rather than a redeploy",
                "Application, with the resulting config bundle diff",
                "Operationalization; control processes",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("1.6 Capabilities in focus", level=2)
    table(
        doc,
        ["Capability or service", "Role in this section"],
        [
            ["Kiro", "Spec-driven design, steering as governance-as-code, generated tests"],
            ["AgentCore CLI and CDK", "Project scaffolding, local run, deploy, infrastructure as code"],
            ["AgentCore Harness", "The agent as configuration — the low-code altitude"],
            ["Strands Agents", "The exported code implementation — the high-code altitude"],
            ["AgentCore Runtime", "Multi-agent execution, session isolation, parallel section agents"],
            ["AgentCore Gateway", "MCP tools, first-party web search, human elicitation"],
            ["AgentCore Identity", "Tool calls made as the signed-in analyst"],
            ["AgentCore Policy", "Deterministic tool-call control ahead of the model"],
            ["AgentCore Memory", "Preferences and findings across sessions"],
            ["Code Interpreter and Browser", "Chart computation; sources without an API"],
            ["Bedrock model catalog", "Model choice and residency-scoped inference profiles"],
            ["Bedrock Guardrails", "Content and image policy inside the agent loop"],
            ["Bedrock Managed Knowledge Base", "Ingestion and retrieval over the bank's documents"],
            ["Nova models", "Image generation and speech for the services chapter"],
            ["AgentCore Evaluations and Optimization", "Quality gates, then prompt recommendations"],
            ["AgentCore Observability and CloudWatch", "Traces, spans, dashboards, cost attribution"],
        ],
        widths=CAP_W,
    )


# ---------------------------------------------------------------------------
# Section 2
# ---------------------------------------------------------------------------


def _section_2(doc, *, bullets, table, meta) -> None:
    doc.add_heading("Section 2 — External customer AI assistant", level=1)
    doc.add_paragraph(
        "The research output from section 1 becomes the grounding for a customer-facing "
        "assistant. Nothing is re-ingested by hand: the PDF and imagery the research agent "
        "produced are the knowledge base this assistant reads."
    )

    doc.add_heading("2.1 Gartner asked for", level=2)
    bullets(
        doc,
        [
            "An assistant for external customers, grounded on the output of section 1.",
            "Detailed service information as both text and images.",
            "Generate service images, and speak account and investment progress.",
            "Automatic quality control over format, length, filtering and irrelevant information.",
            "Human review to update service descriptions.",
            "A/B test output across various models.",
            "A continuous feedback loop.",
        ],
    )

    doc.add_heading("2.2 What we show", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "1",
                "The section 1 PDF and its generated imagery ingested into a managed knowledge "
                "base, then a customer question answered with retrieved text and the matching "
                "image tiles",
                "Code: the ingestion and retrieval configuration, then the assistant answering",
                "Grounded on section 1; text and images",
            ],
            [
                "2",
                "A service image generated on request inside brand and content policy, and "
                "account and investment progress spoken aloud from live position data",
                "Application, with the image and speech tool definitions shown",
                "Image generation; spoken progress",
            ],
            [
                "3",
                "Four quality controls firing in sequence: a schema check enforcing mandatory "
                "fee disclosure, a channel length policy triggering a regenerate, content "
                "filters and denied topics, and online relevance scoring on every response",
                "Code: the validator and policy definitions, then each control firing live",
                "Automatic quality control",
            ],
            [
                "4",
                "A reviewer correcting a service description mid-conversation, the correction "
                "versioned with attribution and a visible diff",
                "Application: elicitation form, then the content diff",
                "Human review of descriptions",
            ],
            [
                "5",
                "Two model variants served side by side over split live traffic, scored online, "
                "with the winner promoted as configuration only",
                "Application: the A/B configuration and its significance report",
                "A/B testing across models",
            ],
            [
                "6",
                "The loop closed end to end: customer signal, trace annotation, dataset, batch "
                "evaluation, recommendation, A/B test, promotion",
                "Application, walked as one continuous path",
                "Continuous feedback loop",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("2.3 Capabilities in focus", level=2)
    table(
        doc,
        ["Capability or service", "Role in this section"],
        [
            ["Bedrock Managed Knowledge Base", "Multimodal retrieval over the section 1 output"],
            ["Bedrock Data Automation", "Parses imagery so retrieval can return tiles"],
            ["Nova models", "Service image generation; speech with barge-in"],
            ["Bedrock Guardrails", "Content filters and denied topics on every response"],
            ["AgentCore Evaluations", "Online scoring for context and response relevance"],
            ["AgentCore Gateway", "Elicitation for the human review step"],
            ["AgentCore Optimization", "Configuration bundles, traffic split, statistical significance"],
            ["AgentCore Observability", "Trace annotation feeding the dataset"],
        ],
        widths=CAP_W,
    )


# ---------------------------------------------------------------------------
# Section 3
# ---------------------------------------------------------------------------


def _section_3(doc, *, bullets, table, meta) -> None:
    doc.add_heading("Section 3 — Customer agent, grounding, guardrails, DLP and reporting", level=1)
    doc.add_paragraph(
        "This section moves from answering questions to taking action, and then puts that "
        "action under adversarial pressure. The reporting at the end is prebuilt rather than "
        "custom-built, which is the point of showing it."
    )

    doc.add_heading("3.1 Gartner asked for", level=2)
    bullets(
        doc,
        [
            "Open an account, validate that the bank can do business with the customer, and "
            "let them take advantage of services.",
            "Detect fraudulent accounts and transactions.",
            "Grounding through context and prompt engineering as well as RAG.",
            "A quick way to verify that answers are grounded in the section 1 document.",
            "Guardrails that block requests unrelated to the bank, and employee-salary "
            "questions that trigger guardrails.",
            "Data loss prevention measures.",
            "Out-of-the-box reports: comprehensiveness, accuracy, response time, costs, and "
            "metrics useful to marketing.",
        ],
    )

    doc.add_heading("3.2 What we show", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "1",
                "An account opened end to end with every tool call visible: eligibility and "
                "sanctions screening, a jurisdiction check that declines with the rule cited, "
                "then enrollment across checking, retirement and managed investing",
                "Code: the tool handlers, then the full flow in the app",
                "Account opening; validating the customer; taking up services",
            ],
            [
                "2",
                "Fraud signals raised inline, then a second agent called agent-to-agent to "
                "investigate, running under the customer's delegated identity",
                "Code: the agent-to-agent call and identity delegation, then the investigation",
                "Fraud detection",
            ],
            [
                "3",
                "The structured context object the agent assembles, with a token budget per "
                "element, shown next to knowledge-base retrieval for the same question",
                "Code: the context builder, then both paths in the app",
                "Grounding by context engineering and by RAG",
            ],
            [
                "4",
                "Three answers checked against their cited pages in the section 1 PDF in about "
                "ninety seconds, plus a fourth question the agent correctly refuses",
                "Application: answer, citation, source page, side by side",
                "Quickly verifying grounding",
            ],
            [
                "5",
                "Guardrails under deliberate attack: an off-topic request declined, an "
                "employee-salary question blocked, internal-only salary bands excluded from "
                "retrieval for an external identity, and a prompt-injection attempt detected",
                "Code: the guardrail and policy definitions, then each probe live",
                "Guardrails; salary questions",
            ],
            [
                "6",
                "DLP in force: sensitive-information filters, an exfiltration attempt blocked "
                "and logged, and the HR tool denied at the gateway rather than by the model",
                "Code: the DLP policy, then the blocked attempt and its audit record",
                "Data loss prevention",
            ],
            [
                "7",
                "Prebuilt dashboards: completeness and groundedness by intent, latency "
                "percentiles with time-to-first-token, cost per conversation and per resolved "
                "request with business-unit tagging, and marketing metrics — top intents, "
                "service interest, containment versus escalation, funnel drop-off, sentiment",
                "Application only. Nothing custom-built, which is stated on camera",
                "Out-of-the-box reporting",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("3.3 Capabilities in focus", level=2)
    table(
        doc,
        ["Capability or service", "Role in this section"],
        [
            ["AgentCore Runtime", "The multi-step account-opening agent; agent-to-agent calls"],
            ["AgentCore Gateway", "Eligibility, sanctions and enrollment tools as MCP targets"],
            ["AgentCore Identity", "On-behalf-of delegation into the fraud investigation"],
            ["AgentCore Policy", "Tool-level denial, enforced outside the model"],
            ["Bedrock Guardrails", "Denied topics, content filters, prompt-attack detection, DLP"],
            ["Bedrock Managed Knowledge Base", "Entitlement-aware retrieval per identity"],
            ["AgentCore Evaluations", "Completeness and groundedness scoring by intent"],
            ["AgentCore Observability and CloudWatch", "Prebuilt quality, latency, cost and business dashboards"],
        ],
        widths=CAP_W,
    )


# ---------------------------------------------------------------------------
# Section 4
# ---------------------------------------------------------------------------


def _section_4(doc, *, bullets, table, meta) -> None:
    doc.add_heading("Section 4 — Voice experience and the avatar", level=1)
    doc.add_paragraph(
        "The same knowledge base and the same guardrail policy as sections 2 and 3, reached "
        "through a real-time voice channel instead of a text one. This is the shortest section "
        "and it opens by drawing a boundary rather than a claim."
    )

    doc.add_heading("4.1 Gartner asked for", level=2)
    bullets(
        doc,
        [
            "A photorealistic avatar.",
            "At least two languages, with guidance in multiple languages and voice tones.",
            "Ground the avatar to the section 2 text and images.",
            "Spoken question and answer on why a customer should choose the bank.",
            "Show or indicate the item being discussed, and change the item when the customer asks.",
            "Test guardrails with out-of-scope questions.",
        ],
    )

    doc.add_heading("4.2 What we show", level=2)
    table(
        doc,
        ["#", "On screen", "Code or application", "Answers"],
        [
            [
                "1",
                "A stated boundary: AWS provides the real-time speech, grounding, tool calls "
                "and guardrails. Photorealistic rendering is a partner layer on that stream, "
                "and we do not demonstrate the partner product",
                "Spoken disclosure, roughly thirty seconds",
                "Photorealistic avatar — disclosed, not claimed",
            ],
            [
                "2",
                "Live spoken question and answer on why to choose the bank, grounded in the "
                "same knowledge base, with citations available; then the same exchange in a "
                "second language with a different voice tone",
                "Code: the voice agent and its tool wiring, then the live conversation",
                "Two languages; voice tones; grounded spoken Q&A",
            ],
            [
                "3",
                "The agent emitting a UI tool call that highlights the service tile it is "
                "talking about, visible in the trace, then re-navigating when the customer "
                "changes the subject mid-answer",
                "Code: the UI tool definition, then the highlight and the switch live",
                "Indicating the item; changing item on request",
            ],
            [
                "4",
                "Three out-of-scope voice questions blocked by the identical rule set used in "
                "the text channels, landing in the same audit log",
                "Application, with the shared policy shown once",
                "Guardrails on out-of-scope questions",
            ],
        ],
        widths=STEP_W,
    )

    doc.add_heading("4.3 Capabilities in focus", level=2)
    table(
        doc,
        ["Capability or service", "Role in this section"],
        [
            ["Nova speech-to-speech", "Real-time multilingual voice with barge-in and tone control"],
            ["AgentCore Runtime", "Bidirectional streaming session hosting the voice agent"],
            ["AgentCore Gateway", "The same MCP tools the text assistant uses, including the UI tool"],
            ["Bedrock Managed Knowledge Base", "The same grounding corpus as section 2"],
            ["Bedrock Guardrails", "One rule set across text and voice"],
            ["AgentCore Observability", "Voice turns traced like any other agent invocation"],
        ],
        widths=CAP_W,
    )
    meta(
        doc,
        "Avatar rendering is the only part of the demonstration that is not an AWS capability, "
        "and it is the only place a third party appears.",
    )


# ---------------------------------------------------------------------------
# Close
# ---------------------------------------------------------------------------


def _close(doc, *, bullets, table, meta) -> None:
    doc.add_heading("Closing — what a reviewer can take away", level=1)

    doc.add_heading("Five things the platform does that we want noticed", level=2)
    table(
        doc,
        ["", "Claim, as shown on camera"],
        [
            [
                "1",
                "One agent moves from configuration to code without changing platform, "
                "compute or observability. The same agent, two altitudes.",
            ],
            ["2", "Tool access is governed deterministically ahead of the model, not by asking the model to behave."],
            ["3", "Agents act as the signed-in user, so entitlements and audit follow the person."],
            ["4", "Quality is a release gate in the pipeline, not a dashboard reviewed after the fact."],
            ["5", "The same knowledge base, guardrail policy and identity model serve text, action and voice."],
        ],
        widths=[0.4, 6.7],
    )

    doc.add_heading("Deliverables handed over", level=2)
    bullets(
        doc,
        [
            "Source for all four applications, in one repository.",
            "Container images and Helm charts for the hybrid deployment path.",
            "One-command build and the CI/CD pipeline definition, including the evaluation gate.",
            "Infrastructure as code for every resource shown, deploying and destroying cleanly.",
        ],
    )
    doc.add_paragraph(
        "Everything in the recording is self-serve. No professional services engagement is required to reproduce it."
    )

    meta(
        doc,
        "Internal companions to this document: docs/demo-script-narrated.docx for the "
        "recording narration, and docs/capabilities-mapping.md for requirement-level coverage "
        "and service-availability verification.",
    )
