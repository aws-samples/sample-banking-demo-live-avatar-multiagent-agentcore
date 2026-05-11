# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
KB Auto-Ingestion Lambda — triggered by S3 ObjectCreated events on reportsBucket.

Copies generated PDFs to kbDocsBucket under `generated/` prefix with S3 object tags
(source=generated, generated_date, pipeline), then starts a Bedrock KB ingestion job.

Also writes a `.metadata.json` sidecar for each PDF so Bedrock KB can filter by user_id.

Fail-closed contract (see docs/kb-isolation.md):
  * Every ingested record MUST carry a `user_id` metadata value from the source
    object. Missing user_id → hard reject (no copy, no sidecar, no ingestion job).
  * Every ingested record MUST resolve to a known pipeline tag
    ({bistro_research, open_research, menu}). Unknown keys or prefixes → hard
    reject. The legacy `research` alias is preserved (maps to bistro_research).

The goal is that every document in the KB has both sidecar attributes set,
closing the historical leak where S3 Vectors treats missing-metadata docs as
pass-through across every filter.
"""

import json
import logging
import os
import urllib.parse
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
bedrock_agent = boto3.client("bedrock-agent")

KB_DOCS_BUCKET = os.environ["KB_DOCS_BUCKET"]
KNOWLEDGE_BASE_ID = os.environ["KNOWLEDGE_BASE_ID"]
DATA_SOURCE_ID = os.environ["DATA_SOURCE_ID"]


# Allowed logical pipelines — must stay in sync with pdf_generator / kb_search / orchestrator.
VALID_PIPELINES = {"bistro_research", "open_research", "menu"}

# Legacy alias: the previous iteration tagged everything in reports/ as "research".
# Migrate those to "bistro_research" since the original flow (the Bistro Deep Dive
# pipeline) was the only research writer at the time.
LEGACY_PIPELINE_ALIASES = {"research": "bistro_research"}


class PipelineResolutionError(ValueError):
    """Raised when the source object's metadata + key cannot resolve to a
    known pipeline. Lets the handler refuse the ingest instead of writing
    an "unknown"-tagged sidecar that would leak across filters."""


def _resolve_pipeline(src_key: str, source_metadata: dict | None) -> str:
    """Determine the pipeline tag for a newly uploaded PDF.

    Resolution order (fail-closed):
      1. Source object's `pipeline` S3 metadata (set by pdf_generator).
         Legacy value `research` is mapped to `bistro_research`.
      2. Prefix-based inference: `reports/` -> `bistro_research`,
         `menus/` -> `menu`.
      3. Otherwise: raise PipelineResolutionError. Callers MUST handle.

    The previous iteration had an "unknown" fallback that silently tagged
    mismatched uploads as `pipeline=unknown`. Those docs would fail every
    filter AND could surface in unfiltered reads via archive_chat, so we
    refuse to ingest them at all. See docs/kb-isolation.md.
    """
    meta = source_metadata or {}
    raw = (meta.get("pipeline") or "").strip().lower()
    raw = LEGACY_PIPELINE_ALIASES.get(raw, raw)
    if raw in VALID_PIPELINES:
        return raw

    key_lower = src_key.lower()
    if key_lower.startswith("reports/"):
        return "bistro_research"
    if key_lower.startswith("menus/"):
        return "menu"

    raise PipelineResolutionError(
        f"Cannot resolve pipeline for key={src_key!r} metadata_pipeline={meta.get('pipeline')!r}. "
        "Expected reports/ or menus/ prefix or an explicit pipeline metadata tag."
    )


def _require_user_id(source_metadata: dict | None) -> str:
    """Return the user_id from source metadata or raise ValueError.

    The historical bug was that we silently wrote sidecars without user_id
    when head_object failed, producing docs that S3 Vectors treats as
    pass-through across every filter — a tenant-isolation leak. The
    handler now refuses those ingests so the S3 event retries and an
    operator can investigate.
    """
    meta = source_metadata or {}
    user_id = (meta.get("user_id") or "").strip()
    if not user_id:
        raise ValueError(
            "Source object missing `user_id` metadata. Refusing ingest to preserve tenant isolation. "
            "Fix the producer (pdf_generator or external upload) to set the S3 metadata field."
        )
    return user_id


def handler(event, context):
    """Process S3 ObjectCreated events: copy to KB bucket + start ingestion.

    Refuses records that lack user_id metadata or don't resolve to a known
    pipeline. Refused records raise — the S3 event source will retry, and
    a CloudWatch log line names the offending key so operators can triage.
    """
    logger.info("KB ingest triggered with %d record(s)", len(event.get("Records", [])))

    any_success = False
    errors: list[dict] = []

    for record in event.get("Records", []):
        src_bucket = record["s3"]["bucket"]["name"]
        src_key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])

        # Skip non-PDF files (safety check — S3 filter should already handle this)
        if not src_key.lower().endswith(".pdf"):
            logger.info("Skipping non-PDF: %s", src_key)
            continue

        # Read source object metadata up-front. Any failure here is fatal
        # to this record — we cannot determine user_id or pipeline without
        # the head_object response, so fail closed rather than write a
        # partially-tagged sidecar.
        try:
            head = s3.head_object(Bucket=src_bucket, Key=src_key)
        except Exception as e:
            logger.error("kb_ingest: head_object failed for s3://%s/%s: %s", src_bucket, src_key, e)
            errors.append({"key": src_key, "error": "head_object_failed"})
            continue

        source_metadata = head.get("Metadata", {}) or {}

        try:
            user_id = _require_user_id(source_metadata)
            pipeline = _resolve_pipeline(src_key, source_metadata)
        except (ValueError, PipelineResolutionError) as e:
            logger.error("kb_ingest: refusing s3://%s/%s — %s", src_bucket, src_key, e)
            errors.append({"key": src_key, "error": str(e)})
            continue

        dest_key = f"generated/{src_key}"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        tagging = f"source=generated&generated_date={today}&pipeline={pipeline}"

        logger.info(
            "Copying s3://%s/%s → s3://%s/%s (tags: %s, user_id: %s)",
            src_bucket,
            src_key,
            KB_DOCS_BUCKET,
            dest_key,
            tagging,
            user_id,
        )

        s3.copy_object(
            CopySource={"Bucket": src_bucket, "Key": src_key},
            Bucket=KB_DOCS_BUCKET,
            Key=dest_key,
            Tagging=tagging,
            TaggingDirective="REPLACE",
        )

        # Write .metadata.json sidecar so Bedrock KB indexes both `user_id`
        # and `pipeline` as filterable attributes.
        metadata_attrs = {
            "source": "generated",
            "pipeline": pipeline,
            "user_id": user_id,
        }
        sidecar_key = dest_key + ".metadata.json"
        s3.put_object(
            Bucket=KB_DOCS_BUCKET,
            Key=sidecar_key,
            Body=json.dumps({"metadataAttributes": metadata_attrs}),
            ContentType="application/json",
        )
        logger.info("Wrote metadata sidecar: s3://%s/%s", KB_DOCS_BUCKET, sidecar_key)
        any_success = True

    # Only kick off ingestion if at least one record was accepted. If every
    # record was refused, we return a non-2xx-equivalent structure so the S3
    # event source surfaces the failure — retries are controlled by the event
    # source mapping, not this Lambda.
    if not any_success:
        logger.warning("kb_ingest: no records accepted; skipping StartIngestionJob. errors=%s", errors)
        return {"statusCode": 400, "errors": errors}

    response = bedrock_agent.start_ingestion_job(
        knowledgeBaseId=KNOWLEDGE_BASE_ID,
        dataSourceId=DATA_SOURCE_ID,
    )

    job_id = response["ingestionJob"]["ingestionJobId"]
    logger.info(
        "Started KB ingestion job %s for KB %s / DS %s (accepted=%d, refused=%d)",
        job_id,
        KNOWLEDGE_BASE_ID,
        DATA_SOURCE_ID,
        1 if any_success else 0,  # per-record accepted count is above in the loop's logs
        len(errors),
    )

    return {"statusCode": 200, "ingestionJobId": job_id, "errors": errors}


# ── Smoke test ────────────────────────────────────────────────────────────
# Run directly (`python handler.py`) to verify pipeline resolution without hitting AWS.
if __name__ == "__main__":
    cases = [
        # (src_key, metadata, expected_pipeline_or_exc)
        ("reports/foo.pdf", {"pipeline": "bistro_research"}, "bistro_research"),
        ("reports/foo.pdf", {"pipeline": "open_research"}, "open_research"),
        ("menus/foo.pdf", {"pipeline": "menu"}, "menu"),
        ("reports/foo.pdf", {"pipeline": "research"}, "bistro_research"),  # legacy alias
        ("reports/foo.pdf", {}, "bistro_research"),  # fallback to prefix
        ("menus/foo.pdf", {}, "menu"),  # fallback to prefix
        ("other/foo.pdf", {}, PipelineResolutionError),
        ("reports/foo.pdf", {"pipeline": "bogus"}, "bistro_research"),  # bad value -> prefix fallback
        ("reports/foo.pdf", None, "bistro_research"),
        ("elsewhere/foo.pdf", {"pipeline": "bogus"}, PipelineResolutionError),
    ]
    for src_key, meta, expected in cases:
        try:
            actual = _resolve_pipeline(src_key, meta)
            ok = actual == expected
        except PipelineResolutionError:
            actual = PipelineResolutionError
            ok = expected is PipelineResolutionError
        status = "OK " if ok else "FAIL"
        print(f"{status}  key={src_key!r:30s} meta={str(meta):40s} -> {actual!r} (expected {expected!r})")

    # user_id gate
    print("\n_require_user_id:")
    try:
        _require_user_id({})
        print("FAIL missing user_id did not raise")
    except ValueError:
        print("OK   missing user_id raised ValueError")
    assert _require_user_id({"user_id": "alice"}) == "alice"
    print("OK   user_id='alice' returned")
