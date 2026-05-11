# Knowledge Base Isolation — Invariants, Threat Model, and Runbook

The demo advertises three logical Knowledge Base views (`bistro_research`,
`open_research`, `menu`) sharing a single physical S3-Vectors-backed Bedrock
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
      `{bistro_research, open_research, menu}` (legacy `research` is
      aliased to `bistro_research`).

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
to call `gateway_kb_search(user_id="root", pipelines=["menu"])`, the hook
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

| Mode                                            | Writes            | Reads                                               | Archive |
| ----------------------------------------------- | ----------------- | --------------------------------------------------- | ------- |
| `research` / `research_execute`                 | `bistro_research` | `bistro_research`                                   | no      |
| `generic_research` / `generic_research_execute` | `open_research`   | `open_research`                                     | no      |
| `menu`                                          | `menu`            | `bistro_research`, `open_research`                  | no      |
| `chatbot` (AI Concierge)                        | —                 | `menu`                                              | no      |
| `archive_chat` (Report Archive)                 | —                 | _(all, scoped to user_id)_                          | YES     |
| Voice Avatar                                    | —                 | user's multi-select, expanded to all three on empty | no      |

Any mode that falls through to the default (unknown mode string) becomes
`{write: None, read_filter: None, archive: False}`, which forces kb_search
into the fail-closed path. The orchestrator should never pass an unknown
mode — if you see `caller-scope-required` in kb_search logs alongside a
known route, check that the call site passes a concrete `mode=...` to
`_run_plan_only` / `_run_pipeline`.

## Regression tests

See `test/python/test_kb_search_filter.py`, `test_kb_ingest_resolve.py`,
and `test_pipeline_scope.py`. Run `npm run test:python` to execute.
