"""
Utility for configuring Bedrock Responses API server-side tool execution.
When enabled, tools are executed server-side by Bedrock rather than client-side.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def get_responses_api_config(
    gateway_url: str,
    tool_names: list[str],
    session_id: Optional[str] = None,
) -> dict:
    """
    Build additionalModelRequestFields for Bedrock Responses API
    server-side tool execution via AgentCore Gateway.

    Args:
        gateway_url: AgentCore Gateway MCP endpoint URL.
        tool_names: List of tool names to make available server-side.
        session_id: Optional session ID for tool context.

    Returns:
        Dict suitable for passing as additionalModelRequestFields to Bedrock InvokeModel.
    """
    mcp_servers = {
        "agentcore_gateway": {
            "url": gateway_url,
            "tool_configuration": {
                "enabled": True,
                "allowed_tools": tool_names,
            },
        }
    }

    config = {
        "toolConfig": {
            "mcpServers": mcp_servers,
        }
    }

    if session_id:
        config["toolConfig"]["sessionId"] = session_id

    return config
