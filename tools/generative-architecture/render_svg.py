"""
One-off wrapper: re-render the existing `genai_architect.py` as SVG + DOT
(in addition to the usual PNG) so the diagram can be manually edited in
draw.io / Illustrator / Inkscape.

Run from the same directory so relative icon paths resolve:

    cd tools/generative-architecture
    python3 render_svg.py

Produces (alongside genai_architect.py):
    research_agent_architecture.png
    research_agent_architecture.svg
    research_agent_architecture.dot

Notes:
  - Does NOT modify genai_architect.py or any part of the generator
    pipeline. It monkey-patches diagrams.Diagram.__init__ in memory
    for this process only, then exec's the existing script.
  - No Bedrock call. No new Claude generation. Just a format change
    on the last successful render.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import diagrams as _d

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "genai_architect.py"
OUTPUT_BASENAME = "research_agent_architecture"

if not SOURCE.exists():
    print(f"ERROR: {SOURCE} does not exist. Run `npm run diagram` first.", file=sys.stderr)
    sys.exit(1)


# Patch Diagram.__init__ to force multi-format output and a stable filename.
_orig_init = _d.Diagram.__init__


def _patched_init(self, *args, **kwargs):
    kwargs["outformat"] = ["png", "svg", "dot"]
    kwargs["filename"] = OUTPUT_BASENAME
    kwargs["show"] = False
    _orig_init(self, *args, **kwargs)


_d.Diagram.__init__ = _patched_init  # type: ignore[method-assign]


# Exec the original script in a fresh namespace so it runs as if
# invoked directly. Using exec (not import) avoids caching and keeps
# the original file untouched.
namespace: dict[str, object] = {"__name__": "__main__", "__file__": str(SOURCE)}
code = SOURCE.read_text(encoding="utf-8")
exec(compile(code, str(SOURCE), "exec"), namespace)

# Report what we produced.
outputs = [
    HERE / f"{OUTPUT_BASENAME}.png",
    HERE / f"{OUTPUT_BASENAME}.svg",
    HERE / f"{OUTPUT_BASENAME}.dot",
]
print()
print("=" * 60)
print("Rendered outputs:")
for p in outputs:
    if p.exists():
        print(f"  OK   {p.name}  ({p.stat().st_size:,} bytes)")
    else:
        print(f"  MISS {p.name}")
print("=" * 60)

# Copy SVG + DOT to the repo root alongside the existing PNG, so they
# travel with `architecture.drawio.png`.
REPO_ROOT = HERE.parent.parent  # tools/generative-architecture -> tools -> repo root
for ext in ("svg", "dot"):
    src = HERE / f"{OUTPUT_BASENAME}.{ext}"
    if src.exists():
        dst = REPO_ROOT / f"architecture.drawio.{ext}"
        shutil.copy2(src, dst)
        print(f"Copied to {dst}")
