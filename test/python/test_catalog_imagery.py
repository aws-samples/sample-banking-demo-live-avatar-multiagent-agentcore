# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Catalog and report imagery: every product gets one, and none carry text.

Two defects are pinned here.

1. `menu_designer` had no entry in STATIC_PHASE_MAX_TURNS, so it inherited the
   20-turn default. One image per product across four sections needs ~26 turns,
   so the phase was cut off partway and most of the catalog shipped with no
   imagery — PDFs and web pages looked half-finished.

2. Image prompts named the product and asked for logos and infographics.
   Diffusion models draw whatever lettering they are given, so a catalog image
   came back reading "Trinity M?naged / SOTEROIAFLI OEN MANCIA fadSTB".
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
    spec = importlib.util.spec_from_file_location("_orchestrator_catalog_imagery", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestDesignerHasRoomForEveryImage:
    def test_budget_covers_one_image_per_product(self, orch):
        # 4 sections x 3 products = 12 images, plus the opening kb_search and the
        # closing JSON write. Each tool call costs roughly two turns.
        required = (12 + 1) * 2 + 2
        assert orch._phase_turn_limit("menu_designer") >= required

    def test_designer_is_not_left_on_the_generic_default(self, orch):
        # The regression was silent precisely because the default applied.
        assert "menu_designer" in orch.STATIC_PHASE_MAX_TURNS
        assert orch._phase_turn_limit("menu_designer") > orch.DEFAULT_PHASE_MAX_TURNS

    def test_export_phases_stay_lean(self, orch):
        # The writers only call one tool each; they must not inherit the
        # designer's much larger ceiling.
        for phase in ("menu_pdf_writer", "menu_website_writer"):
            assert orch._phase_turn_limit(phase) <= 12


class TestPromptsForbidTextInImages:
    def test_designer_forbids_words_in_image_prompts(self, orch):
        prompt = orch.MENU_DESIGNER_PROMPT
        assert "no text" in prompt.lower()
        # The product name is what the model was rendering as broken lettering.
        assert "NEVER put the product name" in prompt

    def test_designer_forbids_logo_and_label_subjects(self, orch):
        lowered = orch.MENU_DESIGNER_PROMPT.lower()
        for banned in ("logo", "label", "poster", "banner"):
            assert banned in lowered, f"designer prompt should warn against {banned}"

    def test_researcher_no_longer_requests_logos_or_infographics(self, orch):
        prompt = orch.RESEARCHER_PROMPT
        assert "no text" in prompt.lower()
        # It used to ask outright for "a brand storefront/logo motif" and a
        # "Professional infographic illustration".
        assert "storefront/logo motif" not in prompt
        assert "Professional infographic illustration" not in prompt

    def test_researcher_points_captions_at_the_report_not_the_image(self, orch):
        assert "caption" in orch.RESEARCHER_PROMPT.lower()


class TestCanvasHandlerSuppressesTextCentrally:
    """The tool defends itself, so a future prompt cannot reintroduce the bug."""

    @pytest.fixture(scope="class")
    def canvas(self):
        path = REPO_ROOT / "gateway" / "tools" / "image_generate" / "handler.py"
        source = path.read_text(encoding="utf-8")
        return source

    def test_a_default_negative_prompt_exists(self, canvas):
        assert "NO_TEXT_NEGATIVE" in canvas
        for term in ("text", "letters", "watermark", "logo"):
            assert term in canvas

    def test_negative_prompt_is_always_sent(self, canvas):
        # Previously it was only set when the caller supplied one, so every
        # prompt that forgot got no protection at all.
        assert 'request_payload["negative_prompt"] = (' in canvas
        assert "if negative_prompt else NO_TEXT_NEGATIVE" in canvas
