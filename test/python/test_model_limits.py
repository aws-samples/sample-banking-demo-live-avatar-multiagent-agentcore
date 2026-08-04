"""Tests for the per-model output-token ceilings.

The research pipeline picks `max_tokens` from its depth table while the model is
chosen independently in the UI, so the two can disagree. Claude Haiku 4.5 caps
output at 64000 and rejects anything higher with a ValidationException, which
surfaced as "Planner failed: ... The maximum tokens you requested exceeds the
model limit of 64000".

Ceilings below were probed against `bedrock-runtime:Converse` in us-east-1 on
4 Aug 2026, not taken from the model cards — the Sonnet 4.6 card says "64K" but
the model accepts 128000.
"""

from __future__ import annotations

import pytest
from model_limits import (
    DEFAULT_MAX_OUTPUT_TOKENS,
    MODEL_MAX_OUTPUT_TOKENS,
    clamp_max_tokens,
    model_max_output_tokens,
)

# Every value in AVAILABLE_MODELS (useModelSelector.ts) mapped to its
# empirically confirmed Bedrock ceiling. Versioned and bare IDs are both
# represented on purpose.
SELECTOR_MODELS = {
    "us.anthropic.claude-sonnet-5": 128_000,
    "us.anthropic.claude-opus-5": 128_000,
    "us.anthropic.claude-opus-4-7": 128_000,
    "us.anthropic.claude-sonnet-4-6": 128_000,
    "us.anthropic.claude-haiku-4-5-20251001-v1:0": 64_000,
    "us.amazon.nova-2-lite-v1:0": 65_535,
}

# The depth table's ceiling, and the synthesizer's hardcoded request.
DEPTH_MAX_TOKENS = 65_535
SYNTHESIZER_MAX_TOKENS = 65_536


@pytest.mark.parametrize(("model_id", "expected"), SELECTOR_MODELS.items())
def test_every_selector_model_has_a_known_ceiling(model_id: str, expected: int) -> None:
    assert model_max_output_tokens(model_id) == expected


@pytest.mark.parametrize("model_id", SELECTOR_MODELS)
def test_depth_table_request_never_exceeds_ceiling(model_id: str) -> None:
    """The regression itself: 65535 from DEPTH_CONFIGS must be clamped."""
    clamped = clamp_max_tokens(model_id, DEPTH_MAX_TOKENS)
    assert clamped <= model_max_output_tokens(model_id)


@pytest.mark.parametrize("model_id", SELECTOR_MODELS)
def test_synthesizer_request_never_exceeds_ceiling(model_id: str) -> None:
    clamped = clamp_max_tokens(model_id, SYNTHESIZER_MAX_TOKENS)
    assert clamped <= model_max_output_tokens(model_id)


def test_haiku_45_is_clamped_to_64000() -> None:
    model_id = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
    assert clamp_max_tokens(model_id, DEPTH_MAX_TOKENS) == 64_000


def test_sonnet_46_is_not_clamped() -> None:
    """Sonnet 4.6 accepts 128000 despite its model card claiming 64K.

    Clamping it to 64000 would silently halve its output budget, so the depth
    table's request must pass through untouched.
    """
    assert clamp_max_tokens("us.anthropic.claude-sonnet-4-6", DEPTH_MAX_TOKENS) == DEPTH_MAX_TOKENS


def test_sonnet_46_and_sonnet_5_resolve_independently() -> None:
    """Guard the substring table against one Sonnet fragment shadowing another."""
    assert model_max_output_tokens("us.anthropic.claude-sonnet-4-6") == 128_000
    assert model_max_output_tokens("us.anthropic.claude-sonnet-5") == 128_000


def test_nova_2_lite_keeps_65535() -> None:
    """Bedrock rejects 65536 on Nova 2 Lite but accepts 65535."""
    assert clamp_max_tokens("us.amazon.nova-2-lite-v1:0", DEPTH_MAX_TOKENS) == 65_535
    assert clamp_max_tokens("us.amazon.nova-2-lite-v1:0", SYNTHESIZER_MAX_TOKENS) == 65_535


def test_values_below_the_ceiling_pass_through_untouched() -> None:
    """Quick depth (16384) must not be inflated for any model."""
    for model_id in SELECTOR_MODELS:
        assert clamp_max_tokens(model_id, 16_384) == 16_384


def test_unknown_model_falls_back_to_the_smallest_ceiling() -> None:
    """An unrecognised ID should fail safe rather than raise at stream time."""
    assert model_max_output_tokens("us.anthropic.claude-something-new") == DEFAULT_MAX_OUTPUT_TOKENS
    assert DEFAULT_MAX_OUTPUT_TOKENS == min(limit for _, limit in MODEL_MAX_OUTPUT_TOKENS)
