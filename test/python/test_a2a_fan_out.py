"""Property-based tests for the section-researcher A2A fan-out dispatcher/merge.

Covers three of the design's correctness properties for the parallel
section-researcher A2A conversion (see
`.kiro/specs/a2a-agent-collaboration/design.md`). The pure dispatcher/merge
seams in `patterns/orchestrator-agent/orchestrator_agent.py` are exercised with
the A2A client mocked out entirely — the `invoke_section` callable is a fake
async closure, so no network, no runtime, and no deploy is required:

* **Property 13 — Each section researcher is invoked exactly once,
  concurrently.** For N >= 2 shards, `dispatch_sections_concurrently` issues
  exactly N invocations (one per shard) and all N start before any completes.
  Overlap is proven with an `asyncio.Barrier(N)`: every fake invocation records
  its start, then blocks on the barrier, which only releases once all N parties
  have arrived — so a sequential dispatcher would deadlock rather than pass.

* **Property 14 — The fan-out merges successes and reports failures.** For any
  Hypothesis-chosen mix of successful/failed section invocations, the returned
  results are exactly the successes, the returned errors are exactly the failed
  indices (every failure reported), no single failure aborts the rest, and the
  successful payloads fed through `_merge_research_findings` yield a merged
  document whose `questions_researched` is exactly the union of the successful
  sections' entries.

* **Property 15 — Missing concurrency fails rather than degrading to
  sequential.** When the injected concurrency provider reports capacity < 2, the
  dispatcher raises `ConcurrencyUnavailableError` and issues ZERO invocations
  (the fake `invoke_section` is never called). `require_concurrency` is also
  exercised directly for capacity 0/1 (raises) vs >= 2 (ok).

Async composed operations are driven with `asyncio.run` per example (a fresh
event loop each time), matching the convention in the rest of this suite. Each
property runs >= 100 Hypothesis examples. Everything under test is referenced
through the `orchestrator_agent` module object so the `ConcurrencyUnavailableError`
identity matches exactly what the running orchestrator raises.
"""

from __future__ import annotations

import asyncio
import json

import orchestrator_agent as oa
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

ConcurrencyUnavailableError = oa.ConcurrencyUnavailableError


def _run(coro):
    """Drive a coroutine to completion on a fresh event loop (per example)."""
    return asyncio.run(coro)


def _shards(n: int) -> list[list[str]]:
    """Build N distinct research shards (one sub-question list per section)."""
    return [[f"section-{i}-q0", f"section-{i}-q1"] for i in range(n)]


def _researcher_payload(index: int) -> str:
    """A per-worker researcher JSON payload with one index-unique question.

    Matches the shape `_merge_research_findings` consumes so the merged
    document's `questions_researched` is the union of the successful sections'
    entries (no cross-section collisions because each entry is index-tagged).
    """
    return json.dumps(
        {
            "questions_researched": [{"question": f"q-{index}", "answer": f"a-{index}"}],
            "key_insights": [f"insight-{index}"],
            "citations": [f"https://synthetic.example/{index}"],
        }
    )


# --- Property 13 ----------------------------------------------------------


class TestProperty13InvokedOnceConcurrently:
    """Feature: a2a-agent-collaboration, Property 13: Each section researcher is
    invoked exactly once, concurrently."""

    @settings(max_examples=150, deadline=None)
    @given(n=st.integers(min_value=2, max_value=6))
    def test_exactly_n_invocations_all_overlap(self, n: int) -> None:
        """Feature: a2a-agent-collaboration, Property 13: Each section researcher
        is invoked exactly once, concurrently.

        Exactly N invocations are issued (one per shard, each index seen once),
        and all N start before any completes. The `asyncio.Barrier(N)` only
        releases once every invocation has recorded its start, and each
        invocation snapshots how many peers had started by the time it finishes;
        the minimum snapshot being N proves full overlap. A sequential dispatch
        could never assemble N parties at the barrier, so it would time out.
        """
        shards = _shards(n)
        barrier = asyncio.Barrier(n)
        started: list[int] = []
        completed: list[int] = []
        # For each completion, how many invocations had already started.
        started_when_completed: list[int] = []

        async def invoke_section(shard: list[str], index: int) -> str:
            started.append(index)
            # Block until ALL N invocations have started — only possible if the
            # dispatcher scheduled them concurrently rather than one at a time.
            await barrier.wait()
            started_when_completed.append(len(started))
            completed.append(index)
            return _researcher_payload(index)

        async def _drive():
            # wait_for turns a would-be sequential deadlock into a failure
            # rather than hanging the suite.
            return await asyncio.wait_for(
                oa.dispatch_sections_concurrently(
                    shards,
                    invoke_section,
                    concurrency_provider=lambda: n,
                ),
                timeout=10,
            )

        results, errors = _run(_drive())

        # Exactly N invocations, one per shard index, no duplicates.
        assert len(started) == n
        assert sorted(started) == list(range(n))
        assert errors == {}
        assert set(results.keys()) == set(range(n))

        # All N started before any completed (true concurrency overlap): every
        # completion observed all N peers already started.
        assert len(started_when_completed) == n
        assert min(started_when_completed) == n


# --- Property 14 ----------------------------------------------------------


@st.composite
def _mixes(draw: st.DrawFn) -> tuple[int, frozenset[int]]:
    """Generate (N, failing_indices) — an arbitrary success/failure partition."""
    n = draw(st.integers(min_value=2, max_value=8))
    failing = draw(st.sets(st.integers(min_value=0, max_value=n - 1), max_size=n))
    return n, frozenset(failing)


class TestProperty14MergeSuccessesReportFailures:
    """Feature: a2a-agent-collaboration, Property 14: The fan-out merges
    successes and reports failures."""

    @settings(max_examples=200, deadline=None)
    @given(mix=_mixes())
    def test_union_of_successes_and_every_failure_reported(self, mix: tuple[int, frozenset[int]]) -> None:
        """Feature: a2a-agent-collaboration, Property 14: The fan-out merges
        successes and reports failures.

        Results are exactly the successful sections, errors are exactly the
        failed sections (every failure reported), a single failure never aborts
        the others, and the successful payloads merged via
        `_merge_research_findings` contain exactly the union of the successful
        sections' `questions_researched` entries.
        """
        n, failing = mix
        successes = [i for i in range(n) if i not in failing]
        shards = _shards(n)
        invoked: list[int] = []

        async def invoke_section(shard: list[str], index: int) -> str:
            invoked.append(index)
            if index in failing:
                raise RuntimeError(f"section {index} A2A invocation failed")
            return _researcher_payload(index)

        results, errors = _run(
            oa.dispatch_sections_concurrently(
                shards,
                invoke_section,
                concurrency_provider=lambda: n,
            )
        )

        # Every section was invoked exactly once regardless of failures.
        assert sorted(invoked) == list(range(n))

        # Results are exactly the successes; errors are exactly the failures —
        # no single failure aborted the merge of the rest.
        assert set(results.keys()) == set(successes)
        assert set(errors.keys()) == set(failing)
        # Every non-failing section still produced a result.
        for i in successes:
            assert results[i] == _researcher_payload(i)

        # Fan-in: the merged document's questions are exactly the union of the
        # successful sections' entries, in section order.
        ordered_payloads = [results[i] for i in sorted(results)]
        merged = json.loads(oa._merge_research_findings(ordered_payloads))
        expected_questions = [{"question": f"q-{i}", "answer": f"a-{i}"} for i in sorted(successes)]
        assert merged["questions_researched"] == expected_questions
        assert merged["parallel_execution"]["workers"] == len(successes)
        assert merged["parallel_execution"]["questions_covered"] == len(successes)


# --- Property 15 ----------------------------------------------------------


class TestProperty15MissingConcurrencyFails:
    """Feature: a2a-agent-collaboration, Property 15: Missing concurrency fails
    rather than degrading to sequential."""

    @settings(max_examples=150, deadline=None)
    @given(n=st.integers(min_value=2, max_value=6), capacity=st.integers(min_value=0, max_value=1))
    def test_unavailable_primitive_raises_and_issues_zero_invocations(self, n: int, capacity: int) -> None:
        """Feature: a2a-agent-collaboration, Property 15: Missing concurrency
        fails rather than degrading to sequential.

        When the concurrency provider reports capacity < 2, the dispatcher
        raises `ConcurrencyUnavailableError` BEFORE any invocation is scheduled,
        so the fake `invoke_section` is never called (zero invocations) and the
        fan-out never runs the sections one at a time.
        """
        shards = _shards(n)
        invoked: list[int] = []

        async def invoke_section(shard: list[str], index: int) -> str:
            invoked.append(index)
            return _researcher_payload(index)

        with pytest.raises(ConcurrencyUnavailableError):
            _run(
                oa.dispatch_sections_concurrently(
                    shards,
                    invoke_section,
                    concurrency_provider=lambda: capacity,
                )
            )

        # Never degraded to sequential — zero invocations issued.
        assert invoked == []

    @settings(max_examples=150, deadline=None)
    @given(capacity=st.integers(min_value=0, max_value=1))
    def test_require_concurrency_rejects_insufficient_capacity(self, capacity: int) -> None:
        """Feature: a2a-agent-collaboration, Property 15: Missing concurrency
        fails rather than degrading to sequential (`require_concurrency` guard).

        Capacity 0 or 1 cannot overlap the minimum two invocations, so the guard
        raises rather than allowing a sequential fallback.
        """
        with pytest.raises(ConcurrencyUnavailableError):
            oa.require_concurrency(capacity)

    @settings(max_examples=150, deadline=None)
    @given(capacity=st.integers(min_value=2, max_value=64))
    def test_require_concurrency_accepts_sufficient_capacity(self, capacity: int) -> None:
        """Feature: a2a-agent-collaboration, Property 15: Missing concurrency
        fails rather than degrading to sequential (sufficient capacity is
        accepted).

        Capacity >= 2 can overlap the section invocations, so the guard permits
        the fan-out (returns None, raises nothing).
        """
        assert oa.require_concurrency(capacity) is None
