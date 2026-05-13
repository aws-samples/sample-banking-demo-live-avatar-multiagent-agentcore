"""
Architecture diagram generator.

Usage:
    python gen_arch.py                                   # legacy target: agentcore-2026
    python gen_arch.py --target agentcore-2026           # explicit, same as above
    python gen_arch.py --target research-agent           # dev-stage research-agent spec
    python gen_arch.py --target research-agent --stage prod
    python gen_arch.py --target research-agent --output-dir /tmp/debug

Pipeline:
    spec = build_spec(target, stage)          # title/clusters/nodes/edges/extra_prompt
    prompt = build_prompt(spec)
    for attempt in range(MAX_ATTEMPTS):
        code = extract_code(ask_claude(prompt))
        stderr = run_subprocess(code)
        if not stderr:
            publish(spec, target)              # rename + copy to both destinations
            break
        prompt = retry_prompt(spec, code, stderr)

Publishing happens only when the target has a `copy_to` in constants.TARGETS.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from bedrock import ask_claude
from constants import (
    CODE_EXECUTION_TIMEOUT,
    DIAGRAM_DIRECTION,
    DIAGRAM_DPI,
    DIAGRAM_SPLINES,
    MAX_ATTEMPTS,
    OUTPUT_CODE_FILE,
    OUTPUT_SEPARATOR,
    TARGETS,
)
from import_statements import diagrams_imports
from research_agent_config import ArchitectureSpec

HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Spec loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RunConfig:
    """Resolved per-run configuration: which spec, where to write output."""

    target: str
    stage: str
    spec: ArchitectureSpec
    output_dir: Path
    output_filename: str  # the .png name inside output_dir
    copy_to: Path | None  # absolute destination or None to skip
    snapshot_pattern: str | None  # path pattern with {ts} or None to skip


def load_run_config(
    target: str,
    stage: str,
    output_dir_override: str | None,
) -> RunConfig:
    if target not in TARGETS:
        known = ", ".join(sorted(TARGETS))
        raise SystemExit(f"Unknown --target {target!r}. Known targets: {known}")

    target_cfg = TARGETS[target]
    output_dir = Path(output_dir_override).expanduser().resolve() if output_dir_override else HERE

    if target == "agentcore-2026":
        from specs import agentcore_2026

        spec = agentcore_2026.build()
    elif target == "research-agent":
        from cdk_inspector import load_context
        from research_agent_config import build as build_research_spec

        ctx = load_context(stage=stage)
        spec = build_research_spec(ctx)
    else:
        # Defensive — new targets must also wire their builder here.
        raise SystemExit(f"No spec builder wired for target {target!r}")

    copy_to = target_cfg.get("copy_to")
    copy_to_path = (HERE / copy_to).resolve() if copy_to else None

    return RunConfig(
        target=target,
        stage=stage,
        spec=spec,
        output_dir=output_dir,
        output_filename=target_cfg["output_filename"],
        copy_to=copy_to_path,
        snapshot_pattern=target_cfg.get("snapshot_pattern"),
    )


# ---------------------------------------------------------------------------
# Validation (kept identical to the pre-refactor behavior)
# ---------------------------------------------------------------------------


def validate_spec(spec: ArchitectureSpec) -> tuple[bool, str | None]:
    errors: list[str] = []
    if not spec.title.strip():
        errors.append("Title cannot be empty")
    if not spec.nodes.strip():
        errors.append("Nodes definition cannot be empty")
    if not spec.edges.strip():
        errors.append("Edges definition cannot be empty")

    # Node format sanity
    for line in (ln.strip() for ln in spec.nodes.strip().split("\n") if ln.strip()):
        if " " not in line:
            errors.append(f"Invalid node format: '{line}' (should be 'Type Alias-Name')")
            break

    # Edge format sanity
    for line in (ln.strip() for ln in spec.edges.strip().split("\n") if ln.strip()):
        if "points to" not in line.lower():
            errors.append(f"Invalid edge format: '{line}' (should contain 'points to')")
            break

    if errors:
        return False, "\n".join(f"  - {e}" for e in errors)
    return True, None


# ---------------------------------------------------------------------------
# Prompt building
# ---------------------------------------------------------------------------


def _example_snippet() -> str:
    return """
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb, Neptune
from diagrams.aws.storage import SimpleStorageServiceS3
from diagrams.aws.ml import Sagemaker
from diagrams.custom import Custom

with Diagram("AWS Architecture", show=False, direction="LR", graph_attr={"dpi": "200"}):
    with Cluster("Frontend", graph_attr={"bgcolor": "#EEF5FF", "pencolor": "#3B82F6", "penwidth": "2", "style": "filled"}):
        user = Custom("User", "icons/Browser_Tool.png")

    with Cluster("Backend", graph_attr={"bgcolor": "#F0FDF4", "pencolor": "#01A88D", "penwidth": "3", "style": "filled"}):
        runtime = Custom("Runtime", "icons/Runtime.png")
        gw = Custom("Gateway", "icons/Gateway.png")
        lam = Lambda("Tools")

    user >> Edge(color="#3B82F6", style="bold", penwidth="2") >> runtime
    runtime >> Edge(color="#01A88D") >> gw
    gw >> Edge(color="#EC4899") >> lam
"""


def build_prompt(spec: ArchitectureSpec) -> str:
    extra_block = ""
    if spec.extra_prompt.strip():
        extra_block = f"\nTARGET-SPECIFIC EXTRA INSTRUCTIONS (follow these literally):\n{spec.extra_prompt}\n"

    return f"""
You are an expert Python developer specializing in AWS architecture diagrams using the diagrams library.

Generate valid, executable Python code using the diagrams library to create a horizontal (left-to-right) AWS architecture diagram with VPC-style colored cluster borders and custom SVG icons.

REQUIREMENTS:
1. Title: <title>{spec.title}</title>
2. Clusters (with styling): <clusters>{spec.clusters}</clusters>
3. Nodes (ONLY these nodes): <nodes>{spec.nodes}</nodes>
4. Edges (ONLY these connections with styling): <edges>{spec.edges}</edges>

CRITICAL RULES:
- Use EXACTLY the nodes listed in <nodes></nodes> - no additions, no omissions
- Use EXACTLY the edges listed in <edges></edges> - no additions, no omissions
- Set direction="{DIAGRAM_DIRECTION}" for horizontal left-to-right layout
- Set graph_attr={{"rankdir": "{DIAGRAM_DIRECTION}", "splines": "{DIAGRAM_SPLINES}", "dpi": "{DIAGRAM_DPI}"}}
- Use show=False to generate PNG file

NESTED CLUSTERS:
- A Cluster definition may include `parent=<Parent Cluster Name>` in its attribute list.
- When you see `parent=...`, you MUST render that cluster as a nested `with Cluster(...)` block INSIDE the named parent's `with` block in the generated code, not as a sibling.
- Inner clusters should NOT repeat parent attributes they inherit (bgcolor/pencolor/style); but they may still override them.

CUSTOM ICON NODES:
- Nodes starting with "Custom:" use custom SVG icons via: from diagrams.custom import Custom
- Format in nodes list: "Custom:path/to/icon.png Alias-Name"
- In code: variable = Custom("Display Name", "path/to/icon.png")
- The SVG icon path is relative to the script's working directory
- Example: "Custom:icons/Runtime.png 4-Orchestrator" becomes: orchestrator = Custom("Orchestrator", "icons/Runtime.png")

STANDARD NODES:
- Nodes NOT starting with "Custom:" use standard diagrams library classes
- For Bedrock/Nova models, use: from diagrams.aws.ml import Sagemaker
- For Lambda, use: from diagrams.aws.compute import Lambda
- For databases, use: from diagrams.aws.database import Dynamodb, Neptune
- For storage, use: from diagrams.aws.storage import SimpleStorageServiceS3

CLUSTER STYLING:
- Parse the parenthetical attributes from each Cluster definition
- Use them as graph_attr dict: Cluster("Name", graph_attr={{"bgcolor": "#HEX", "pencolor": "#HEX", "penwidth": "N", "style": "filled"}})
- The `parent=` attribute is a NESTING HINT — do NOT put it into graph_attr.
- All values in graph_attr must be strings

EDGE STYLING:
- Parse the parenthetical attributes from each edge definition
- Use Edge() with keyword arguments: Edge(color="#HEX", style="bold", penwidth="2")
- from diagrams import Edge
- Example: node1 >> Edge(color="#3B82F6", style="bold", penwidth="2") >> node2
- All Edge keyword values must be strings
{extra_block}
EXAMPLE STRUCTURE:
<example>
{_example_snippet()}
</example>

AVAILABLE IMPORTS:
<imports>
{diagrams_imports}
</imports>

OUTPUT FORMAT:
Return ONLY valid Python code between <code></code> tags.
No explanations, no markdown, no preamble - ONLY the Python code.

The code must:
1. Import all necessary modules including: from diagrams import Cluster, Diagram, Edge
2. Import: from diagrams.custom import Custom
3. Create the Diagram with correct title and layout settings
4. Define all clusters with their graph_attr styling (honor `parent=` nesting)
5. Create all nodes — Custom() for custom icons, standard classes for others
6. Connect nodes using Edge() objects with color/style/penwidth from the edges specification
7. Generate a horizontal (left-to-right) layout

<code>
[Your Python code here]
</code>
"""


def build_retry_prompt(
    spec: ArchitectureSpec,
    previous_code: str,
    stderr: str,
) -> str:
    return f"""
The following Python code produced an error. Please fix it and return ONLY the corrected code between <code></code> tags.

ORIGINAL CODE:
<code>{previous_code}</code>

ERROR:
<error>{stderr}</error>

REQUIREMENTS (DO NOT CHANGE):
- Title: {spec.title}
- Clusters: {spec.clusters}
- Nodes: {spec.nodes}
- Edges: {spec.edges}

CRITICAL RULES:
- Use EXACTLY the nodes listed above - no additions, no omissions
- Use EXACTLY the edges listed above - no additions, no omissions
- Set direction="{DIAGRAM_DIRECTION}" for horizontal layout
- Set graph_attr={{"rankdir": "{DIAGRAM_DIRECTION}", "splines": "{DIAGRAM_SPLINES}", "dpi": "{DIAGRAM_DPI}"}}
- Import statements MUST be valid from the diagrams library
- For Bedrock models, use: from diagrams.aws.ml import Sagemaker
- For Lambda, use: from diagrams.aws.compute import Lambda
- For Custom icon nodes (Custom:path), use: from diagrams.custom import Custom
- Custom node syntax: Custom("Label", "path/to/icon.png")
- For styled edges, use: from diagrams import Edge
- Edge syntax: node1 >> Edge(color="#HEX", style="bold", penwidth="2") >> node2
- For styled clusters, use: Cluster("Name", graph_attr={{"bgcolor": "#HEX", "pencolor": "#HEX", "penwidth": "N", "style": "filled"}})
- A `parent=<Parent Name>` attribute in a Cluster definition is a NESTING HINT: render that Cluster INSIDE its parent's `with Cluster(...)` block.

EXTRA INSTRUCTIONS (still apply):
{spec.extra_prompt}

AVAILABLE IMPORTS:
<imports>{diagrams_imports}</imports>

Return ONLY the corrected Python code between <code></code> tags.
"""


# ---------------------------------------------------------------------------
# Code execution (kept identical to the pre-refactor behavior)
# ---------------------------------------------------------------------------


def _extract_code(reply: str) -> str | None:
    # Preferred: explicit <code>...</code> tags.
    match = re.search(r"<code>(?P<code>.+?)</code>", reply, re.DOTALL)
    if match:
        code = match.group("code").strip()
        code = code.replace("```python", "").replace("```", "").strip()
        return code
    # Fallback: Claude sometimes wraps in ```python ... ``` fences instead.
    fence = re.search(r"```(?:python)?\s*(?P<code>.+?)```", reply, re.DOTALL)
    if fence:
        return fence.group("code").strip()
    return None


def _run_generated_code(code: str, cwd: Path) -> tuple[str, str]:
    """Write the code to OUTPUT_CODE_FILE in cwd and run it. Returns (stdout, stderr)."""
    code_path = cwd / OUTPUT_CODE_FILE
    code_path.write_text(code, encoding="utf-8")
    try:
        result = subprocess.run(
            ["python3", str(code_path)],
            capture_output=True,
            text=True,
            timeout=CODE_EXECUTION_TIMEOUT,
            cwd=str(cwd),
        )
        return result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return "", f"Execution timed out after {CODE_EXECUTION_TIMEOUT} seconds"
    except Exception as exc:  # pragma: no cover - defensive
        return "", f"{type(exc).__name__}: {exc}"


def _rename_generated_png(target_dir: Path, output_filename: str) -> Path | None:
    """Find the fresh PNG emitted by the diagrams lib and rename it.

    Matches the original behavior: pick the newest PNG that isn't horizontal.png,
    isn't the target output file, and isn't under icons/.
    """
    candidates = []
    for entry in target_dir.iterdir():
        if not entry.is_file():
            continue
        if not entry.suffix.lower() == ".png":
            continue
        if entry.name in {"horizontal.png", output_filename}:
            continue
        if entry.name.startswith("icons/"):
            continue
        candidates.append(entry)

    if not candidates:
        return None

    newest = max(candidates, key=lambda p: p.stat().st_mtime)
    dest = target_dir / output_filename
    newest.rename(dest)
    return dest


# ---------------------------------------------------------------------------
# Publishing (dual output)
# ---------------------------------------------------------------------------


def publish(run: RunConfig, generated_png: Path) -> list[Path]:
    """Copy the generated PNG to per-target destinations. Returns all paths written."""
    written = [generated_png]

    if run.copy_to:
        run.copy_to.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(generated_png, run.copy_to)
        written.append(run.copy_to)

    if run.snapshot_pattern:
        ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        snapshot_rel = run.snapshot_pattern.format(ts=ts)
        snapshot_path = (HERE / snapshot_rel).resolve()
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(generated_png, snapshot_path)
        written.append(snapshot_path)

    return written


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def generate(run: RunConfig) -> int:
    print("Validating architecture definition...")
    is_valid, error_msg = validate_spec(run.spec)
    if not is_valid:
        print("\n❌ Architecture definition validation failed:")
        print(error_msg)
        return 1
    print("✓ Validation passed\n")

    run.output_dir.mkdir(parents=True, exist_ok=True)

    prompt = build_prompt(run.spec)
    attempts = 0
    started = datetime.now()

    while attempts < MAX_ATTEMPTS:
        attempts += 1
        print(f"\nAttempt {attempts}/{MAX_ATTEMPTS}...")

        reply = ask_claude(prompt)
        code = _extract_code(reply)
        if not code:
            print("Could not find <code> tags in response. Retrying...")
            continue

        print(f"\n{OUTPUT_SEPARATOR}")
        print("Generated Code:")
        print(OUTPUT_SEPARATOR)
        print(code)
        print(f"{OUTPUT_SEPARATOR}\n")

        print("Executing generated code...")
        stdout, stderr = _run_generated_code(code, run.output_dir)
        if stdout:
            print("Output:", stdout)

        if stderr:
            print("\nError occurred:")
            print(stderr)
            prompt = build_retry_prompt(run.spec, code, stderr)
            continue

        print("\n✅ Diagram generated successfully!")
        png = _rename_generated_png(run.output_dir, run.output_filename)
        if png is None:
            print("⚠️  Could not locate generated PNG in output directory.")
            return 1

        written = publish(run, png)
        elapsed = (datetime.now() - started).total_seconds()

        print("\n" + OUTPUT_SEPARATOR)
        print("SUMMARY")
        print(OUTPUT_SEPARATOR)
        print(f"target       : {run.target}")
        print(f"stage        : {run.stage}")
        print(f"attempts     : {attempts}")
        print(f"elapsed      : {elapsed:.1f}s")
        print("outputs:")
        for path in written:
            size = path.stat().st_size if path.exists() else 0
            print(f"  - {path} ({size:,} bytes)")
        return 0

    print(f"\n❌ Failed to generate valid code after {MAX_ATTEMPTS} attempts.")
    return 1


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate AWS architecture diagrams with Claude + the diagrams library.",
    )
    parser.add_argument(
        "--target",
        choices=sorted(TARGETS),
        default="agentcore-2026",
        help="Which architecture spec to render (default: agentcore-2026).",
    )
    parser.add_argument(
        "--stage",
        default="dev",
        help="CDK stage to read feature flags from (only used for research-agent target).",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory to write the generated PNG + code. Defaults to this script's directory.",
    )
    args = parser.parse_args(argv)

    run = load_run_config(args.target, args.stage, args.output_dir)
    return generate(run)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(_main(sys.argv[1:]))
