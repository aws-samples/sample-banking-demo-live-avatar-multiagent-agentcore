"""
Icon manifest for the architecture diagram generator.

Resolves logical component names -> icon sources. Two output forms:

1. Custom SVG/PNG icons already shipped in the toolkit's `icons/` folder. These
   render via `diagrams.custom.Custom("Label", "icons/foo.png")` and are
   emitted into the gen_arch.py `nodes` string as `Custom:icons/foo.png`.

2. Stock `diagrams.aws.*` classes for generic AWS services (Cognito, Lambda,
   DynamoDB, S3, CloudFront, WAF, etc.). These are emitted as the bare class
   name (e.g. `Lambda`) which Claude knows how to import via
   `import_statements.py`.

Preference order (per plan Task 2):
    1. AgentCore-specific logical names → existing custom icons (no newer
       AWS-official AgentCore icon set is published as of May 2026; the
       existing pack was confirmed comprehensive by the icon_research subagent).
    2. Generic AWS services → stock diagrams classes.

Running this module directly prints the full mapping for quick inspection:
    python icon_manifest.py --list
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

ICONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")


@dataclass(frozen=True)
class IconEntry:
    """A resolved icon reference for a logical component name.

    Exactly one of `custom_path` or `stock_class` is populated.
    """

    logical_name: str
    custom_path: str | None = None  # e.g. "icons/Runtime.png"
    stock_class: str | None = None  # e.g. "Cognito" (from diagrams.aws.security)
    stock_module: str | None = None  # e.g. "diagrams.aws.security"

    def is_custom(self) -> bool:
        return self.custom_path is not None

    def node_type_token(self) -> str:
        """Return the token used in gen_arch.py `nodes` strings.

        - Custom icons: "Custom:icons/foo.png"
        - Stock classes: the class name only (e.g. "Cognito") — the prompt +
          import_statements.py teach Claude which module to import it from.
        """
        if self.custom_path is not None:
            return f"Custom:{self.custom_path}"
        assert self.stock_class is not None
        return self.stock_class


# ---------------------------------------------------------------------------
# Logical name -> icon resolution table
#
# Populated from the icon_research subagent's recommendation (2026-05-05).
# All `Custom:icons/*.png` entries are verified to exist on disk — see the
# `_verify_custom_icons()` call at module load.
# ---------------------------------------------------------------------------

_MANIFEST: dict[str, IconEntry] = {
    # AgentCore primitives — custom icons shipped with the toolkit.
    # `agentcore` uses the Jan 30 2026 refresh from the AWS icon pack
    # (extracted via tools/generative-architecture/refresh_icons.py).
    "agentcore": IconEntry("agentcore", custom_path="icons/AgentCore_2026.png"),
    "runtime": IconEntry("runtime", custom_path="icons/Runtime.png"),
    "gateway": IconEntry("gateway", custom_path="icons/Gateway.png"),
    "memory": IconEntry("memory", custom_path="icons/Memory.png"),
    "guardrails": IconEntry(
        "guardrails",
        custom_path="icons/Policy_Engine_Agentic_Guardrails.png",
    ),
    "browser_tool": IconEntry("browser_tool", custom_path="icons/Browser_Tool.png"),
    "code_interpreter": IconEntry(
        "code_interpreter",
        custom_path="icons/Code_Interpreter.png",
    ),
    "identity": IconEntry("identity", custom_path="icons/Identity.png"),
    "observability": IconEntry("observability", custom_path="icons/Observability.png"),
    "evaluations": IconEntry("evaluations", custom_path="icons/Evaluations.png"),
    "ai_agent": IconEntry("ai_agent", custom_path="icons/AI_Agent.png"),
    # Strands Agents twin-strand mark on black — used for every genuine
    # `strands.Agent()` / `BidiAgent` / built-in tool-selector instance.
    "strands_agent": IconEntry(
        "strands_agent",
        custom_path="icons/Strands_Agent.png",
    ),
    # Generic AWS services — stock diagrams classes
    # Module paths match `import_statements.py` / `diagrams_class_list.py`.
    "cognito": IconEntry(
        "cognito",
        stock_class="Cognito",
        stock_module="diagrams.aws.security",
    ),
    "lambda": IconEntry(
        "lambda",
        stock_class="Lambda",
        stock_module="diagrams.aws.compute",
    ),
    "dynamodb": IconEntry(
        "dynamodb",
        stock_class="Dynamodb",
        stock_module="diagrams.aws.database",
    ),
    "s3": IconEntry(
        "s3",
        stock_class="SimpleStorageServiceS3",
        stock_module="diagrams.aws.storage",
    ),
    # The installed `diagrams` release ships a first-party Bedrock icon, so the
    # old Sagemaker stand-in is no longer needed (and was misleading — it drew
    # a SageMaker glyph for Bedrock foundation models).
    "bedrock": IconEntry(
        "bedrock",
        stock_class="Bedrock",
        stock_module="diagrams.aws.ml",
    ),
    "knowledge_base": IconEntry(
        "knowledge_base",
        stock_class="Bedrock",
        stock_module="diagrams.aws.ml",
    ),
    "cloudfront": IconEntry(
        "cloudfront",
        stock_class="CloudFront",
        stock_module="diagrams.aws.network",
    ),
    "waf": IconEntry(
        "waf",
        stock_class="WAF",
        stock_module="diagrams.aws.security",
    ),
    "cloudwatch": IconEntry(
        "cloudwatch",
        stock_class="Cloudwatch",
        stock_module="diagrams.aws.management",
    ),
    "api_gateway": IconEntry(
        "api_gateway",
        stock_class="APIGateway",
        stock_module="diagrams.aws.network",
    ),
    "secrets_manager": IconEntry(
        "secrets_manager",
        stock_class="SecretsManager",
        stock_module="diagrams.aws.security",
    ),
    "codebuild": IconEntry(
        "codebuild",
        stock_class="Codebuild",
        stock_module="diagrams.aws.devtools",
    ),
    "neptune": IconEntry(
        "neptune",
        stock_class="Neptune",
        stock_module="diagrams.aws.database",
    ),
    "user": IconEntry(
        "user",
        stock_class="User",
        stock_module="diagrams.aws.general",
    ),
    # Client/browser glyph — reuse Browser_Tool custom icon for "user device"
    # when the generic User glyph doesn't fit the visual language of the
    # reference PNG. Prefer `user` unless the caller explicitly asks.
    "client_browser": IconEntry(
        "client_browser",
        custom_path="icons/Browser_Tool.png",
    ),
}


def _verify_custom_icons() -> None:
    """Fail fast if any custom icon path is missing on disk."""
    missing: list[str] = []
    for entry in _MANIFEST.values():
        if entry.custom_path is None:
            continue
        absolute = os.path.join(os.path.dirname(ICONS_DIR), entry.custom_path)
        if not os.path.isfile(absolute):
            missing.append(f"{entry.logical_name} -> {entry.custom_path}")
    if missing:
        raise FileNotFoundError("Icon manifest references files that do not exist on disk:\n  " + "\n  ".join(missing))


_verify_custom_icons()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve(logical_name: str) -> IconEntry:
    """Look up an icon by logical name.

    Raises KeyError with a helpful hint if the name is not in the manifest,
    so the caller gets a clear error instead of a silent fallback.
    """
    try:
        return _MANIFEST[logical_name]
    except KeyError as exc:
        known = ", ".join(sorted(_MANIFEST))
        raise KeyError(f"Unknown logical icon name {logical_name!r}. Known names: {known}") from exc


def node_token(logical_name: str) -> str:
    """Shorthand for `resolve(name).node_type_token()`."""
    return resolve(logical_name).node_type_token()


def all_entries() -> dict[str, IconEntry]:
    """Return a copy of the full mapping for introspection/tests."""
    return dict(_MANIFEST)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Inspect the icon manifest used by the diagram generator.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print all logical names and their resolved icon tokens.",
    )
    parser.add_argument(
        "--name",
        metavar="LOGICAL_NAME",
        help="Resolve a single logical name and print its token.",
    )
    args = parser.parse_args(argv)

    if args.name:
        entry = resolve(args.name)
        print(entry.node_type_token())
        return 0

    if args.list or argv is None:  # default: list when no args
        # Pretty-print aligned table
        name_width = max(len(n) for n in _MANIFEST)
        print(f"{'logical name'.ljust(name_width)}  source")
        print(f"{'-' * name_width}  {'-' * 40}")
        for name in sorted(_MANIFEST):
            entry = _MANIFEST[name]
            if entry.is_custom():
                source = f"custom: {entry.custom_path}"
            else:
                source = f"stock:  {entry.stock_module}.{entry.stock_class}"
            print(f"{name.ljust(name_width)}  {source}")
        print()
        print(f"Total: {len(_MANIFEST)} entries")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(_main(sys.argv[1:]))
