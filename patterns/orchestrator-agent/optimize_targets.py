"""Target-model registry, validator, request builder, and event mapper for the
Bedrock Prompt Optimization showcase.

This is a **pure module** — no boto3, no I/O — so every seam here is fully
unit/property testable without AWS or a deploy. It is the single source of
truth for which models the AI Agent's Current_System_Prompt may be optimized
toward, how each is invoked, and how a streamed Bedrock event becomes a
`prompt_opt` payload.

Verified Bedrock constraints that shape this module (confirmed working in the
target account, us-east-1):

- `OptimizePrompt` (boto3 `bedrock-agent-runtime`:
  `optimize_prompt(input={"textPrompt": {"text": <prompt>}}, targetModelId=<id>)`)
  accepts **foundation-model IDs only**, never inference-profile IDs. The AI
  Agent's Current_Model (`us.anthropic.claude-sonnet-4-6`) is an inference
  profile and is therefore never a valid optimize target.
- On-demand *invocation* diverges from optimization: the Claude 4.5 targets are
  invocable on-demand only through a regional inference profile, while
  `anthropic.claude-3-haiku-20240307-v1:0` is invocable directly. Each registry
  entry therefore records both the foundation-model `optimize_target_id` (the
  only id ever sent to `OptimizePrompt`) and the invocable `invoke_id` (used
  when building a `BedrockModel` for a sample run or an applied Candidate).
  The map is kept explicit rather than derived because the FM->profile mapping
  is not a pure string transform (the `us.`-prefix convention does not
  universally hold and 3 Haiku has no profile).
- The verified-supported targets are exactly the three below; the feature uses
  at most these three.
"""

from __future__ import annotations

from typing import Any, Iterable, NamedTuple


class TargetModel(NamedTuple):
    """A model the Current_System_Prompt may be optimized toward."""

    optimize_target_id: str  # foundation-model ID — the ONLY id sent to OptimizePrompt
    invoke_id: str  # invocable id (inference profile where required) for sample/apply
    label: str  # human label for the Provenance_Label


# The fixed set of at most three verified foundation models. Each records the
# foundation-model `optimize_target_id` (sent to OptimizePrompt) and its
# invocable `invoke_id`. Claude 4.5 targets invoke through a `us.` regional
# inference profile; Claude 3 Haiku invokes directly as its foundation-model id.
SUPPORTED_TARGET_MODELS: tuple[TargetModel, ...] = (
    TargetModel(
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        "Claude Sonnet 4.5",
    ),
    TargetModel(
        "anthropic.claude-haiku-4-5-20251001-v1:0",
        "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "Claude Haiku 4.5",
    ),
    TargetModel(
        "anthropic.claude-3-haiku-20240307-v1:0",
        "anthropic.claude-3-haiku-20240307-v1:0",
        "Claude 3 Haiku",
    ),
)

# At most three Target_Model optimization requests per triggered showcase
# (Requirement 1.3). Defensive cap: there are only three supported entries, so
# `submit` can never exceed this after de-duplication.
_MAX_TARGETS = 3

# Inference-profile-form ids carry a cross-region routing prefix. OptimizePrompt
# rejects any id of this form, so none may ever reach `submit`. The list is not
# exhaustive of every AWS region group but covers the deployable prefixes and,
# critically, the `us.` prefix of the Current_Model profile and every 4.5
# `invoke_id`.
_INFERENCE_PROFILE_PREFIXES: tuple[str, ...] = ("us.", "eu.", "apac.")

# foundation-model id -> TargetModel, for O(1) supported-target lookup.
_BY_OPTIMIZE_ID: dict[str, TargetModel] = {tm.optimize_target_id: tm for tm in SUPPORTED_TARGET_MODELS}


class InvalidTarget(NamedTuple):
    """A requested identifier excluded from submission, with why it was dropped."""

    id: str
    reason: str  # "inference_profile" | "unsupported"


class ValidationResult(NamedTuple):
    """Partition of requested identifiers into submittable targets and dropped ids."""

    submit: list[TargetModel]
    invalid: list[InvalidTarget]


def is_inference_profile_id(model_id: str) -> bool:
    """True for inference-profile-form ids that OptimizePrompt rejects as targets.

    These are ids carrying a cross-region routing prefix (for example the
    Current_Model profile `us.anthropic.claude-sonnet-4-6` or a 4.5 target's
    `invoke_id`); none of them is a valid `targetModelId`.
    """
    return model_id.startswith(_INFERENCE_PROFILE_PREFIXES)


def validate_optimize_targets(requested: Iterable[str]) -> ValidationResult:
    """Partition requested ids into submittable targets and dropped ids.

    `submit` is a subset of `SUPPORTED_TARGET_MODELS` in foundation-model form,
    de-duplicated, and capped at three; it never contains an inference-profile
    id. Every id carrying an inference-profile prefix (including the
    Current_Model profile and every `invoke_id`) is surfaced in `invalid` with
    reason `"inference_profile"`; any other unrecognized id is surfaced with
    reason `"unsupported"`. Classification of an inference-profile id takes
    precedence, so an invocable/profile id is never mistaken for a target.
    """
    submit: list[TargetModel] = []
    invalid: list[InvalidTarget] = []
    seen: set[str] = set()

    for model_id in requested:
        if model_id in seen:
            continue
        seen.add(model_id)

        if is_inference_profile_id(model_id):
            invalid.append(InvalidTarget(model_id, "inference_profile"))
        elif model_id in _BY_OPTIMIZE_ID:
            submit.append(_BY_OPTIMIZE_ID[model_id])
        else:
            invalid.append(InvalidTarget(model_id, "unsupported"))

    return ValidationResult(submit=submit[:_MAX_TARGETS], invalid=invalid)


def build_optimize_request(prompt_text: str, target: TargetModel) -> dict[str, Any]:
    """Build the OptimizePrompt request for one target.

    The request always carries the exact `prompt_text` and the target's
    foundation-model `optimize_target_id` as `targetModelId` — never its
    invocable/profile `invoke_id`.
    """
    return {
        "input": {"textPrompt": {"text": prompt_text}},
        "targetModelId": target.optimize_target_id,
    }


def map_optimize_event(
    event: dict[str, Any],
    target_model_id: str,
    model_label: str,
) -> dict[str, Any] | None:
    """Map one Bedrock OptimizePrompt stream item to a `prompt_opt` payload.

    - `analyzePromptEvent` -> `kind="analysis"`, `text` = its message.
    - `optimizedPromptEvent` -> `kind="optimized"`, `text` = the optimized
      prompt's text.

    Both preserve `target_model_id` and `model_label`. Any other event shape
    returns `None` so the streaming handler can skip event types it does not
    render. Pure — no boto3, no I/O.
    """
    analyze = event.get("analyzePromptEvent")
    if analyze is not None:
        return {
            "target_model_id": target_model_id,
            "model_label": model_label,
            "kind": "analysis",
            "text": analyze.get("message", ""),
        }

    optimized = event.get("optimizedPromptEvent")
    if optimized is not None:
        text = optimized.get("optimizedPrompt", {}).get("textPrompt", {}).get("text", "")
        return {
            "target_model_id": target_model_id,
            "model_label": model_label,
            "kind": "optimized",
            "text": text,
        }

    return None
