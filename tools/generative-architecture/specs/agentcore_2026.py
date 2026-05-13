"""
Legacy architecture spec: Gartner AppDev 2026 — Serverless GenAI on AgentCore.

This is the original inline spec that lived at the top of gen_arch.py. It has
been extracted verbatim so the `--target agentcore-2026` code path stays
byte-identical to the pre-refactor behavior.

If you want to evolve this spec, edit here; the Claude prompt contract
lives in gen_arch.py.
"""

from __future__ import annotations

from research_agent_config import ArchitectureSpec

TITLE = "Gartner AppDev 2026 — Serverless GenAI on AgentCore"

CLUSTERS = """
    Cluster Frontend (bgcolor=#EEF5FF, pencolor=#3B82F6, penwidth=2, style=filled) contains User, Amplify App
    Cluster Authentication (bgcolor=#FFF7ED, pencolor=#F59E0B, penwidth=2, style=filled) contains Cognito Auth
    Cluster Amazon Bedrock AgentCore (bgcolor=#F0FDF4, pencolor=#01A88D, penwidth=3, style=filled) contains Orchestrator Runtime, Avatar Runtime, Gateway MCP, Episodic Memory, Guardrails
    Cluster Gateway Lambda Tools (bgcolor=#FDF2F8, pencolor=#EC4899, penwidth=2, style=filled) contains Lambda Tools, Feedback API
    Cluster AI Models (bgcolor=#FAF5FF, pencolor=#8B5CF6, penwidth=2, style=filled) contains Claude Sonnet 4.6, Nova 2 Sonic, Nova 2 Lite, Nova Canvas, Nova Reel, Titan Embed
    Cluster Data and Storage (bgcolor=#FFFBEB, pencolor=#D97706, penwidth=2, style=filled) contains DynamoDB, S3 Buckets, Knowledge Base, Neptune
"""

NODES = """
    Custom:icons/Browser_Tool.png 1-User
    Custom:icons/Browser_Tool.png 2-AmplifyApp
    Custom:icons/Identity.png 3-CognitoAuth
    Custom:icons/Runtime.png 4-Orchestrator
    Custom:icons/Runtime.png 5-AvatarRuntime
    Custom:icons/Gateway.png 6-GatewayMCP
    Custom:icons/Memory.png 7-EpisodicMemory
    Custom:icons/Policy_Engine_Agentic_Guardrails.png 8-Guardrails
    Lambda 9-LambdaTools
    Lambda 10-FeedbackAPI
    Sagemaker 11-Sonnet46
    Sagemaker 12-NovaSonic
    Sagemaker 13-NovaLite
    Sagemaker 14-NovaCanvas
    Sagemaker 15-NovaReel
    Sagemaker 16-TitanEmbed
    Dynamodb 17-DynamoDB
    SimpleStorageServiceS3 18-S3Buckets
    Sagemaker 19-KnowledgeBase
    Neptune 20-Neptune
"""

EDGES = """
    1-User points to 2-AmplifyApp (color=#3B82F6, style=bold, penwidth=2)
    2-AmplifyApp points to 3-CognitoAuth (color=#F59E0B, style=dashed)
    2-AmplifyApp points to 4-Orchestrator (color=#01A88D, penwidth=2)
    2-AmplifyApp points to 5-AvatarRuntime (color=#01A88D, penwidth=2)
    2-AmplifyApp points to 10-FeedbackAPI (color=#EC4899)
    4-Orchestrator points to 6-GatewayMCP (color=#01A88D)
    5-AvatarRuntime points to 6-GatewayMCP (color=#01A88D)
    4-Orchestrator points to 7-EpisodicMemory (color=#01A88D)
    5-AvatarRuntime points to 7-EpisodicMemory (color=#01A88D)
    4-Orchestrator points to 8-Guardrails (color=#01A88D)
    4-Orchestrator points to 11-Sonnet46 (color=#8B5CF6, penwidth=2)
    5-AvatarRuntime points to 12-NovaSonic (color=#8B5CF6, penwidth=2)
    5-AvatarRuntime points to 13-NovaLite (color=#8B5CF6)
    6-GatewayMCP points to 9-LambdaTools (color=#EC4899)
    9-LambdaTools points to 17-DynamoDB (color=#D97706)
    9-LambdaTools points to 18-S3Buckets (color=#D97706)
    9-LambdaTools points to 19-KnowledgeBase (color=#D97706)
    9-LambdaTools points to 20-Neptune (color=#D97706)
    9-LambdaTools points to 14-NovaCanvas (color=#8B5CF6)
    9-LambdaTools points to 15-NovaReel (color=#8B5CF6)
    19-KnowledgeBase points to 18-S3Buckets (color=#D97706, style=dashed)
    19-KnowledgeBase points to 16-TitanEmbed (color=#8B5CF6, style=dashed)
"""


def build() -> ArchitectureSpec:
    """Return the legacy spec as an ArchitectureSpec dataclass."""
    return ArchitectureSpec(
        title=TITLE,
        clusters=CLUSTERS.strip(),
        nodes=NODES.strip(),
        edges=EDGES.strip(),
        extra_prompt="",
    )
