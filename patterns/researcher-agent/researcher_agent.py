"""
Researcher Agent - Executes searches and collects findings with citations.

Uses BedrockAgentCoreApp + @app.entrypoint async generator pattern for SSE streaming.
Connects to AgentCore Gateway for kb_search and web_search tool access, and uses
AgentCore Memory for session persistence.
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

SYSTEM_PROMPT = """You are a Research Agent. Your role is to execute comprehensive research
using both knowledge base queries and web searches, then aggregate findings with proper
citations and source attribution.

Your responsibilities:
1. Execute searches against the knowledge base using gateway_kb_search
2. Perform web research using gateway_web_search for current information
3. Cross-reference findings from multiple sources for accuracy
4. Collect and organize findings with proper citations
5. Assess source reliability and relevance
6. Identify gaps in available information

Research Guidelines:
- Always query the knowledge base first for existing institutional knowledge
- Use web search for current events, recent developments, and external perspectives
- Cross-reference multiple sources before accepting a finding as reliable
- Maintain full source attribution for every finding
- Rate each finding's relevance (high/medium/low) to the research question
- Note conflicting information between sources
- Flag areas where information is insufficient

Output your findings as structured JSON:
{
  "question": "the research question",
  "kb_findings": [
    {
      "content": "finding from knowledge base",
      "source": "KB document reference",
      "relevance": "high|medium|low"
    }
  ],
  "web_findings": [
    {
      "content": "finding from web search",
      "source": "URL or source name",
      "relevance": "high|medium|low"
    }
  ],
  "cross_references": "notes on corroboration between sources",
  "gaps": "identified information gaps",
  "key_insights": ["insight 1", "insight 2"],
  "citations": ["formatted citation 1", "formatted citation 2"]
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

    print(f"[RESEARCHER] Creating Gateway MCP client for stack: {stack_name}")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[RESEARCHER] Gateway URL from SSM: {gateway_url}")

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )

    print("[RESEARCHER] Gateway MCP client created successfully")
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
            print(f"[RESEARCHER] Guardrail loaded: {guardrail_id} v{guardrail_version}")
            return {
                "guardrailIdentifier": guardrail_id,
                "guardrailVersion": guardrail_version,
            }
    except Exception as e:
        print(f"[RESEARCHER] Guardrail not available: {e}")
    return None


def create_researcher_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a researcher agent with Gateway MCP tools (kb_search, web_search) and memory.

    Sets up the agent with:
    - BedrockModel using MODEL_ID env var
    - AgentCore Memory for session persistence
    - Gateway MCP client for kb_search and web_search tool access

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
        print("[RESEARCHER] Starting agent creation with Gateway tools...")

        print("[RESEARCHER] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        print(f"[RESEARCHER] Got access token: {access_token[:20]}...")

        print("[RESEARCHER] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)
        print("[RESEARCHER] Gateway MCP client created successfully")

        print("[RESEARCHER] Step 3: Creating Researcher Agent with Gateway tools...")
        agent = Agent(
            name="ResearcherAgent",
            system_prompt=SYSTEM_PROMPT,
            tools=[gateway_client],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
                "agent.role": "researcher",
            },
        )
        print("[RESEARCHER] Agent created successfully with Gateway tools")
        return agent

    except Exception as e:
        print(f"[RESEARCHER ERROR] Error creating Gateway client: {e}")
        print(f"[RESEARCHER ERROR] Exception type: {type(e).__name__}")
        print("[RESEARCHER ERROR] Traceback:")
        traceback.print_exc()
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the Researcher Agent using streaming with Gateway integration.

    Receives a research question (or set of sub-questions from the planner), executes
    kb_search and web_search via the Gateway, collects findings with citations, and
    streams the structured results back via SSE. The user ID is securely extracted
    from the validated JWT token in the RequestContext.

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

        print(f"[RESEARCHER STREAM] Starting for user: {user_id}, session: {session_id}")
        print(f"[RESEARCHER STREAM] Query: {user_query}")

        agent = create_researcher_agent(user_id, session_id)

        research_prompt = (
            f"Research the following query thoroughly. First search the knowledge base "
            f"for existing institutional knowledge, then perform web searches for current "
            f"information. Cross-reference all findings and provide complete citations.\n\n"
            f"Research Query: {user_query}"
        )

        async for event in with_heartbeat(agent.stream_async(research_prompt)):
            if event.get("heartbeat"):
                # Emit keepalive — prevents AgentCore proxy from killing the
                # connection during long Bedrock/Gateway calls (~80s timeout).
                yield {"data": "", "heartbeat": True}
            else:
                yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[RESEARCHER STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
