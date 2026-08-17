# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Parallel research reports its tool activity to the client.

The parallel researcher counted tool calls internally to drive the progress
percentage but never streamed them, so while the bar advanced the Researcher
node's activity badge sat at 1, its AWS-service chips stayed empty, and the run
report showed "0 tool calls" for a phase doing dozens of searches.

These tests pin the two signals the UI needs: a `current_tool_use` event
carrying the tool NAME (same shape the sequential phase streams, which the
frontend turns into `tool_use_start` -> TOOL_CALL) and a per-call `thinking`
trace so the badge tracks real work.
"""

import asyncio
import importlib.util
import json
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
    spec = importlib.util.spec_from_file_location("_orchestrator_parallel_telemetry", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeAgent:
    """Stands in for a Strands agent, driving the worker's callback handler."""

    def __init__(self, tool_names):
        self.callback_handler = None
        self._tool_names = tool_names

    def __call__(self, _prompt, **_kwargs):
        for i, name in enumerate(self._tool_names):
            # Strands re-emits current_tool_use for every input delta; repeat
            # each call so the de-duplication is exercised.
            for _ in range(3):
                self.callback_handler(current_tool_use={"toolUseId": f"tu-{i}", "name": name})
            # A completed message carries the final, fully-formed arguments.
            self.callback_handler(
                message={
                    "content": [
                        {"toolUse": {"name": name, "input": {"query": f"{name} query {i}"}}},
                        {"toolResult": {"status": "ok"}},
                    ]
                }
            )
        return json.dumps(
            {
                "questions_researched": [{"question": "q1"}, {"question": "q2"}],
                "key_insights": ["TXSE volume concentrates in energy listings"],
                "citations": ["https://example.com/a", "https://example.com/b"],
            }
        )


def _plan_with(questions):
    return json.dumps({"sub_questions": [{"question": q} for q in questions]})


def _collect(orch, monkeypatch, tool_names):
    """Run the parallel generator with fake workers and return its events."""
    monkeypatch.setattr(orch, "_create_gateway_mcp_client", lambda _t: object())
    monkeypatch.setattr(orch, "_build_model", lambda *a, **k: object())
    monkeypatch.setattr(orch, "_create_agent", lambda *a, **k: FakeAgent(tool_names))
    monkeypatch.setattr(orch, "_payment_prompt_addendum", lambda: "")

    phase = {
        "name": "researcher",
        "role": "research",
        "prompt": "research",
        "messages": ["Searching..."],
        "estimated_duration": 300,
        "search_budget": 40,
    }
    accumulated = _plan_with(["q1", "q2", "q3", "q4"])

    async def run():
        events = []
        async for event in orch._run_parallel_research(
            phase,
            accumulated,
            "query",
            "user",
            "session",
            "model",
            None,
            "token",
        ):
            events.append(event)
        return events

    return asyncio.run(run())


def test_tool_use_events_carry_the_tool_name(orch, monkeypatch):
    events = _collect(orch, monkeypatch, ["kb_search", "web_search"])
    tool_uses = [e for e in events if "current_tool_use" in e]

    assert tool_uses, "parallel research streamed no tool_use events"
    names = {e["current_tool_use"]["name"] for e in tool_uses}
    assert names == {"kb_search", "web_search"}
    # Empty input marks a tool_use_start in the parser — that is the event the
    # frontend turns into a TOOL_CALL dispatch.
    assert all(e["delta"]["toolUse"]["input"] == "" for e in tool_uses)


def test_tool_use_events_are_marked_telemetry_only(orch, monkeypatch):
    # Worker tool calls never stream their arguments or results, so rendering
    # them as chat cards left dozens of empty dropdowns burying the
    # conversation. The flag keeps them in the diagram and run report only.
    events = _collect(orch, monkeypatch, ["kb_search", "web_search"])
    tool_uses = [e for e in events if "current_tool_use" in e]

    assert tool_uses
    assert all(e.get("telemetry_only") is True for e in tool_uses)


def test_repeated_deltas_do_not_double_count_one_call(orch, monkeypatch):
    # The fake fires each current_tool_use three times per call.
    events = _collect(orch, monkeypatch, ["kb_search"])
    tool_uses = [e for e in events if "current_tool_use" in e]
    # One event per (worker, call) — never three.
    assert len(tool_uses) == len({e["current_tool_use"]["toolUseId"] for e in tool_uses})


def test_tool_use_ids_are_namespaced_per_worker(orch, monkeypatch):
    # Shards run concurrently and Strands only guarantees ids unique within one
    # agent, so unnamespaced ids would collide and collapse in the UI.
    events = _collect(orch, monkeypatch, ["kb_search"])
    ids = [e["current_tool_use"]["toolUseId"] for e in events if "current_tool_use" in e]
    assert all(i.startswith("w") for i in ids)
    assert len(set(ids)) == len(ids)


def test_traces_name_the_actual_query_not_just_the_tool(orch, monkeypatch):
    events = _collect(orch, monkeypatch, ["kb_search", "web_search"])
    traces = [e["thinking"]["content"] for e in events if "thinking" in e]

    # Plain-language action, not the raw gateway function name.
    assert any("Searching the knowledge base" in t for t in traces)
    assert any("Searching the web" in t for t in traces)
    # And the question actually put to it — the reasoning a reader wants.
    assert any("kb_search query 0" in t for t in traces)
    assert all(e["thinking"]["agent"] == "researcher" for e in events if "thinking" in e)


def test_shard_assignment_is_announced(orch, monkeypatch):
    # How the brief was divided is a decision worth showing, so each section
    # states the sub-questions it owns before work starts.
    events = _collect(orch, monkeypatch, ["kb_search"])
    traces = [e["thinking"]["content"] for e in events if "thinking" in e]
    assignments = [t for t in traces if "will investigate" in t]
    assert assignments
    assert any("q1" in t for t in assignments)


def test_completion_reports_findings_not_just_bookkeeping(orch, monkeypatch):
    events = _collect(orch, monkeypatch, ["kb_search"])
    traces = [e["thinking"]["content"] for e in events if "thinking" in e]
    completions = [t for t in traces if "complete" in t]

    assert completions
    # Counts of real output plus the leading insight, rather than "Section N of
    # M complete." on its own.
    assert any("insight(s)" in t and "source(s)" in t for t in completions)
    assert any("Leading finding:" in t for t in completions)
    assert any("energy listings" in t for t in completions)


def test_a_failed_section_says_so(orch, monkeypatch):
    class Boom(FakeAgent):
        def __call__(self, _prompt, **_kwargs):
            raise RuntimeError("gateway unavailable")

    monkeypatch.setattr(orch, "_create_gateway_mcp_client", lambda _t: object())
    monkeypatch.setattr(orch, "_build_model", lambda *a, **k: object())
    monkeypatch.setattr(orch, "_create_agent", lambda *a, **k: Boom([]))
    monkeypatch.setattr(orch, "_payment_prompt_addendum", lambda: "")

    phase = {
        "name": "researcher",
        "role": "research",
        "prompt": "research",
        "messages": ["Searching..."],
        "estimated_duration": 300,
        "search_budget": 40,
    }

    async def run():
        events = []
        try:
            async for event in orch._run_parallel_research(
                phase,
                _plan_with(["q1", "q2", "q3", "q4"]),
                "query",
                "user",
                "session",
                "model",
                None,
                "token",
            ):
                events.append(event)
        except RuntimeError:
            # Every shard failing raises, which is correct — the synthesizer
            # must not receive an empty findings document.
            pass
        return events

    events = asyncio.run(run())
    traces = [e["thinking"]["content"] for e in events if "thinking" in e]
    assert any("failed" in t and "gateway unavailable" in t for t in traces)


def test_still_produces_a_merged_result(orch, monkeypatch):
    events = _collect(orch, monkeypatch, ["kb_search"])
    assert any("__result__" in e for e in events), "telemetry must not displace the result"
    assert not any("__fallback__" in e for e in events)
