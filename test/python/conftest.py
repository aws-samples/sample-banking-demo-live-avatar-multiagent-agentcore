"""Shared pytest fixtures for the isolation test suite.

These tests cover the invariants that make the three logical KB pipelines and
per-user scoping actually safe at runtime:

1. `PipelineScopeHook` — runtime-side injector of the KB read filter and
   pdf_generator write tag. Lives in `patterns/utils/pipeline_scope.py`.
2. `UserScopeHook` — runtime-side injector of the verified user_id. Lives in
   `patterns/utils/tool_guard.py`.
3. `kb_search._build_filter` — composes the Bedrock KB filter from user_id
   + pipelines.
4. `kb_ingest._resolve_pipeline` — maps S3 object metadata to a pipeline tag.

Tests exercise the hooks and helper functions directly without Strands Agent
instantiation or AWS calls, so the harness runs in pre-commit on any laptop.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# The memory reader tools import `agentcore_memory` from a Lambda layer. At
# runtime the layer lands on sys.path automatically; here it has to be added, or
# importing those handlers fails before a single assertion runs.
_MEMORY_LAYER = REPO_ROOT / "gateway" / "layers" / "memory" / "python"
if str(_MEMORY_LAYER) not in sys.path:
    sys.path.insert(0, str(_MEMORY_LAYER))


def _load_tool_handler(tool_name: str) -> ModuleType:
    """Load `gateway/tools/<tool_name>/handler.py` as a standalone module.

    Every tool's file is named `handler.py`, so we can't share pythonpath
    entries between them — the first import wins. Loading via
    `importlib.util.spec_from_file_location` with a unique module name
    sidesteps the collision and lets each test pick exactly the handler
    it needs.
    """
    module_name = f"_gateway_tool_{tool_name}"
    if module_name in sys.modules:
        return sys.modules[module_name]

    handler_path = REPO_ROOT / "gateway" / "tools" / tool_name / "handler.py"
    spec = importlib.util.spec_from_file_location(module_name, handler_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load {handler_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def load_tool():
    """Factory for loading a gateway tool handler by its directory name."""
    return _load_tool_handler


class FakeBeforeToolCallEvent:
    """Minimal stand-in for Strands' BeforeToolCallEvent.

    The real event carries a `tool_use` dict with `name` and `input` keys. The
    hook reads and mutates `tool_use["input"]` in place. That's all we need
    for the isolation assertions.
    """

    def __init__(self, name: str, tool_input: dict[str, Any] | None = None) -> None:
        self.tool_use: dict[str, Any] = {"name": name, "input": tool_input or {}}


@pytest.fixture
def make_event():
    """Factory fixture for constructing FakeBeforeToolCallEvent instances."""

    def _factory(name: str, **tool_input: Any) -> FakeBeforeToolCallEvent:
        return FakeBeforeToolCallEvent(name=name, tool_input=dict(tool_input))

    return _factory


@pytest.fixture
def lambda_context():
    """Stand-in for Lambda context with the bedrockAgentCoreToolName client_context.

    Gateway tool Lambdas read the MCP tool name out of client_context.custom
    (the Gateway prefixes the tool name with the target name + "___" delimiter).
    Tests pass a plain `tool_name` and this fixture wraps it correctly.
    """

    def _factory(tool_name: str) -> SimpleNamespace:
        return SimpleNamespace(
            client_context=SimpleNamespace(custom={"bedrockAgentCoreToolName": f"target___{tool_name}"})
        )

    return _factory
