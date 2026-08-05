# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Tool output must reach the browser as JSON, not as a Python repr.

An MCP tool result is not a string — it is content blocks. `str()` on those
produced `[{'type': 'text', ...}]`, which is not JSON, so `JSON.parse` threw in
the client, the artifact parser bailed, and a generated website showed a
"Done" badge with no link while the avatar said it had shared one.

The client-side counterpart is test/typescript/toolArtifacts.test.ts, which
includes the Python-repr case to show it is unrecoverable once sent.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def worker():
    """Load the LiveKit worker module.

    It sits outside a package and imports siblings (`persona_prompts`, `utils`),
    so both its own directory and `patterns/` go on the path first.
    """
    for extra in (REPO_ROOT / "patterns" / "livekit-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))

    path = REPO_ROOT / "patterns" / "livekit-agent" / "livekit_agent.py"
    spec = importlib.util.spec_from_file_location("_livekit_agent_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_string_passes_through_unchanged(worker):
    payload = json.dumps({"success": True, "url": "https://example.invalid/i.html"})

    assert worker._serialize_tool_output(payload) == payload


def test_content_blocks_serialize_to_valid_json(worker):
    blocks = [{"type": "text", "text": json.dumps({"success": True, "url": "https://x.invalid/"})}]

    result = worker._serialize_tool_output(blocks)

    # The point of the fix: the client can parse this. `str(blocks)` could not be.
    assert json.loads(result) == blocks
    assert "'" not in result


def test_none_becomes_empty(worker):
    assert worker._serialize_tool_output(None) == ""


def test_an_arbitrary_object_becomes_valid_json(worker):
    class Opaque:
        def __repr__(self):
            return "<opaque>"

    # `default=str` means even an unexpected type stays parseable on the client,
    # rather than arriving as a bare repr the way it used to.
    assert json.loads(worker._serialize_tool_output(Opaque())) == "<opaque>"


def test_a_nested_object_is_coerced_rather_than_dropped(worker):
    class Result:
        def __repr__(self):
            return "<result>"

    result = worker._serialize_tool_output({"payload": Result()})

    # The envelope stays parseable even when a member is not natively JSON.
    assert json.loads(result) == {"payload": "<result>"}


def test_a_circular_structure_falls_back_to_text(worker):
    """The only realistic way json.dumps still fails.

    Dropping the event would hide that the tool ran at all, so text is kept even
    though the client will find no artifact in it.
    """
    circular: dict = {}
    circular["self"] = circular

    assert worker._serialize_tool_output(circular).startswith("{")
