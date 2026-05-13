"""
Refresh architecture-diagram icons.

Produces / refreshes the following assets under `icons/`:
  - AgentCore_2026.png / AgentCore_2026.svg  (Jan 30 2026 AWS pack)
  - Strands_Agent.png  / Strands_Agent.svg   (Strands Agents mark on black)

Idempotent: if an output file already exists on disk, the step is skipped
unless `--force` is passed.

Usage:
    python3 refresh_icons.py          # skip existing
    python3 refresh_icons.py --force  # overwrite everything
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ICONS_DIR = os.path.join(HERE, "icons")

PPTX_PATH = "/Users/jboren/Downloads/AWS-Architecture-Icons-Deck_For-Light-BG_013026.pptx"
AGENTCORE_PNG_MEMBER = "ppt/media/image421.png"
AGENTCORE_SVG_MEMBER = "ppt/media/image422.svg"

STRANDS_SVG_URL = "https://strandsagents.com/latest/assets/logo-github.svg"

AGENTCORE_PNG_OUT = os.path.join(ICONS_DIR, "AgentCore_2026.png")
AGENTCORE_SVG_OUT = os.path.join(ICONS_DIR, "AgentCore_2026.svg")
STRANDS_PNG_OUT = os.path.join(ICONS_DIR, "Strands_Agent.png")
STRANDS_SVG_OUT = os.path.join(ICONS_DIR, "Strands_Agent.svg")

FALLBACK_SOURCE_PNG = os.path.join(ICONS_DIR, "AI_Agent.png")


def _extract_agentcore(force: bool) -> tuple[bool, bool]:
    """Extract AgentCore PNG + SVG from the AWS pack. Returns (png_written, svg_written)."""
    png_written = False
    svg_written = False

    if not force and os.path.isfile(AGENTCORE_PNG_OUT) and os.path.isfile(AGENTCORE_SVG_OUT):
        return (False, False)

    if not os.path.isfile(PPTX_PATH):
        print(f"  ! pptx pack not found at {PPTX_PATH} -- skipping AgentCore refresh", file=sys.stderr)
        return (False, False)

    with zipfile.ZipFile(PPTX_PATH) as z:
        if force or not os.path.isfile(AGENTCORE_PNG_OUT):
            with z.open(AGENTCORE_PNG_MEMBER) as src, open(AGENTCORE_PNG_OUT, "wb") as dst:
                shutil.copyfileobj(src, dst)
            png_written = True
        if force or not os.path.isfile(AGENTCORE_SVG_OUT):
            with z.open(AGENTCORE_SVG_MEMBER) as src, open(AGENTCORE_SVG_OUT, "wb") as dst:
                shutil.copyfileobj(src, dst)
            svg_written = True
    return (png_written, svg_written)


def _fetch_strands_svg() -> bytes | None:
    """Fetch the Strands logo SVG. Returns bytes, or None on failure."""
    try:
        req = urllib.request.Request(
            STRANDS_SVG_URL,
            headers={"User-Agent": "gartner-research-agent-icon-refresh/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read()
    except Exception as exc:
        print(f"  ! Strands SVG fetch failed ({exc}) -- using fallback", file=sys.stderr)
        return None


def _build_strands_svg_wrapper(inner_svg: bytes | None) -> bytes:
    """Build the 256x256 black-square SVG wrapper.

    If `inner_svg` is None, fall back to a minimal green-block placeholder.
    """
    if inner_svg is None:
        return (
            b'<?xml version="1.0" encoding="UTF-8"?>\n'
            b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
            b'viewBox="0 0 256 256">\n'
            b'  <rect width="256" height="256" fill="#000000"/>\n'
            b'  <rect x="96" y="64" width="64" height="128" rx="8" fill="#00FF77"/>\n'
            b"</svg>\n"
        )
    # Parse the original viewBox / width / height off the fetched SVG and
    # wrap it in a centered <g transform="..."> inside a 256x256 black square.
    import re

    svg_text = inner_svg.decode("utf-8", errors="ignore")
    m = re.search(r'viewBox="([^"]+)"', svg_text)
    if m:
        vb = m.group(1).split()
        vb_w, vb_h = float(vb[2]), float(vb[3])
    else:
        # fallback from plain width/height attrs
        mw = re.search(r'width="(\d+)"', svg_text)
        mh = re.search(r'height="(\d+)"', svg_text)
        vb_w = float(mw.group(1)) if mw else 290.0
        vb_h = float(mh.group(1)) if mh else 463.0
    # Target: fit into a 160x160 inset inside a 256x256 square, centered.
    target = 160.0
    scale = min(target / vb_w, target / vb_h)
    draw_w = vb_w * scale
    draw_h = vb_h * scale
    tx = (256.0 - draw_w) / 2.0
    ty = (256.0 - draw_h) / 2.0
    # Strip outer <svg ...> wrapper to get the inner paths only.
    inner_body = re.sub(r"^\s*<\?xml[^>]*\?>\s*", "", svg_text)
    inner_body = re.sub(r"^\s*<svg[^>]*>", "", inner_body, count=1)
    inner_body = re.sub(r"</svg>\s*$", "", inner_body, count=1).strip()
    out = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
        'viewBox="0 0 256 256">\n'
        '  <rect width="256" height="256" fill="#000000"/>\n'
        f'  <g transform="translate({tx:.3f},{ty:.3f}) scale({scale:.5f})">\n'
        f"    {inner_body}\n"
        "  </g>\n"
        "</svg>\n"
    )
    return out.encode("utf-8")


def _render_strands_png(strands_svg_bytes: bytes | None) -> bytes:
    """Produce a 256x256 PNG: black background + Strands-style twin-strand
    mark rendered via Pillow primitives (the S-curve shape from the logo).

    If Pillow is unavailable or rendering fails, fall back to the source
    AI_Agent.png tinted green so the pipeline still has a usable asset.
    """
    try:
        from PIL import Image, ImageDraw

        size = 256
        img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
        draw = ImageDraw.Draw(img, "RGBA")

        # The Strands logo is an intertwined S-curve: one grey (back) stroke
        # and one green (front) stroke. We approximate it as two
        # antiparallel quadratic-ish S-curves traced with round caps.
        # Control points are chosen to visually match the real logo
        # proportions (portrait 290x463 -> centered at 128,128 with ~160
        # bounding box).
        cx, cy = size // 2, size // 2
        h = 128  # vertical half-extent of the curve
        w = 52  # horizontal half-extent of the bulge
        stroke = 22

        def _s_curve(offset_x: int, steps: int = 64) -> list[tuple[float, float]]:
            """Sample an S-curve of total vertical extent 2h, bulging by ``w``
            with a small horizontal offset so the two curves interlock."""
            import math

            pts: list[tuple[float, float]] = []
            for i in range(steps + 1):
                t = i / steps  # 0..1
                y = cy - h + 2 * h * t  # top -> bottom
                # Two bulges: first to the left, then to the right (S-shape).
                x = cx + offset_x + w * math.sin(t * math.tau)
                pts.append((x, y))
            return pts

        # Back (grey) stroke, slightly offset to the left
        grey = (152, 152, 152, 255)  # #989898 from the SVG
        green = (0, 255, 119, 255)  # #00FF77 from the SVG

        back_pts = _s_curve(offset_x=-6)
        front_pts = _s_curve(offset_x=+6)

        # Draw back stroke first (grey), then front (green) on top.
        draw.line(back_pts, fill=grey, width=stroke, joint="curve")
        draw.line(front_pts, fill=green, width=stroke, joint="curve")

        # Round end caps for both strokes
        for pts, color in ((back_pts, grey), (front_pts, green)):
            for end in (pts[0], pts[-1]):
                r = stroke // 2
                draw.ellipse(
                    (end[0] - r, end[1] - r, end[0] + r, end[1] + r),
                    fill=color,
                )

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as exc:
        print(f"  ! Pillow render failed ({exc}) -- tinting AI_Agent.png", file=sys.stderr)
        return _tint_fallback_png()


def _tint_fallback_png() -> bytes:
    """Tint the existing AI_Agent.png green as a last-resort fallback."""
    try:
        from PIL import Image

        src = Image.open(FALLBACK_SOURCE_PNG).convert("RGBA")
        # Apply a green tint by multiplying color channels while preserving alpha.
        r, g, b, a = src.split()
        tint_r = r.point(lambda v: int(v * 0.2))
        tint_g = g.point(lambda v: min(255, int(v * 1.2) + 30))
        tint_b = b.point(lambda v: int(v * 0.2))
        out = Image.merge("RGBA", (tint_r, tint_g, tint_b, a))
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        # If even fallback fails, produce a tiny 1x1 black PNG so the icon
        # path exists (keeps the manifest import working).
        return (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00"
            b"\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx"
            b"\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01\x00\x18\xdd\x8d\xb4"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )


def _write_strands_assets(force: bool) -> tuple[bool, bool]:
    png_written = False
    svg_written = False

    png_exists = os.path.isfile(STRANDS_PNG_OUT)
    svg_exists = os.path.isfile(STRANDS_SVG_OUT)
    if not force and png_exists and svg_exists:
        return (False, False)

    inner_svg = _fetch_strands_svg()

    if force or not svg_exists:
        wrapped = _build_strands_svg_wrapper(inner_svg)
        with open(STRANDS_SVG_OUT, "wb") as f:
            f.write(wrapped)
        svg_written = True

    if force or not png_exists:
        png_bytes = _render_strands_png(inner_svg)
        with open(STRANDS_PNG_OUT, "wb") as f:
            f.write(png_bytes)
        png_written = True

    return (png_written, svg_written)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="overwrite existing icon files")
    args = parser.parse_args(argv)

    if not os.path.isdir(ICONS_DIR):
        os.makedirs(ICONS_DIR, exist_ok=True)

    wrote = 0
    skipped = 0

    ac_png, ac_svg = _extract_agentcore(args.force)
    for written, path in ((ac_png, AGENTCORE_PNG_OUT), (ac_svg, AGENTCORE_SVG_OUT)):
        if written:
            wrote += 1
            print(f"  + wrote {os.path.relpath(path, HERE)}")
        else:
            skipped += 1

    st_png, st_svg = _write_strands_assets(args.force)
    for written, path in ((st_png, STRANDS_PNG_OUT), (st_svg, STRANDS_SVG_OUT)):
        if written:
            wrote += 1
            print(f"  + wrote {os.path.relpath(path, HERE)}")
        else:
            skipped += 1

    print(f"wrote {wrote} icons, skipped {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
