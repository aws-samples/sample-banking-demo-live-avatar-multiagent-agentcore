"""
Per-model output-token ceilings for the models offered in the UI selector.

Bedrock rejects any request whose `max_tokens` exceeds the model's documented
output limit with a ValidationException:

    The maximum tokens you requested exceeds the model limit of 64000.
    Try again with a maximum tokens value that is lower than 64000.

The research pipeline picks `max_tokens` from the depth table (up to 65535)
while the model is chosen independently by the user, so the two can disagree.
`clamp_max_tokens` reconciles them by lowering the request to whatever the
selected model actually accepts.

Ceilings are established by probing `bedrock-runtime:Converse` in us-east-1
(verified 4 Aug 2026), NOT by reading the model cards. The cards are rounded and
can be stale: the Claude Sonnet 4.6 card states "64K" but the model accepts
128000. Bedrock reports the true limit in the ValidationException message, so
the cheapest way to (re)confirm a ceiling is to send an absurd maxTokens and
read the number back out of the error:

    The maximum tokens you requested exceeds the model limit of 128000.

Keep in sync with AVAILABLE_MODELS in
lib/stacks/frontend/app/src/hooks/useModelSelector.ts.
"""

import logging

logger = logging.getLogger(__name__)

# Matched as substrings against the model ID, so this covers both bare IDs
# ("us.anthropic.claude-sonnet-4-6") and versioned ones
# ("us.anthropic.claude-haiku-4-5-20251001-v1:0"). Order matters only where one
# fragment is a prefix of another; the fragments below are mutually exclusive.
MODEL_MAX_OUTPUT_TOKENS: tuple[tuple[str, int], ...] = (
    ("claude-haiku-4-5", 64_000),
    ("claude-sonnet-4-6", 128_000),
    ("claude-sonnet-5", 128_000),
    ("claude-opus-5", 128_000),
    ("claude-opus-4-7", 128_000),
    ("nova-2-lite", 65_535),
)

# Applied to any model not listed above. 64000 is the smallest ceiling across
# the current selector, so an unrecognised model fails safe (a smaller output
# budget) rather than raising a ValidationException at stream time.
DEFAULT_MAX_OUTPUT_TOKENS = 64_000


def model_max_output_tokens(model_id: str) -> int:
    """Return the maximum `max_tokens` Bedrock accepts for `model_id`."""
    for fragment, limit in MODEL_MAX_OUTPUT_TOKENS:
        if fragment in model_id:
            return limit
    return DEFAULT_MAX_OUTPUT_TOKENS


def clamp_max_tokens(model_id: str, max_tokens: int) -> int:
    """Lower `max_tokens` to `model_id`'s ceiling, logging when it is reduced."""
    ceiling = model_max_output_tokens(model_id)
    if max_tokens <= ceiling:
        return max_tokens
    logger.info(
        "Clamping max_tokens %d -> %d for model %s",
        max_tokens,
        ceiling,
        model_id,
    )
    return ceiling
