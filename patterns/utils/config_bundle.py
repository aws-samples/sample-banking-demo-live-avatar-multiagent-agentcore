"""Apply an AgentCore configuration-bundle system prompt at model-call time.

During an AgentCore A/B test (configuration-bundle mode), the AgentCore Gateway
assigns each session to a variant and propagates the active bundle reference via
W3C baggage headers; the runtime resolves it and exposes the bundle through
``BedrockAgentCoreContext.get_config_bundle()``. This hook reads that bundle
before each model call and, when it carries a ``system_prompt``, overrides the
agent's prompt for the turn — so control sessions run the current prompt and
treatment sessions run the challenger, with NO code deploy or restart.

No-op safe by design: if the AgentCore SDK, the request context, or the bundle
is absent (the normal case outside an A/B test), or the bundle carries no
``system_prompt``, the agent keeps its configured prompt. Never raises — a
telemetry-adjacent read must not break a customer turn.

Uses the Strands ``HookProvider`` + ``BeforeModelCallEvent`` pattern, mirroring
``utils.tool_guard`` so agent construction stays uniform.
"""

import logging
from typing import Any

from strands.hooks import BeforeModelCallEvent, HookProvider, HookRegistry

logger = logging.getLogger(__name__)

__all__ = ["ConfigBundleHook"]


class ConfigBundleHook(HookProvider):
    """Overrides the agent's system prompt from the active AgentCore config bundle.

    The bundle is a versioned, immutable snapshot of agent configuration
    (system prompt, model id, tool descriptions). This hook only reads the
    ``system_prompt`` component; other components are applied elsewhere (the
    Gateway applies tool-description overrides on ``tools/list``).
    """

    def __init__(self, base_system_prompt: str) -> None:
        # Kept for reference/debugging; the agent already holds this prompt, so a
        # missing bundle simply leaves it in place.
        self._base_system_prompt = base_system_prompt

    def register_hooks(self, registry: HookRegistry, **kwargs: Any) -> None:
        registry.add_callback(BeforeModelCallEvent, self._apply_bundle)

    def _apply_bundle(self, event: BeforeModelCallEvent) -> None:
        try:
            from bedrock_agentcore.runtime import BedrockAgentCoreContext
        except Exception:  # noqa: BLE001 - SDK shape/version differences are non-fatal
            return
        try:
            bundle = BedrockAgentCoreContext.get_config_bundle()
        except Exception:  # noqa: BLE001 - no active bundle is the normal case
            return
        if not isinstance(bundle, dict):
            return
        prompt = bundle.get("system_prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return
        try:
            event.agent.system_prompt = prompt
            logger.info("config_bundle: applied bundle system_prompt (%d chars)", len(prompt))
        except Exception as exc:  # noqa: BLE001 - never break the turn
            logger.debug("config_bundle: could not apply system_prompt: %s", exc)
