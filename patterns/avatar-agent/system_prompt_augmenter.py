"""
System prompt augmenter for the Avatar Agent.

Dynamically appends contextual sections to the base persona prompt based on which
tools are available in the current session. This keeps the system prompt lean when
features are disabled (e.g., no memory, no canvas) and enriches it when they are present.

Ported from the sonic-avatar project's augmentation pattern.
"""

import logging

logger = logging.getLogger(__name__)

# --- Augmentation Sections ---
# Each section is appended only when its corresponding tools are detected in the
# available tool list. Sections are written for voice output (no markdown).

MEMORY_SECTION = """

## Memory Context

You have access to persistent memory. At the start of a conversation, proactively
recall memories to personalize the interaction. When the user shares preferences,
important context, or asks you to remember something, save it to memory.

Do not mention the memory system unless the user asks about it. Use recalled
memories naturally, as if you simply remember previous conversations.
"""

CANVAS_SECTION = """

## Visual Canvas

You can generate and edit images using Nova Canvas. When you create an image,
the user will see it in their interface automatically. After generating an image,
briefly describe what you created in one sentence.

You can also edit existing images by referencing them. Ask the user what changes
they want before editing. If the user asks for something ambiguous, clarify before
generating.
"""

VIDEO_SECTION = """

## Video Generation

You can generate short videos using Nova Reel. Video generation takes time,
typically one to two minutes. Let the user know it will take a moment, and they
will be notified when the video is ready.

Confirm the video concept with the user before generating. Be specific about
the visual content and any motion or transitions.
"""

VISION_SECTION = """

## Vision Capabilities

You can analyze images that the user shares with you. When an image is provided,
describe what you observe and respond to questions about the image content.

Keep visual descriptions concise and relevant to the user's question.
"""

DATA_SOURCES_SECTION = """

## Research Data Sources

You can query Wikipedia for encyclopedic background and arXiv for academic papers.
Use Wikipedia when the user asks for general knowledge explanations. Use arXiv when
the user wants scientific papers, citations, or cutting-edge research.

Summarize results conversationally. Do not read out full abstracts or URLs.
"""

PROFILE_SECTION = """

## User Profile and Accounts

You can retrieve the user's profile information. Use this to personalize greetings
and tailor responses. Retrieve the profile early in the conversation if you have
not yet addressed the user by name.

The profile result also carries the accounts this user has opened, including any
opened moments ago with the Client Advisor. It is the only place those records
live, so retrieve the profile whenever the user asks about their own accounts or
applications. Do not search the knowledge base for them: it holds product
literature, not customer records, and will correctly say it knows nothing about
the account. A user may have accounts without a stored profile, which is normal;
report the accounts you find.
"""

# Mapping from tool name patterns to augmentation sections.
# A section is appended if ANY of its associated tool patterns match an available tool.
_AUGMENTATION_MAP: list[tuple[list[str], str]] = [
    (["save_memory", "recall_memories", "memory"], MEMORY_SECTION),
    (["nova_canvas_generate", "nova_canvas_edit", "canvas"], CANVAS_SECTION),
    (["nova_reel_generate", "nova_reel"], VIDEO_SECTION),
    (["data_sources"], DATA_SOURCES_SECTION),
    (["retrieve_user_profile", "user_profile"], PROFILE_SECTION),
]


def augment_system_prompt(
    base_prompt: str,
    available_tools: list[str],
) -> str:
    """
    Augment the base persona prompt with contextual sections based on available tools.

    Scans the list of available tool names and appends relevant instruction sections
    to the base prompt. Tool names are matched with substring containment, so
    'gateway_nova_canvas_generate' matches the 'nova_canvas_generate' pattern.

    Args:
        base_prompt: The persona system prompt to augment.
        available_tools: List of tool name strings available in the current session.

    Returns:
        The augmented system prompt with all applicable sections appended.
    """
    augmented = base_prompt
    tools_lower = [t.lower() for t in available_tools]

    for patterns, section in _AUGMENTATION_MAP:
        # Check if any pattern is a substring of any available tool name
        if any(pattern in tool_name for pattern in patterns for tool_name in tools_lower):
            augmented += section
            matched = [p for p in patterns if any(p in t for t in tools_lower)]
            logger.info("Augmented prompt with section for tools: %s", matched)

    return augmented
