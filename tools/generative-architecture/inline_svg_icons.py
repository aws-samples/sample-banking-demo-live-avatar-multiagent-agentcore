"""
Rewrite the generated SVG so every <image xlink:href="..."> is replaced
with an inline base64 data: URI. The resulting SVG is fully
self-contained and can be opened or imported anywhere without needing
access to the icon files on disk.

Fixes two problems with the raw diagrams-generated SVG:
  1. Stock AWS icons use absolute paths into the Homebrew Python
     site-packages folder (e.g. /opt/homebrew/.../resources/aws/...).
     These don't exist on any other machine and fail to load.
  2. Custom icons use relative paths like "icons/Browser_Tool.png",
     which only resolve when the SVG is opened from the toolkit folder.

Run after render_svg.py:
    python3 inline_svg_icons.py

Reads:  research_agent_architecture.svg
Writes: architecture.svg          (in toolkit folder, self-contained)
Copies: ../../architecture.svg    (repo root)
"""

from __future__ import annotations

import base64
import mimetypes
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "research_agent_architecture.svg"
LOCAL_OUT = HERE / "architecture.svg"
REPO_ROOT_OUT = HERE.parent.parent / "architecture.svg"

if not SOURCE.exists():
    raise SystemExit(f"ERROR: {SOURCE} does not exist. Run render_svg.py first.")

svg = SOURCE.read_text(encoding="utf-8")

# xlink:href="..." pattern — matches both absolute and relative paths.
href_re = re.compile(r'xlink:href="([^"]+)"')

missing: list[str] = []
embedded = 0
total = 0


def embed(match: re.Match[str]) -> str:
    global embedded, total
    total += 1
    href = match.group(1)

    # Skip already-inlined data URIs.
    if href.startswith("data:"):
        return match.group(0)

    path = Path(href)
    if not path.is_absolute():
        # Relative paths resolve against the toolkit folder (where the
        # SVG was rendered), NOT the repo root.
        path = HERE / href

    if not path.exists():
        missing.append(href)
        return match.group(0)

    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    embedded += 1
    return f'xlink:href="data:{mime};base64,{data}"'


svg_out = href_re.sub(embed, svg)

# Graphviz's SVG output from the `diagrams` lib at dpi=200 has a known
# bug: the `<svg>` tag lists width/height in pt (e.g. 5191pt x 17934pt),
# but the viewBox is in user units at 72 DPI (1868 x 6456), AND the
# root <g> applies a scale(2.77778) transform that expands content to
# the 5191 x 17934 range. Result: viewers that use width/height see a
# ~inch-wide strip on a huge page; viewers that use viewBox see
# everything scaled off-canvas -> blank.
#
# Fix: rewrite the viewBox to match the actual transformed content
# bounding box (pt units), and set width/height to the same values
# without a unit suffix so viewers treat them as pixels, not points.
# This produces an SVG that renders correctly in browsers, Preview,
# Inkscape, and draw.io.
svg_tag_re = re.compile(
    r'<svg\s+width="(?P<w>[\d.]+)pt"\s+height="(?P<h>[\d.]+)pt"\s+'
    r'viewBox="(?P<vb>[^"]+)"',
    re.DOTALL,
)


def _fix_svg_tag(m: re.Match[str]) -> str:
    w_pt = float(m.group("w"))
    h_pt = float(m.group("h"))
    # viewBox matches the inner <g>'s scaled extent (content lives in
    # this coordinate space). Omitting width/height lets browsers scale
    # the SVG to fit the containing element / viewport, instead of
    # rendering at 5191x17934 native pixels and dumping the user at the
    # top of an ~18000px-tall canvas.
    return f'<svg viewBox="0 0 {int(w_pt)} {int(h_pt)}" preserveAspectRatio="xMidYMid meet"'


svg_out, n_sub = svg_tag_re.subn(_fix_svg_tag, svg_out, count=1)
if n_sub != 1:
    print("WARNING: did not find the expected <svg width=...pt ...> pattern; SVG may render blank.")

LOCAL_OUT.write_text(svg_out, encoding="utf-8")
shutil.copy2(LOCAL_OUT, REPO_ROOT_OUT)

# Also emit an HTML wrapper so the SVG can be opened in a browser
# and scale to fit the window regardless of its native dimensions.
html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Architecture</title>
<style>
  html, body {{ margin: 0; padding: 0; height: 100%; background: #f8fafc; }}
  body {{ display: flex; align-items: center; justify-content: center; }}
  svg {{ width: 100vw; height: 100vh; max-width: 100%; max-height: 100%; }}
</style></head><body>
{svg_out}
</body></html>
"""
html_local = HERE / "architecture.html"
html_local.write_text(html, encoding="utf-8")
html_root = HERE.parent.parent / "architecture.html"
shutil.copy2(html_local, html_root)

print(f"Processed {total} image refs")
print(f"  embedded: {embedded}")
print(f"  missing:  {len(missing)}")
for m in missing[:10]:
    print(f"    - {m}")
if len(missing) > 10:
    print(f"    ... and {len(missing) - 10} more")

print()
print(f"Wrote: {LOCAL_OUT}  ({LOCAL_OUT.stat().st_size:,} bytes)")
print(f"Wrote: {REPO_ROOT_OUT}  ({REPO_ROOT_OUT.stat().st_size:,} bytes)")
