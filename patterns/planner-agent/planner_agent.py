"""
Planner Agent - Decomposes research queries into structured sub-questions with priorities.

Uses BedrockAgentCoreApp + @app.entrypoint async generator pattern for SSE streaming.
Connects to AgentCore Gateway for kb_search tool access and uses AgentCore Memory
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

SYSTEM_PROMPT = """You are a Research Planner Agent. Your role is to analyze complex research
queries and break them into focused, executable sub-questions with clear priorities.

Your responsibilities:
1. Analyze the user's research query to identify core themes and dimensions
2. Use the gateway_kb_search tool to check existing research plans in the knowledge base
3. Decompose the query into 3-7 focused sub-questions
4. Assign priority (high/medium/low) and research type (web/kb/analysis) to each
5. Create a structured research plan that other agents can execute

Guidelines:
- Break complex topics into specific, researchable sub-questions
- Check the knowledge base for similar past research before planning
- Consider multiple perspectives: technical, business, regulatory, market
- Prioritize questions by importance and dependency ordering
- Ensure sub-questions are independent enough to research in parallel where possible
- Include estimated complexity for each sub-question

Output your plan as structured JSON:
{
  "research_topic": "...",
  "sub_questions": [
    {
      "id": 1,
      "question": "...",
      "priority": "high|medium|low",
      "type": "web|kb|analysis",
      "rationale": "why this question matters"
    }
  ],
  "methodology": "overall research approach",
  "dependencies": "any ordering constraints between questions",
  "estimated_time": "total estimated research time"
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

    print(f"[PLANNER] Creating Gateway MCP client for stack: {stack_name}")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[PLANNER] Gateway URL from SSM: {gateway_url}")

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )

    print("[PLANNER] Gateway MCP client created successfully")
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
            print(f"[PLANNER] Guardrail loaded: {guardrail_id} v{guardrail_version}")
            return {
                "guardrailIdentifier": guardrail_id,
                "guardrailVersion": guardrail_version,
            }
    except Exception as e:
        print(f"[PLANNER] Guardrail not available: {e}")
    return None


def create_planner_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a planner agent with Gateway MCP tools (kb_search) and memory.

    Sets up the agent with:
    - BedrockModel using MODEL_ID env var
    - AgentCore Memory for session persistence
    - Gateway MCP client for kb_search tool access

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
        print("[PLANNER] Starting agent creation with Gateway tools...")

        print("[PLANNER] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        print(f"[PLANNER] Got access token: {access_token[:20]}...")

        print("[PLANNER] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)
        print("[PLANNER] Gateway MCP client created successfully")

        print("[PLANNER] Step 3: Creating Planner Agent with Gateway tools...")
        agent = Agent(
            name="PlannerAgent",
            system_prompt=SYSTEM_PROMPT,
            tools=[gateway_client],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
                "agent.role": "planner",
            },
        )
        print("[PLANNER] Agent created successfully with Gateway tools")
        return agent

    except Exception as e:
        print(f"[PLANNER ERROR] Error creating Gateway client: {e}")
        print(f"[PLANNER ERROR] Exception type: {type(e).__name__}")
        print("[PLANNER ERROR] Traceback:")
        traceback.print_exc()
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the Planner Agent using streaming with Gateway integration.

    Receives a research query, decomposes it into sub-questions with priorities,
    and streams the structured plan back via SSE. The user ID is securely extracted
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

        print(f"[PLANNER STREAM] Starting for user: {user_id}, session: {session_id}")
        print(f"[PLANNER STREAM] Query: {user_query}")

        agent = create_planner_agent(user_id, session_id)

        planning_prompt = (
            f"Create a comprehensive research plan for the following query. "
            f"First search the knowledge base for similar past research, then "
            f"decompose into prioritized sub-questions.\n\n"
            f"Research Query: {user_query}"
        )

        async for event in with_heartbeat(agent.stream_async(planning_prompt)):
            if event.get("heartbeat"):
                yield {"data": "", "heartbeat": True}
            else:
                yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[PLANNER STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
