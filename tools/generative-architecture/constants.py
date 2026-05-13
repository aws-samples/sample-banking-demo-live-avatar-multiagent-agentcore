"""
Configuration constants for architecture diagram generation.

Centralizes all magic numbers, strings, and configuration values used
throughout the diagram generation process. Per-target overrides live in
``TARGETS`` — add a new entry and reference it from ``gen_arch.py``.
"""

# Generation settings
MAX_ATTEMPTS = 3
CODE_EXECUTION_TIMEOUT = 30  # seconds

# Diagram settings
DIAGRAM_DPI = "200"
DIAGRAM_DIRECTION = "LR"  # Left to right
DIAGRAM_SPLINES = "ortho"  # Orthogonal edges
DIAGRAM_SHOW = False  # Don't display, just save to file

# File paths — shared across targets
OUTPUT_CODE_FILE = "genai_architect.py"

# Legacy default output filename (used by TARGETS["agentcore-2026"] below)
OUTPUT_DIAGRAM_FILE = "gartner_appdev_2026_architecture.png"

# Per-target output filenames. gen_arch.py reads the entry matching
# the selected --target flag.
TARGETS: dict[str, dict[str, str]] = {
    "agentcore-2026": {
        "output_filename": OUTPUT_DIAGRAM_FILE,
    },
    "research-agent": {
        "output_filename": "research_agent_architecture.png",
        # Toolkit now lives in-repo at tools/generative-architecture/ —
        # `../..` takes us back to the repo root.
        "copy_to": "../../architecture.drawio.png",
        # Snapshot archive pattern. `{ts}` is replaced with a timestamp.
        "snapshot_pattern": "outputs/{ts}_research_agent_architecture.png",
    },
}

# AWS Bedrock settings
AWS_REGION = "us-east-1"

# Claude model — verified ID from CLAUDE.md. `us.` prefix = US-region CRIS
# profile that routes across us-east-1, us-east-2, us-west-2.
MODEL_ID_REGIONAL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
MODEL_ID_GLOBAL = "global.anthropic.claude-sonnet-4-5-20250929-v1:0"

# Claude API settings
CLAUDE_MAX_TOKENS = 8191
CLAUDE_TEMPERATURE = 0

# Visual separators for output
OUTPUT_SEPARATOR = "=" * 80
