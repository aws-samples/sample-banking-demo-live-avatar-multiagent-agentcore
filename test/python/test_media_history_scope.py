# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Image/video history must read the partition the generator actually wrote.

The generators wrote PK=session#{session_id} using an id the model supplied,
which the generator defaults to a fresh uuid and never returns. So the history
tools queried a partition nobody could name and answered "count: 0" for media
that existed. Nothing asserted the two halves agreed, which is why it survived.

These tests pin the contract from both sides: the writers key on the verified
caller, the readers query that same key, and every handler refuses loudly when
the runtime did not supply a user_id rather than filing a record under `user#`.
"""

import importlib
import json
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

GATEWAY_TOOLS = Path(__file__).resolve().parents[2] / "gateway" / "tools"

USER = "cognito-sub-1234"


def _load(tool: str):
    """Import a gateway tool handler by directory name.

    Each tool ships its own top-level `handler` module, so the path is swapped in
    and the module purged around each import to avoid resolving a cached sibling.
    """
    sys.path.insert(0, str(GATEWAY_TOOLS / tool))
    sys.modules.pop("handler", None)
    try:
        return importlib.import_module("handler")
    finally:
        sys.path.pop(0)


def _lambda_context(tool: str) -> MagicMock:
    context = MagicMock()
    context.client_context.custom = {"bedrockAgentCoreToolName": f"gateway_{tool.replace('_', '-')}___{tool}"}
    return context


def _stub_table(module, items: list[dict]) -> MagicMock:
    table = MagicMock()
    table.query.return_value = {"Items": items}
    module.dynamodb = MagicMock()
    module.dynamodb.Table.return_value = table
    return table


def _partition_of(table: MagicMock) -> str:
    """The partition value the reader asked DynamoDB for."""
    condition = table.query.call_args.kwargs["KeyConditionExpression"]
    # boto3's Key(...).eq(...) & Key(...).begins_with(...) — the left operand of
    # the AND carries the partition equality.
    return condition._values[0]._values[1]


class TestImageHistory:
    def test_reads_the_callers_partition(self):
        module = _load("nova_canvas_history")
        module.METADATA_TABLE = "stub"
        module.IMAGES_BUCKET = ""
        table = _stub_table(module, [])

        module._get_image_history(USER, 10)

        assert _partition_of(table) == f"user#{USER}"
        assert table.query.call_args.kwargs["ScanIndexForward"] is False

    def test_maps_the_stored_image_id_not_the_sort_key(self):
        """The sort key carries a timestamp, so parsing it would misreport the id."""
        module = _load("nova_canvas_history")
        module.METADATA_TABLE = "stub"
        module.IMAGES_BUCKET = ""
        _stub_table(
            module,
            [
                {
                    "PK": f"user#{USER}",
                    "SK": "image#2026-08-05T09:28:00#a1b2c3d4",
                    "imageId": "a1b2c3d4",
                    "prompt": "a vault door",
                    "s3_key": "images/x/a1b2c3d4.png",
                }
            ],
        )

        result = json.loads(module._get_image_history(USER, 10))

        assert result["count"] == 1
        assert result["images"][0]["image_id"] == "a1b2c3d4"
        assert result["user_id"] == USER

    def test_refuses_without_a_verified_caller(self):
        module = _load("nova_canvas_history")
        module.METADATA_TABLE = "stub"

        result = module.handler({"limit": 10}, _lambda_context("nova_canvas_history"))

        assert "user_id" in result["error"]


class TestVideoHistory:
    def test_reads_the_callers_partition(self):
        module = _load("nova_reel_history")
        module.METADATA_TABLE = "stub"
        table = _stub_table(module, [])

        module._get_video_history(USER, 10)

        assert _partition_of(table) == f"user#{USER}"
        assert table.query.call_args.kwargs["ScanIndexForward"] is False

    def test_maps_the_stored_video_id_not_the_sort_key(self):
        module = _load("nova_reel_history")
        module.METADATA_TABLE = "stub"
        _stub_table(
            module,
            [
                {
                    "PK": f"user#{USER}",
                    "SK": "video#2026-08-05T09:28:00#req-9",
                    "videoId": "req-9",
                    "prompt": "a branch lobby",
                }
            ],
        )

        result = json.loads(module._get_video_history(USER, 10))

        assert result["videos"][0]["video_id"] == "req-9"
        assert result["user_id"] == USER

    def test_refuses_without_a_verified_caller(self):
        module = _load("nova_reel_history")
        module.METADATA_TABLE = "stub"

        result = module.handler({"limit": 10}, _lambda_context("nova_reel_history"))

        assert "user_id" in result["error"]


@pytest.mark.parametrize(
    ("tool", "event"),
    [
        ("nova_canvas_generate", {"prompt": "a vault door"}),
        ("nova_reel_generate", {"prompt": "a branch lobby"}),
        ("nova_canvas_edit", {"image_url": "https://example.invalid/i.png", "edit_prompt": "brighten"}),
        ("place_order", {"items": [{"name": "Everyday Checking"}]}),
    ],
)
def test_writers_refuse_without_a_verified_caller(tool, event):
    """A missing user_id must fail visibly, never write to a `user#` partition.

    place_order returned exactly this for every call before the scope hook was
    fixed, and the Client Advisor narrated success anyway — so the failure has to
    stay loud enough that a caller cannot mistake it for a completed write.
    """
    module = _load(tool)
    result = module.handler(event, _lambda_context(tool))

    payload = result.get("error") or result["content"][0]["text"]
    assert "user_id" in payload
