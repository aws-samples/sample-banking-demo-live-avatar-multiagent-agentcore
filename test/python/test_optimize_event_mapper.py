"""Property-based tests for the Bedrock-event -> `prompt_opt` mapper
(`patterns/orchestrator-agent/optimize_targets.py::map_optimize_event`).

Covers the design's correctness property for the pure event mapper (see
`.kiro/specs/prompt-optimization-showcase/design.md`). The mapper is pure — no
boto3, no I/O — so this runs fully in-process with no AWS and no deploy:

* **Property 3 — Bedrock optimize events map to typed events preserving kind,
  model, and text.** For any sequence of Bedrock stream items (each an
  `analyzePromptEvent` or an `optimizedPromptEvent` with arbitrary text, for an
  arbitrary Target_Model), the mapper emits, in order, one `prompt_opt` payload
  per item whose `kind` is `analysis`/`optimized` respectively, whose
  `target_model_id` equals the source model id, and whose `text` equals the
  source message / optimized prompt.

The property runs >= 100 Hypothesis examples.
"""

from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st
from optimize_targets import SUPPORTED_TARGET_MODELS, map_optimize_event

# Model ids/labels the events are tagged with — the three verified targets plus
# a couple of arbitrary ids to prove the mapper preserves whatever it is handed.
_MODEL_IDS: tuple[str, ...] = tuple(tm.optimize_target_id for tm in SUPPORTED_TARGET_MODELS) + (
    "anthropic.some-other-model-v1:0",
    "",
)


@st.composite
def _analyze_item(draw: st.DrawFn) -> tuple[dict, str, str]:
    """A Bedrock analyzePromptEvent item paired with its expected (kind, text)."""
    message = draw(st.text(max_size=300))
    return {"analyzePromptEvent": {"message": message}}, "analysis", message


@st.composite
def _optimized_item(draw: st.DrawFn) -> tuple[dict, str, str]:
    """A Bedrock optimizedPromptEvent item paired with its expected (kind, text)."""
    text = draw(st.text(max_size=300))
    item = {"optimizedPromptEvent": {"optimizedPrompt": {"textPrompt": {"text": text}}}}
    return item, "optimized", text


_event_item = st.one_of(_analyze_item(), _optimized_item())


class TestProperty3EventMappingPreservesKindModelAndText:
    """Feature: prompt-optimization-showcase, Property 3: Bedrock optimize events
    map to typed events preserving kind, model, and text."""

    @settings(max_examples=200, deadline=None)
    @given(
        model_id=st.sampled_from(_MODEL_IDS),
        model_label=st.text(max_size=40),
        items=st.lists(_event_item, max_size=25),
    )
    def test_each_item_maps_in_order_preserving_kind_model_text(
        self,
        model_id: str,
        model_label: str,
        items: list[tuple[dict, str, str]],
    ) -> None:
        """Feature: prompt-optimization-showcase, Property 3: Bedrock optimize
        events map to typed events preserving kind, model, and text.

        Mapping a sequence of analyze/optimized items yields, in order, one
        prompt_opt payload per item; each carries the expected kind, the source
        model id, the model label, and the exact source text.
        """
        mapped = [map_optimize_event(item, model_id, model_label) for item, _, _ in items]

        # One payload per source item, in order (no item dropped, none added).
        assert len(mapped) == len(items)

        for payload, (_, expected_kind, expected_text) in zip(mapped, items):
            assert payload is not None
            assert payload["kind"] == expected_kind
            assert payload["target_model_id"] == model_id
            assert payload["model_label"] == model_label
            assert payload["text"] == expected_text

    @settings(max_examples=150, deadline=None)
    @given(
        model_id=st.sampled_from(_MODEL_IDS),
        model_label=st.text(max_size=40),
        item=_event_item,
    )
    def test_single_item_kind_matches_source_event_type(
        self,
        model_id: str,
        model_label: str,
        item: tuple[dict, str, str],
    ) -> None:
        """Feature: prompt-optimization-showcase, Property 3: Bedrock optimize
        events map to typed events preserving kind, model, and text.

        An analyzePromptEvent maps to kind "analysis"; an optimizedPromptEvent
        maps to kind "optimized" — never crossed.
        """
        event, expected_kind, expected_text = item
        payload = map_optimize_event(event, model_id, model_label)

        assert payload is not None
        assert payload["kind"] == expected_kind
        assert payload["text"] == expected_text
        assert payload["target_model_id"] == model_id

    @settings(max_examples=100, deadline=None)
    @given(
        model_id=st.sampled_from(_MODEL_IDS),
        model_label=st.text(max_size=40),
    )
    def test_unrecognized_event_maps_to_none(self, model_id: str, model_label: str) -> None:
        """Feature: prompt-optimization-showcase, Property 3: Bedrock optimize
        events map to typed events preserving kind, model, and text.

        An event carrying neither analyzePromptEvent nor optimizedPromptEvent is
        not rendered — the mapper returns None so the handler can skip it.
        """
        assert map_optimize_event({"someOtherEvent": {"x": 1}}, model_id, model_label) is None
        assert map_optimize_event({}, model_id, model_label) is None
