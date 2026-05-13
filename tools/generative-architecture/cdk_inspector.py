"""
CDK-side inspector for the research-agent project.

Reads `gartner-app-dev-research-agent/cdk.json` and returns feature flags +
model IDs that mirror the TypeScript logic in
`lib/common/feature-flags.ts`. The diagram generator uses the resolved
flags to decide which nodes/edges to render.

Resolution rules (match feature-flags.ts exactly):
    effective[key] = DEFAULT[key] if key missing, else cdk.json[key]

The `stage` argument is accepted for forward compatibility (the research
agent's cdk.json currently keeps a single `features` block rather than a
per-stage one). If the future adds `features.<stage>.*` blocks, this
module should read those too — see `_extract_features`.

CLI:
    python cdk_inspector.py                 # default: stage=dev, JSON output
    python cdk_inspector.py --stage prod
    python cdk_inspector.py --format table
    python cdk_inspector.py --cdk-json /path/to/cdk.json
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Defaults — MUST be kept in sync with lib/common/feature-flags.ts
# (the toolkit now lives inside the research-agent repo)
# ---------------------------------------------------------------------------


DEFAULT_FEATURES: dict[str, object] = {
    "avatar": True,
    "knowledge_base": True,
    "kb_backend": "s3-vectors",
    "neptune": False,
    "episodic_memory": True,
    "semantic_memory": True,
    "user_preference_memory": True,
    "agentcore_policy": False,
    "agentcore_evaluations": False,
    "server_side_tools": True,
    "durable_functions": False,
    "guardrails": True,
    "browser": True,
}


DEFAULT_MODELS: dict[str, str] = {
    "orchestrator": "us.anthropic.claude-sonnet-4-6",
    "avatar_sonic": "amazon.nova-2-sonic-v1:0",
    "avatar_tool_selector": "amazon.nova-2-lite-v1:0",
    "kb_embedding": "amazon.nova-2-multimodal-embeddings-v1:0",
}


# Toolkit now lives inside the research-agent repo at
# tools/generative-architecture/ — cdk.json is two levels up.
_DEFAULT_CDK_JSON = Path(__file__).resolve().parent.parent.parent / "cdk.json"


# ---------------------------------------------------------------------------
# Typed outputs
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FeatureFlags:
    avatar: bool
    knowledge_base: bool
    kb_backend: str
    neptune: bool
    episodic_memory: bool
    semantic_memory: bool
    user_preference_memory: bool
    agentcore_policy: bool
    agentcore_evaluations: bool
    server_side_tools: bool
    durable_functions: bool
    guardrails: bool
    browser: bool


@dataclass(frozen=True)
class ModelConfig:
    orchestrator: str
    avatar_sonic: str
    avatar_tool_selector: str
    kb_embedding: str


@dataclass(frozen=True)
class ResolvedContext:
    stage: str
    cdk_json_path: Path
    project_id: str
    stack_name_base: str
    account_id: str | None
    region: str | None
    features: FeatureFlags
    models: ModelConfig
    raw_overrides: dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "stage": self.stage,
            "cdk_json_path": str(self.cdk_json_path),
            "project_id": self.project_id,
            "stack_name_base": self.stack_name_base,
            "account_id": self.account_id,
            "region": self.region,
            "features": dataclasses.asdict(self.features),
            "models": dataclasses.asdict(self.models),
            "raw_overrides": self.raw_overrides,
        }


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _read_cdk_json(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"cdk.json not found at {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _extract_features(context: dict[str, object], stage: str) -> dict[str, object]:
    """Merge DEFAULT_FEATURES with cdk.json overrides.

    Accepts either shape in cdk.json:
      - Flat:    context.features = { avatar: true, ... }
      - Staged:  context.features = { dev: { avatar: true, ... }, prod: {...} }

    The research-agent today uses the flat shape; the staged shape is allowed
    for future-proofing so callers can pass --stage without code changes.
    """
    features = context.get("features", {}) or {}
    if not isinstance(features, dict):
        raise TypeError(f"cdk.json context.features must be an object, got {type(features).__name__}")

    # Detect staged shape: all values are dicts, none are leaf booleans.
    values = list(features.values())
    is_staged = bool(values) and all(isinstance(v, dict) for v in values)
    overrides = features.get(stage, {}) if is_staged else features

    merged = dict(DEFAULT_FEATURES)
    merged.update(overrides)
    return merged


def _extract_models(context: dict[str, object]) -> dict[str, str]:
    models = context.get("models", {}) or {}
    if not isinstance(models, dict):
        raise TypeError("cdk.json context.models must be an object")
    merged = dict(DEFAULT_MODELS)
    merged.update(models)
    return merged


def load_context(
    cdk_json_path: Path | str | None = None,
    stage: str = "dev",
) -> ResolvedContext:
    """Load and resolve the effective context for a given stage.

    Mirrors the resolution logic of `getFeatureFlags()` / `getModelConfig()`
    in lib/common/feature-flags.ts.
    """
    path = Path(cdk_json_path) if cdk_json_path else _DEFAULT_CDK_JSON
    path = path.expanduser().resolve()
    cdk = _read_cdk_json(path)
    context = cdk.get("context", {})
    if not isinstance(context, dict):
        raise TypeError("cdk.json must contain a top-level 'context' object")

    features_dict = _extract_features(context, stage)
    models_dict = _extract_models(context)

    # Pull accounts.<stage>.{id,region}
    accounts = context.get("accounts", {}) or {}
    account_info = accounts.get(stage, {}) if isinstance(accounts, dict) else {}
    account_id = str(account_info.get("id")) if isinstance(account_info, dict) and account_info.get("id") else None
    region = str(account_info.get("region")) if isinstance(account_info, dict) and account_info.get("region") else None

    stack_name_base = str(context.get("stackNameBase") or "")
    if not stack_name_base:
        raise ValueError("cdk.json context.stackNameBase is required")
    project_id = str(context.get("projectId") or "")

    try:
        features = FeatureFlags(**features_dict)  # type: ignore[arg-type]
    except TypeError as exc:
        extra = set(features_dict) - set(DEFAULT_FEATURES)
        missing = set(DEFAULT_FEATURES) - set(features_dict)
        raise TypeError(
            f"Could not build FeatureFlags from {features_dict!r}: {exc} (extra keys={extra}, missing keys={missing})"
        ) from exc

    models = ModelConfig(**models_dict)  # type: ignore[arg-type]

    raw_overrides = {
        "features": context.get("features", {}),
        "models": context.get("models", {}),
    }

    return ResolvedContext(
        stage=stage,
        cdk_json_path=path,
        project_id=project_id,
        stack_name_base=stack_name_base,
        account_id=account_id,
        region=region,
        features=features,
        models=models,
        raw_overrides=raw_overrides,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _format_table(ctx: ResolvedContext) -> str:
    lines: list[str] = []
    lines.append(f"stage           : {ctx.stage}")
    lines.append(f"cdk.json        : {ctx.cdk_json_path}")
    lines.append(f"projectId       : {ctx.project_id}")
    lines.append(f"stackNameBase   : {ctx.stack_name_base}")
    lines.append(f"accounts[{ctx.stage}].id     : {ctx.account_id or '(unset)'}")
    lines.append(f"accounts[{ctx.stage}].region : {ctx.region or '(unset)'}")
    lines.append("")
    lines.append("features:")
    flag_width = max(len(f.name) for f in dataclasses.fields(ctx.features))
    for f in dataclasses.fields(ctx.features):
        value = getattr(ctx.features, f.name)
        lines.append(f"  {f.name.ljust(flag_width)}  {value}")
    lines.append("")
    lines.append("models:")
    for f in dataclasses.fields(ctx.models):
        lines.append(f"  {f.name:22s}  {getattr(ctx.models, f.name)}")
    return "\n".join(lines)


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Resolve effective feature flags + models from cdk.json.",
    )
    parser.add_argument(
        "--cdk-json",
        default=str(_DEFAULT_CDK_JSON),
        help=(f"Path to cdk.json (default: {_DEFAULT_CDK_JSON})"),
    )
    parser.add_argument(
        "--stage",
        default="dev",
        help="Deployment stage name (default: dev). Used to pick accounts.<stage> and staged features.",
    )
    parser.add_argument(
        "--format",
        choices=("json", "table"),
        default="json",
        help="Output format (default: json).",
    )
    args = parser.parse_args(argv)

    try:
        ctx = load_context(args.cdk_json, args.stage)
    except (FileNotFoundError, TypeError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.format == "json":
        print(json.dumps(ctx.to_dict(), indent=2, default=str))
    else:
        print(_format_table(ctx))
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(_main(sys.argv[1:]))
