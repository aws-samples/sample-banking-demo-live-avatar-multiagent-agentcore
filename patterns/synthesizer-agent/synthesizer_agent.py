"""
Synthesizer Agent - Compiles research findings into structured reports with executive summaries.

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
from botocore.config import Config as BotocoreConfig
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.heartbeat import with_heartbeat
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = """You are a Research Synthesizer Agent. Your role is to compile research
findings from multiple sources into a structured, coherent report with an executive summary,
organized key findings, and actionable recommendations.

Your responsibilities:
1. Retrieve all research findings from the knowledge base for the given topic
2. Analyze and synthesize information from multiple sources
3. Identify patterns, trends, and key insights across findings
4. Compile structured reports with proper citations and organization
5. Highlight conflicting information and areas of uncertainty
6. Generate actionable conclusions and recommendations

Synthesis Guidelines:
- Organize information by themes and topics, not by source
- Cross-reference multiple sources for accuracy and corroboration
- Highlight conflicting information and note uncertainties
- Provide clear, concise executive summaries (2-3 paragraphs max)
- Include comprehensive citations for all claims
- Structure content logically with clear section headers
- Prioritize findings by relevance and confidence level

Output your synthesis as structured JSON:
{
  "topic": "research topic",
  "executive_summary": "2-3 paragraph summary of the most important findings",
  "key_findings": [
    {
      "theme": "theme name",
      "finding": "specific finding",
      "confidence": "high|medium|low",
      "sources": ["source 1", "source 2"]
    }
  ],
  "supporting_evidence": {
    "knowledge_base": ["evidence from KB"],
    "web_sources": ["evidence from web"],
    "cross_referenced": ["corroborated findings"]
  },
  "conflicts_and_uncertainties": "areas where sources disagree or info is lacking",
  "conclusions": "overall conclusions drawn from the evidence",
  "recommendations": ["actionable recommendation 1", "recommendation 2"],
  "citations": ["full citation 1", "full citation 2"]
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

    print(f"[SYNTHESIZER] Creating Gateway MCP client for stack: {stack_name}")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[SYNTHESIZER] Gateway URL from SSM: {gateway_url}")

    gateway_client = MCPClient(
        lambda: streamablehttp_client(url=gateway_url, headers={"Authorization": f"Bearer {access_token}"}),
        prefix="gateway",
    )

    print("[SYNTHESIZER] Gateway MCP client created successfully")
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
            print(f"[SYNTHESIZER] Guardrail loaded: {guardrail_id} v{guardrail_version}")
            return {
                "guardrailIdentifier": guardrail_id,
                "guardrailVersion": guardrail_version,
            }
    except Exception as e:
        print(f"[SYNTHESIZER] Guardrail not available: {e}")
    return None


def create_synthesizer_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a synthesizer agent with Gateway MCP tools (kb_search) and memory.

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
    model_kwargs = {
        "model_id": model_id,
        "max_tokens": 65536,
        "boto_client_config": BotocoreConfig(
            read_timeout=1800,
            connect_timeout=60,
            retries={"max_attempts": 3, "mode": "adaptive"},
        ),
    }

    # Enable extended thinking for Claude models that support it
    is_claude_thinking = "anthropic" in model_id and "haiku" not in model_id
    if is_claude_thinking:
        model_kwargs["additional_request_fields"] = {"thinking": {"type": "enabled", "budget_tokens": 10000}}
    else:
        model_kwargs["temperature"] = 0.1

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
        print("[SYNTHESIZER] Starting agent creation with Gateway tools...")

        print("[SYNTHESIZER] Step 1: Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        print(f"[SYNTHESIZER] Got access token: {access_token[:20]}...")

        print("[SYNTHESIZER] Step 2: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client(access_token)
        print("[SYNTHESIZER] Gateway MCP client created successfully")

        print("[SYNTHESIZER] Step 3: Creating Synthesizer Agent with Gateway tools...")
        agent = Agent(
            name="SynthesizerAgent",
            system_prompt=SYSTEM_PROMPT,
            tools=[gateway_client],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
                "agent.role": "synthesizer",
            },
        )
        print("[SYNTHESIZER] Agent created successfully with Gateway tools")
        return agent

    except Exception as e:
        print(f"[SYNTHESIZER ERROR] Error creating Gateway client: {e}")
        print(f"[SYNTHESIZER ERROR] Exception type: {type(e).__name__}")
        print("[SYNTHESIZER ERROR] Traceback:")
        traceback.print_exc()
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the Synthesizer Agent using streaming with Gateway integration.

    Receives research findings (or a topic to retrieve findings for), compiles them
    into a structured report with executive summary, key findings, and recommendations,
    then streams the result back via SSE. The user ID is securely extracted from the
    validated JWT token in the RequestContext.

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

        print(f"[SYNTHESIZER STREAM] Starting for user: {user_id}, session: {session_id}")
        print(f"[SYNTHESIZER STREAM] Query: {user_query}")

        agent = create_synthesizer_agent(user_id, session_id)

        synthesis_prompt = (
            f"Synthesize a comprehensive research report for the following. "
            f"First retrieve all relevant findings from the knowledge base, then "
            f"organize them into a structured report with executive summary, "
            f"key findings by theme, supporting evidence, conclusions, and "
            f"actionable recommendations. Include full citations.\n\n"
            f"Research Topic / Findings: {user_query}"
        )

        async for event in with_heartbeat(agent.stream_async(synthesis_prompt)):
            if event.get("heartbeat"):
                yield {"data": "", "heartbeat": True}
            else:
                yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[SYNTHESIZER STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
