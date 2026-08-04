#!/usr/bin/env python
"""Export a Markdown document to Word and PDF.

The Markdown file stays the source of truth. This exists because several docs in
docs/ are shared as .docx or .pdf with people who will not read a repo, and the
previously committed .docx files were produced by hand, so they drifted from the
Markdown as soon as it changed.

Styling is applied through a generated pandoc reference document, so the output
matches the house look used by tools/demo-script/build_docx.py: Calibri body,
dark slate headings, gridded tables.

Wide tables are the main hazard. docs/capabilities-mapping.md has cells running
to several hundred characters, which overflow a portrait page, so PDF output is
landscape at a smaller size by default.

Usage:
    python tools/docs-export/build.py docs/capabilities-mapping.md
    python tools/docs-export/build.py docs/capabilities-mapping.md --formats docx
    python tools/docs-export/build.py docs/kb-isolation.md --portrait
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor

# Matches tools/demo-script/build_docx.py so the two document families look alike.
ACCENT = RGBColor(0x23, 0x2F, 0x3E)
BODY_FONT = "Calibri"
BODY_SIZE = Pt(10)
MONO_FONT = "Consolas"

# Latin Modern, the default TeX text font, has no glyph for these four, so
# xelatex drops them silently and the status columns come out blank.
#
# The alternatives were worse. A fallback font would tie the build to fonts that
# happen to be installed on a particular Mac, and \newunicodechar plus wasysym
# needs TeX packages absent from a texlive-basic install, which is what this
# repo's contributors have. ASCII equivalents render identically everywhere and
# keep the meaning intact: the ballot box and check mark are a not-done/done
# pair, so [ ] and [x] map cleanly.
#
# Applied to a temporary copy for PDF only. Word renders all four natively, so
# the .docx keeps the original characters.
PDF_GLYPH_SUBSTITUTIONS = {
    "\u2610": "[ ]",  # ☐ ballot box — verification not yet done
    "\u2705": "[x]",  # ✅ heavy check mark — resolved
    "\u25d0": "[~]",  # ◐ circle, left half black — partially resolved
    "\u2265": ">=",  # ≥ greater-than or equal to
}


def build_reference_docx(path: Path) -> None:
    """Write an empty .docx whose styles pandoc will copy into the output."""
    doc = Document()

    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = BODY_SIZE
    normal.paragraph_format.space_after = Pt(6)

    for level, size in ((1, 20), (2, 15), (3, 12), (4, 11)):
        style = doc.styles[f"Heading {level}"]
        style.font.name = BODY_FONT
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = ACCENT

    # Pandoc routes fenced code and inline code through these two styles.
    for name in ("Source Code", "Verbatim Char"):
        if name in [s.name for s in doc.styles]:
            doc.styles[name].font.name = MONO_FONT
            doc.styles[name].font.size = Pt(8.5)

    doc.save(path)


def pandoc(args: list[str]) -> None:
    result = subprocess.run(["pandoc", *args], capture_output=True, text=True)
    if result.returncode != 0:
        # Pandoc puts the useful part on stderr; surface it rather than a bare code.
        raise SystemExit(f"pandoc failed:\n{result.stderr.strip()}")
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)


def to_docx(src: Path, out: Path, reference: Path) -> None:
    pandoc(
        [
            str(src),
            "-o",
            str(out),
            "--from=gfm",
            "--reference-doc",
            str(reference),
            "--toc",
            "--toc-depth=3",
        ]
    )


def prepare_pdf_source(src: Path, workdir: Path) -> Path:
    """Copy the Markdown, swapping glyphs Latin Modern cannot render."""
    text = src.read_text(encoding="utf-8")
    for char, replacement in PDF_GLYPH_SUBSTITUTIONS.items():
        text = text.replace(char, replacement)
    staged = workdir / src.name
    staged.write_text(text, encoding="utf-8")
    return staged


def to_pdf(src: Path, out: Path, *, landscape: bool) -> None:
    geometry = ["-V", "geometry:margin=0.6in"]
    if landscape:
        geometry += ["-V", "geometry:landscape"]
    pandoc(
        [
            str(src),
            "-o",
            str(out),
            "--from=gfm",
            "--pdf-engine=xelatex",
            "--toc",
            "--toc-depth=3",
            # The stock article class only accepts 10/11/12pt and silently
            # discards anything else; extarticle accepts 9pt.
            "-V",
            "documentclass=extarticle",
            "-V",
            "fontsize=9pt",
            "-V",
            "colorlinks=true",
            "-V",
            "linkcolor=[HTML]{232F3E}",
            "-V",
            "urlcolor=[HTML]{0972D3}",
            *geometry,
        ]
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="Markdown file to export")
    ap.add_argument(
        "--formats",
        default="docx,pdf",
        help="comma-separated subset of docx,pdf (default both)",
    )
    ap.add_argument(
        "--portrait",
        action="store_true",
        help="portrait PDF; default is landscape, which suits wide tables",
    )
    ap.add_argument("--outdir", default=None, help="defaults to the source directory")
    args = ap.parse_args()

    if not shutil.which("pandoc"):
        raise SystemExit("pandoc not found. Install it with: brew install pandoc")

    src = Path(args.source)
    if not src.is_file():
        raise SystemExit(f"no such file: {src}")

    outdir = Path(args.outdir) if args.outdir else src.parent
    outdir.mkdir(parents=True, exist_ok=True)
    formats = [f.strip() for f in args.formats.split(",") if f.strip()]

    with tempfile.TemporaryDirectory() as tmp:
        reference = Path(tmp) / "reference.docx"
        build_reference_docx(reference)

        if "docx" in formats:
            out = outdir / f"{src.stem}.docx"
            to_docx(src, out, reference)
            print(f"wrote {out}")

        if "pdf" in formats:
            out = outdir / f"{src.stem}.pdf"
            to_pdf(prepare_pdf_source(src, Path(tmp)), out, landscape=not args.portrait)
            print(f"wrote {out}")


if __name__ == "__main__":
    main()
