"""
PDF Writer Agent - Calls pdf_generator Gateway tool to create PDF reports from research.

Uses BedrockAgentCoreApp + @app.entrypoint async generator pattern for SSE streaming.
Connects to AgentCore Gateway for pdf_generator tool access and uses AgentCore Memory
for session persistence.
"""

import json
import os
import traceback

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.heartbeat import with_heartbeat
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = """You are a PDF Writer Agent. Your role is to take synthesized research
reports and generate professional PDF documents using the pdf_generator Gateway tool.

Your responsibilities:
1. Accept a synthesis report (structured JSON with executive summary, findings, etc.)
2. Format the content into a professional document structure
3. Call the gateway_pdf_generator tool to create the PDF
4. Return the PDF location and metadata to the caller

PDF Generation Guidelines:
- Structure the document with a clear title page including topic and date
- Include a table of contents for reports with 3+ sections
- Format the executive summary prominently at the top
- Organize key findings by theme with confidence indicators
- Include supporting evidence in a separate section
- Add conclusions and recommendations as actionable items
- Append a full references/citations section at the end
- Use professional formatting: clear headings, consistent fonts, proper spacing

When calling the pdf_generator tool, provide it with:
- title: The report title
- content: The full structured content to render
- sections: Ordered list of section names and content
- metadata: Author info, date, classification

Output confirmation as JSON:
{
  "status": "success|error",
  "pdf_location": "S3 URI or download URL",
  "filename": "descriptive_filename.pdf",
  "page_count": estimated_pages,
  "sections_included": ["Executive Summary", "Key Findings", ...],
  "metadata": {
    "topic": "...",
    "generated_at": "ISO timestamp",
    "source_count": number_of_citations
  }
}
"""


def create_gateway_mcp_client(access_token: str) -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.

    Args:
        access_token: Valid OAuth2 Bearer token for Gateway auth.

    Returns:
        MCPClient: Configured MCP client connected to the Gateway.

    Raises:
        ValueError: If STACK_NAME env var is missing or has invalid format.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    print(f"[PDF-WRITER] Creating Gateway MCP client for stack: {stack_name}")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[PDF-WRITER] Gateway URL from SSM: {gateway_url}")

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )

    print("[PDF-WRITER] Gateway MCP client created successfully")
    return gateway_client


def _load_guardrail_config() -> dict | None:
    """Load guardrail config from SSM if available."""
    stack_name = os.environ.get("STACK_NAME", "")
    if not stack_name:
        return None
    try:
        guardrail_id = get_ssm_parameter(f"/{stack_name}/guardrail_id")
        guardrail_version = get_ssm_parameter(f"/{stack_name}/guardrail_version")
        if guardrail_id and guardrail_version:
            print(f"[PDF-WRITER] Guardrail loaded: {guardrail_id} v{guardrail_version}")
            return {
                "guardrailIdentifier": guardrail_id,
                "guardrailVersion": guardrail_version,
            }
    except Exception as e:
        print(f"[PDF-WRITER] Guardrail not available: {e}")
    return None


def create_pdf_writer_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a PDF writer agent with Gateway MCP tools (pdf_generator) and memory.

    Sets up the agent with:
    - BedrockModel using MODEL_ID env var
    - AgentCore Memory for session persistence
    - Gateway MCP client for pdf_generator tool access

    Args:
        user_id: Authenticated user ID from JWT token.
        session_id: Session ID for conversation continuity.

    Returns:
        Agent: Configured Strands agent ready for invocation.

    Raises:
        ValueError: If MEMORY_ID env var is missing.
        Exception: If Gateway connection fails.
    """
    model_id = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6")

    guardrail_config = _load_guardrail_config()
    model_kwargs = {"model_id": model_id, "temperature": 0.1}
    if guardrail_config:
        model_kwargs["guardrail_config"] = guardrail_config

    bedrock_model = BedrockModel(**model_kwargs)

    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    agentcore_memory_config = AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=user_id)

    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )

    try:
        print("[PDF-WRITER] Starting agent creation with Gateway tools...")

        print("[PDF-WRITER] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        print(f"[PDF-WRITER] Got access token: {access_token[:20]}...")

        print("[PDF-WRITER] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)
        print("[PDF-WRITER] Gateway MCP client created successfully")

        print("[PDF-WRITER] Step 3: Creating PDF Writer Agent with Gateway tools...")
        agent = Agent(
            name="PDFWriterAgent",
            system_prompt=SYSTEM_PROMPT,
            tools=[gateway_client],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
                "agent.role": "pdf_writer",
            },
        )
        print("[PDF-WRITER] Agent created successfully with Gateway tools")
        return agent

    except Exception as e:
        print(f"[PDF-WRITER ERROR] Error creating Gateway client: {e}")
        print(f"[PDF-WRITER ERROR] Exception type: {type(e).__name__}")
        print("[PDF-WRITER ERROR] Traceback:")
        traceback.print_exc()
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the PDF Writer Agent using streaming with Gateway integration.

    Receives a synthesis report (or topic to retrieve one for), formats it into
    a professional document structure, calls the pdf_generator Gateway tool to
    create the PDF, and streams the result back via SSE. The user ID is securely
    extracted from the validated JWT token in the RequestContext.

    Args:
        payload: Request payload containing 'prompt' and 'runtimeSessionId'.
        context: AgentCore RequestContext with validated JWT headers.

    Yields:
        dict: Streamed event chunks from the agent response.
    """
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId",
        }
        return

    try:
        user_id = extract_user_id_from_context(context)

        print(f"[PDF-WRITER STREAM] Starting for user: {user_id}, session: {session_id}")
        print(f"[PDF-WRITER STREAM] Query: {user_query}")

        agent = create_pdf_writer_agent(user_id, session_id)

        pdf_prompt = (
            f"Generate a professional PDF report from the following research content. "
            f"Structure the document with a title page, executive summary, key findings "
            f"organized by theme, supporting evidence, conclusions, recommendations, "
            f"and a full citations section. Use the gateway_pdf_generator tool to create "
            f"the PDF and return the file location and metadata.\n\n"
            f"Report Content: {user_query}"
        )

        async for event in with_heartbeat(agent.stream_async(pdf_prompt)):
            if event.get("heartbeat"):
                yield {"data": "", "heartbeat": True}
            else:
                yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[PDF-WRITER STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
