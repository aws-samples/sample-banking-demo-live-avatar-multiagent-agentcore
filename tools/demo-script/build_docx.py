#!/usr/bin/env python
"""Render the Gartner demo documents to Word.

Two documents are produced from this one renderer, for two different audiences:

reviewer (docs/demo-script.docx)
    The document shared with reviewers. Organised around the four sections in
    Gartner's brief. For each section it states what Gartner asked for, the
    steps we will show, and the capabilities in focus. No narration, no
    internal strategy.

narrated (docs/demo-script-narrated.docx)
    The internal recording script. Narration is written in observer voice: it
    describes what a given role would encounter rather than being performed in
    that role's first person, which keeps it usable as a narration track for a
    single presenter.

Usage:
    python tools/demo-script/build_docx.py --content reviewer
    python tools/demo-script/build_docx.py --content narrated
    python tools/demo-script/build_docx.py --content reviewer --out /tmp/x.docx
"""

from __future__ import annotations

import argparse
import importlib
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ACCENT = RGBColor(0x23, 0x2F, 0x3E)
MUTED = RGBColor(0x5A, 0x64, 0x72)

# content key -> (module name, default output path)
CONTENTS = {
    "reviewer": ("reviewer_content", "docs/demo-script.docx"),
    "narrated": ("content", "docs/demo-script-narrated.docx"),
}


# ---------------------------------------------------------------------------
# document helpers
# ---------------------------------------------------------------------------


def add_toc_field(doc: Document) -> None:
    """Insert a real Word TOC field.

    Word populates page numbers when the reader opens the file and accepts the
    "update fields" prompt, so the printed TOC always matches the final layout.
    """
    para = doc.add_paragraph()
    run = para.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = r'TOC \o "1-3" \h \z \u'
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    placeholder = OxmlElement("w:t")
    placeholder.text = "Right-click and choose Update Field to build the table of contents."
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for el in (begin, instr, separate, placeholder, end):
        run._r.append(el)


def style_base(doc: Document) -> None:
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(6)

    quote = doc.styles["Quote"]
    quote.font.size = Pt(10.5)
    quote.font.italic = False
    quote.font.color.rgb = ACCENT
    quote.paragraph_format.left_indent = Inches(0.3)
    quote.paragraph_format.space_before = Pt(4)
    quote.paragraph_format.space_after = Pt(8)


def meta(doc: Document, text: str) -> None:
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(9.5)
    run.font.color.rgb = MUTED
    p.paragraph_format.space_after = Pt(4)


def labelled(doc: Document, label: str, text: str) -> None:
    p = doc.add_paragraph()
    r = p.add_run(f"{label}  ")
    r.bold = True
    r.font.size = Pt(10)
    p.add_run(text).font.size = Pt(10)
    p.paragraph_format.space_after = Pt(4)


def narration(doc: Document, text: str) -> None:
    head = doc.add_paragraph()
    r = head.add_run("Narration")
    r.bold = True
    r.font.size = Pt(9)
    r.font.color.rgb = MUTED
    head.paragraph_format.space_after = Pt(2)
    for chunk in text.strip().split("\n\n"):
        doc.add_paragraph(chunk.strip(), style="Quote")


def bullets(doc: Document, items: list[str], numbered: bool = False) -> None:
    style = "List Number" if numbered else "List Bullet"
    for it in items:
        p = doc.add_paragraph(it, style=style)
        p.paragraph_format.space_after = Pt(2)


def table(doc: Document, headers: list[str], rows: list[list[str]], widths: list[float] | None = None) -> None:
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Light Grid Accent 1"
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        run = cell.paragraphs[0].add_run(h)
        run.bold = True
        run.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            cells[i].paragraphs[0].add_run(str(val)).font.size = Pt(9.5)
    if widths:
        for r in t.rows:
            for i, w in enumerate(widths):
                r.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def beat(doc: Document, timecode: str, title: str) -> None:
    h = doc.add_heading(f"{timecode} — {title}", level=3)
    h.paragraph_format.space_before = Pt(12)


DEFAULT_TITLE = "AWS Product Demo Script"
DEFAULT_SUBTITLE = "Amazon Bedrock AgentCore"
DEFAULT_KICKER = "Gartner Magic Quadrant / Critical Capabilities\nAI Application Development Platforms 2026"
DEFAULT_META = (
    "Submission deadline: 24 August 2026, 11:59 pm PST",
    "Feature cutoff: capabilities generally available as of 1 August 2026",
    "Runtime: 60:00 hard stop  ·  1080p .mp4  ·  English audio  ·  1x playback, no sped-up segments",
    "Narration voice: observer describing what each role encounters",
)


def build_title(doc: Document, mod) -> None:
    """Render the cover. Content modules may override any of the four fields."""
    for _ in range(3):
        doc.add_paragraph()
    t = doc.add_paragraph()
    t.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = t.add_run(getattr(mod, "TITLE", DEFAULT_TITLE))
    r.bold = True
    r.font.size = Pt(28)
    r.font.color.rgb = ACCENT

    s = doc.add_paragraph()
    s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = s.add_run(getattr(mod, "SUBTITLE", DEFAULT_SUBTITLE))
    r.font.size = Pt(16)
    r.font.color.rgb = MUTED

    s2 = doc.add_paragraph()
    s2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = s2.add_run(getattr(mod, "KICKER", DEFAULT_KICKER))
    r.font.size = Pt(12)

    doc.add_paragraph()
    for line in getattr(mod, "META", DEFAULT_META):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = p.add_run(line)
        run.font.size = Pt(10)
        run.font.color.rgb = MUTED
        p.paragraph_format.space_after = Pt(2)

    doc.add_page_break()
    doc.add_heading("Table of Contents", level=1)
    add_toc_field(doc)
    doc.add_page_break()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", choices=sorted(CONTENTS), default="reviewer")
    ap.add_argument("--out", default=None, help="defaults to the path for the chosen --content")
    args = ap.parse_args()

    module_name, default_out = CONTENTS[args.content]
    mod = importlib.import_module(module_name)  # local module, same directory

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.9)
    sec.top_margin = sec.bottom_margin = Inches(0.8)
    style_base(doc)

    build_title(doc, mod)

    mod.write_body(doc, narration=narration, labelled=labelled, bullets=bullets, table=table, beat=beat, meta=meta)

    out = Path(args.out or default_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
