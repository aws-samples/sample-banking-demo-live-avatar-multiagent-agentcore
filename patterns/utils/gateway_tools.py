"""Gateway tool naming, shared by every transport that scopes a tool call.

Deliberately free of Strands and LiveKit imports. Both transports need the same
answer to "is this tool user-scoped, and what is it called": the AgentCore path
through Strands hooks (`tool_guard`, `pipeline_scope`) and the LiveKit worker
through its own MCP layer (`patterns/livekit-agent`). The LiveKit image does not
install Strands, so importing the hook module there fails at startup — but
duplicating the set would be worse than a dependency, because a drift between the
two copies would silently disable scoping on one path and nothing would say so.
"""

# Separator the AgentCore Gateway puts between a target name and its tool name.
GATEWAY_NAME_SEPARATOR = "___"


def bare_tool_name(registered_name: str) -> str:
    """Reduce a registered tool name to the tool itself.

    A gateway tool reaches the agent as ``<prefix>_<target>___<tool>``, e.g.
    ``gateway_pdf-generator___pdf_generator`` — the target segment uses hyphens
    and the client prefix is prepended. Matching on the full string therefore
    never succeeded, and the hooks in this package returned early for every call:
    nothing was ever injected or filtered. Probed against the live gateway, all 17
    registered names differed from the values the scoped set used to list, so the
    overlap was zero.

    Comparing only the trailing segment is stable against both the prefix and the
    target's own naming.
    """
    return registered_name.rsplit(GATEWAY_NAME_SEPARATOR, 1)[-1]


# Gateway tools that require the verified user_id, by bare tool name.
USER_SCOPED_TOOLS: frozenset[str] = frozenset(
    {
        "kb_search",
        "pdf_generator",
        "recall_memories",
        "analyze_patterns",
        "retrieve_user_profile",
        "image_generate",
        "image_history",
        "open_account",
    }
)
