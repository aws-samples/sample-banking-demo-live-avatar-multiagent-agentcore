# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""A wedged research worker must not hang the whole phase.

A worker runs the model and MCP tools synchronously in a thread. The turn limit
bounds turns, not a single call that never returns — a hung Gateway tool blocks
that thread forever, and the consumer loop would wait on it indefinitely while
heartbeats kept the UI "live". Observed in production: a run sat 22 minutes with
zero application progress.

These tests pin the guard: once a worker goes idle past the timeout, the phase
abandons it, merges whatever the other workers produced, and finishes — so one
stuck section can no longer freeze the run.
"""

import asyncio
import importlib.util
import json
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def orch():
    for extra in (REPO_ROOT / "patterns" / "orchestrator-agent", REPO_ROOT / "patterns"):
        if str(extra) not in sys.path:
            sys.path.insert(0, str(extra))
    path = REPO_ROOT / "patterns" / "orchestrator-agent" / "orchestrator_agent.py"
    spec = importlib.util.spec_from_file_location("_orchestrator_parallel_timeout", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FastAgent:
    """Returns findings immediately."""

    def __init__(self, index):
        self.callback_handler = None
        self._index = index

    def __call__(self, _prompt, **_kwargs):
        return json.dumps(
            {
                "questions_researched": [{"question": f"q{self._index}"}],
                "key_insights": [f"insight from section {self._index}"],
                "citations": [f"https://example.com/{self._index}"],
            }
        )


class WedgedAgent:
    """Simulates a worker stuck in a tool call: emits nothing, then returns late.

    The sleep is bounded only so the test's executor can drain — the phase must
    have already moved on well before it returns.
    """

    def __init__(self):
        self.callback_handler = None

    def __call__(self, _prompt, **_kwargs):
        time.sleep(3)
        return json.dumps({"questions_researched": [], "key_insights": []})


def _run(orch, monkeypatch):
    # Shrink the idle timeout so the test exercises the guard in ~1s.
    monkeypatch.setattr(orch, "WORKER_IDLE_TIMEOUT_SEC", 1)
    monkeypatch.setattr(orch, "PARALLEL_PHASE_WALL_CLOCK_SEC", 60)
    monkeypatch.setattr(orch, "_create_gateway_mcp_client", lambda _t: object())
    monkeypatch.setattr(orch, "_build_model", lambda *a, **k: object())
    monkeypatch.setattr(orch, "_payment_prompt_addendum", lambda: "")

    # Worker 3 (name endswith _w3) wedges; the other three return at once.
    def _factory(name, *a, **k):
        return WedgedAgent() if name.endswith("_w3") else FastAgent(name[-1])

    monkeypatch.setattr(orch, "_create_agent", _factory)

    phase = {
        "name": "researcher",
        "role": "research",
        "prompt": "research",
        "messages": ["Searching..."],
        "estimated_duration": 300,
        "search_budget": 40,
    }
    accumulated = json.dumps({"sub_questions": [{"question": q} for q in ["q0", "q1", "q2", "q3"]]})

    async def go():
        events = []
        async for event in orch._run_parallel_research(
            phase, accumulated, "query", "user", "session", "model", None, "token"
        ):
            events.append(event)
        return events

    started = time.monotonic()
    events = asyncio.run(go())
    return events, time.monotonic() - started


def test_phase_finishes_despite_a_wedged_worker(orch, monkeypatch):
    events, _ = _run(orch, monkeypatch)
    # The decisive assertion: the generator returned at all. A merged result is
    # emitted from the sections that completed.
    results = [e for e in events if "__result__" in e]
    assert results, "phase produced no merged result — it hung or aborted"
    assert not any("__fallback__" in e for e in events)


def test_it_does_not_wait_for_the_wedged_worker(orch, monkeypatch):
    _, elapsed = _run(orch, monkeypatch)
    # Idle timeout is 1s; the phase must break out around then, well before the
    # wall-clock cap. (asyncio.run drains the 3s wedged thread on shutdown, so
    # allow headroom for that — the point is it's not waiting on the 60s cap.)
    assert elapsed < 10, f"phase waited too long ({elapsed:.1f}s) — it did not abandon the worker"


def test_partial_results_are_merged_and_flagged(orch, monkeypatch):
    events, _ = _run(orch, monkeypatch)
    notices = [e["thinking"]["content"] for e in events if "thinking" in e]
    assert any("did not finish" in n and "timed out" in n for n in notices)

    # The three completed sections' findings survive into the merged document.
    merged = next(e["__result__"] for e in events if "__result__" in e)
    data = json.loads(merged)
    insights = " ".join(data.get("key_insights", []))
    assert "section" in insights  # at least one completed section's insight is present
