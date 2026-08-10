# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""The services catalog is exported only after a human approves it.

Two behaviours are locked in here.

1. The catalog pipeline is SPLIT. `menu` mode designs and stops; `menu_export`
   carries the reviewed catalog into the export phases. Without the split the
   PDF was written before anyone had seen the catalog, which made the review
   controls decorative — you could "edit" an item that had already shipped.

2. Streaming is pinned ON for every phase. Strands reads streaming as
   `config.get("streaming", True)` against a `bool | None` type, so a
   present-but-None value silently selects the non-streaming branch, which
   indexes `response["output"]` unguarded and dies with a bare
   `KeyError: 'output'` — observed in the AI Assistant's export phase.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def orch():
    for extra in (REPO_ROOT / "patterns" / "orchestrator-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    path = REPO_ROOT / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"
    spec = importlib.util.spec_from_file_location("_orchestrator_menu_gate", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestDesignExportSplit:
    def test_design_phase_runs_alone(self, orch):
        # Only the designer may run before review — anything further would
        # produce a deliverable the user never saw.
        assert [p["name"] for p in orch.MENU_DESIGN_PHASES] == ["menu_designer"]

    def test_export_phases_exclude_the_designer(self, orch):
        names = [p["name"] for p in orch.MENU_EXPORT_PHASES]
        assert "menu_designer" not in names
        # Re-designing on export would discard the user's edits.
        assert names == ["menu_pdf_writer", "menu_website_writer"]

    def test_split_covers_every_menu_phase(self, orch):
        # No phase may be dropped by the split, or a deliverable silently stops
        # being produced.
        combined = [p["name"] for p in orch.MENU_DESIGN_PHASES + orch.MENU_EXPORT_PHASES]
        assert sorted(combined) == sorted(p["name"] for p in orch.MENU_PHASES)

    def test_export_phases_are_tagged_export(self, orch):
        # The pipeline's recoverable-failure path keys off role == "export", so
        # the tag is load-bearing, not cosmetic.
        for phase in orch.MENU_EXPORT_PHASES:
            assert phase["role"] == "export"

    def test_designer_is_not_tagged_export(self, orch):
        # A design failure has no prior work to preserve and must stay fatal.
        assert orch.MENU_DESIGN_PHASES[0]["role"] != "export"


class TestStreamingPinned:
    @pytest.mark.parametrize(
        "model_id",
        [
            "us.amazon.nova-2-lite-v1:0",
            "us.anthropic.claude-sonnet-4-6",
            "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        ],
    )
    def test_streaming_is_explicitly_true(self, orch, model_id):
        model = orch._build_model(model_id, temperature=0.1)
        # Explicitly True, not merely absent: absence relies on a default that a
        # None value would defeat.
        assert model.config.get("streaming") is True

    def test_caller_can_still_override(self, orch):
        # setdefault, not a hard assignment — a caller with a reason to disable
        # streaming is not blocked.
        model = orch._build_model("us.anthropic.claude-sonnet-4-6", temperature=0.1, streaming=False)
        assert model.config.get("streaming") is False

    def test_streaming_survives_guardrail_kwargs(self, orch):
        # The chatbot path passes guardrail kwargs through the same builder.
        model = orch._build_model(
            "us.anthropic.claude-sonnet-4-6",
            temperature=0.3,
            guardrail_id="gr-123",
            guardrail_version="1",
        )
        assert model.config.get("streaming") is True
        assert model.config.get("guardrail_id") == "gr-123"
