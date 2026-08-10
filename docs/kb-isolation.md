# Knowledge Base Isolation — Invariants, Threat Model, and Runbook

> **⚠️ One-time migration required: `report_id` run pinning**
>
> The AI Assistant is now pinned to a single deep-research run so its catalog
> cannot be grounded in a semantic blend of every past run (two runs can
> recommend contradictory rates; mixing them produced a catalog that read as one
> coherent report but was not).
>
> Pinning works by a new `report_id` metadata attribute, written by
> `pdf_generator` into the PDF's S3 metadata and copied by `kb_ingest` into the
> `.metadata.json` sidecar.
>
> **Documents ingested before this change carry no `report_id`.** Because S3
> Vectors only evaluates a filter clause against documents that *have* the key,
> those documents **pass** a `report_id` filter rather than being excluded by it
> — exactly the pass-through behaviour described in the threat model below. Until
> they are re-ingested, older runs can still bleed into the catalog.
>
> **Runbook — run once after deploying this change:**
>
> 1. Confirm the current reports are expendable (all demo data is synthetic).
> 2. Reset the Knowledge Base via the in-app control, or
>    `POST {FEEDBACK_API_URL}kb-reset` with a Cognito bearer token.
> 3. Re-run the Deep Research Agent. The new PDF is stamped with a `report_id`,
>    and every subsequent run is pinnable.
>
> `kb_ingest` logs a warning naming any object it ingests without a
> `report_id`, so a missed migration is visible in CloudWatch rather than silent.

The demo advertises three logical Knowledge Base views (`strategy_research`,
`market_research`, `services`) sharing a single physical S3-Vectors-backed Bedrock
Knowledge Base, with per-user tenant isolation layered on top. That
guarantee is only as strong as the enforcement points below — this doc is
the single source of truth for them.

## Invariants

1. **Every ingested document carries both `user_id` and `pipeline`
   metadata.** Enforced at write time by `gateway/tools/kb_ingest/handler.py`:
    - `_require_user_id()` rejects any S3 record whose source object has no
      `user_id` metadata. The S3 event source retries the record and a
      CloudWatch log line names the offending key.
    - `_resolve_pipeline()` raises `PipelineResolutionError` if the source
      key doesn't match a recognized prefix (`reports/` or `menus/`) AND
      the source metadata's `pipeline` value isn't one of
      `{strategy_research, market_research, services}` (legacy `research` is
      aliased to `strategy_research`). The `menus/` prefix resolves to the
      `services` pipeline.

2. **Every kb_search call must be scoped.** Enforced at read time by
   `gateway/tools/kb_search/handler.py`. The handler entrypoint refuses any
   call that lacks a `user_id`, and refuses any call that lacks `pipelines`
   unless `archive_mode=True` is set. Refused calls return
   `{"results": [], "reason": "caller-scope-required"}` — no Bedrock round-trip
   and no information leak.

3. **Scope is populated by the runtime, not the LLM.** Enforced in-process
   by two Strands `BeforeToolCallEvent` hooks:
    - `UserScopeHook` (`patterns/utils/tool_guard.py`) overwrites
      `tool_input["user_id"]` with the verified JWT `sub` claim for every
      tool in `USER_SCOPED_TOOLS`. Any value the LLM supplies is
      discarded with a warning.
    - `PipelineScopeHook` (`patterns/utils/pipeline_scope.py`) looks up
      the current mode in `MODE_PIPELINE_CONFIG` and injects the
      corresponding `pipelines` list. Archive mode is the one opt-in to
      unfiltered reads: the hook sets `archive_mode=True` only when its
      constructor received `is_archive=True`, which only happens for
      `mode="archive_chat"`.

Together these three invariants mean: even if the LLM is prompt-injected
to call `gateway_kb_search(user_id="root", pipelines=["services"])`, the hook
overwrites both values before the tool runs.

## Threat Model

| Threat                                                                     | Control                                                                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM spoofs `user_id` to read another tenant's docs                         | `UserScopeHook` overwrites on every tool call                                                                                                                         |
| LLM selects the wrong pipeline to exfiltrate cross-flow content            | `PipelineScopeHook` overwrites on every tool call                                                                                                                     |
| Missing metadata doc surfaces under every filter (S3 Vectors pass-through) | Ingest fails closed on missing `user_id`. Pre-existing untagged docs remain an operator responsibility — see Runbook below.                                           |
| Archive mode abused by LLM to escape pipeline scope                        | Archive is signalled by a positive `archive_mode=True` flag the hook sets, not by the LLM. The `is_archive` constructor flag on `PipelineScopeHook` is the only path. |
| Avatar runtime (WebSocket) bypasses tenant scoping                         | Task 4: `UserScopeHook` is attached with the JWT `sub` from the signed handshake. Without the `id_token` query param the handshake is refused.                        |

## Known remaining gap

S3 Vectors evaluates filter clauses only against documents that actually
have the metadata key present. Documents ingested before the fail-closed
ingest shipped, or uploaded directly to the kb-docs bucket by hand, may
have no `user_id` sidecar — those docs pass every filter and surface for
every tenant.

**Mitigation runbook:**

1. Enumerate docs with missing sidecars:
    ```bash
    aws s3 ls --recursive s3://${STACK_NAME}-kb-docs-${ACCOUNT_ID}/generated/ \
      | awk '{print $4}' \
      | grep -v '.metadata.json$' \
      | while read key; do
          sidecar="${key}.metadata.json"
          aws s3api head-object --bucket ${STACK_NAME}-kb-docs-${ACCOUNT_ID} \
            --key "$sidecar" 2>/dev/null || echo "MISSING: $key"
        done
    ```
2. For each missing sidecar: either (a) delete the source doc from the KB
   bucket and re-run the pipeline that produced it, which will now write
   a correctly-scoped sidecar; or (b) write a sidecar by hand if you know
   the correct `user_id` + `pipeline`.
3. After any manual fix, call `POST /kb-reset` (the admin REST endpoint)
   to restart ingestion. Bedrock will re-index every doc including the
   newly-tagged sidecars.

## Mode → pipeline map

| Mode                                            | Writes              | Reads                                               | Archive |
| ----------------------------------------------- | ------------------- | --------------------------------------------------- | ------- |
| `research` / `research_execute`                 | `strategy_research` | `strategy_research`                                 | no      |
| `generic_research` / `generic_research_execute` | `market_research`   | `market_research`                                   | no      |
| `menu` (Services Catalog)                       | `services`          | `strategy_research`, `market_research`              | no      |
| `chatbot` (Client Advisor)                      | —                   | `services`                                          | no      |
| `archive_chat` (Report Archive)                 | —                   | _(all, scoped to user_id)_                          | YES     |
| Voice Avatar                                    | —                   | user's multi-select, expanded to all three on empty | no      |

Any mode that falls through to the default (unknown mode string) becomes
`{write: None, read_filter: None, archive: False}`, which forces kb_search
into the fail-closed path. The orchestrator should never pass an unknown
mode — if you see `caller-scope-required` in kb_search logs alongside a
known route, check that the call site passes a concrete `mode=...` to
`_run_plan_only` / `_run_pipeline`.

## Regression tests

See `test/python/test_kb_search_filter.py`, `test_kb_ingest_resolve.py`,
and `test_pipeline_scope.py`. Run `npm run test:python` to execute.
