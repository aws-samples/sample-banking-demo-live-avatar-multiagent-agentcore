# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import urllib.request
import uuid
from datetime import datetime
from io import BytesIO
from urllib.parse import urlparse

import boto3
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
REPORTS_BUCKET = os.environ.get("REPORTS_BUCKET", "")


def _safe_text(text) -> str:
    """Sanitize text for ReportLab — escape XML entities and strip nulls."""
    if text is None:
        return ""
    s = str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return s


def _add_paragraphs(story, text, style):
    """Split a long text block into paragraphs and add each to the story."""
    if not text:
        return
    text = str(text)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text]
    for p in paragraphs:
        story.append(Paragraph(_safe_text(p), style))


def _generate_pdf(topic: str, report: dict, user_id: str = "", pipeline: str = "strategy_research") -> str:
    """Generate a comprehensive PDF report and upload to S3, returning a presigned URL."""
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus import PageBreak

    # -- Colors --
    AWS_DARK = colors.HexColor("#232F3E")
    AWS_ORANGE = colors.HexColor("#FF9900")
    AWS_GOLD = colors.HexColor("#C49A6C")
    DARK_GRAY = colors.HexColor("#333333")
    MED_GRAY = colors.HexColor("#666666")
    LIGHT_BG = colors.HexColor("#F5F5F5")
    CONFIDENCE_COLORS = {
        "high": colors.HexColor("#2e7d32"),
        "medium": colors.HexColor("#ed6c02"),
        "low": colors.HexColor("#d32f2f"),
    }

    buffer = BytesIO()

    # Track page count via a mutable container
    page_count_ref = [0]

    def _on_page(canvas, doc):
        """Add page number footer to all pages except the first (cover)."""
        page_count_ref[0] = doc.page
        if doc.page > 1:
            canvas.saveState()
            canvas.setFont("Helvetica", 9)
            canvas.setFillColor(MED_GRAY)
            canvas.drawCentredString(letter[0] / 2, 36, f"Page {doc.page}")
            canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=72,
        leftMargin=72,
        topMargin=72,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()

    # -- Custom Styles --
    cover_title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Title"],
        fontSize=36,
        leading=42,
        spaceAfter=16,
        textColor=AWS_DARK,
        alignment=TA_CENTER,
    )
    cover_subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontSize=18,
        leading=24,
        spaceAfter=30,
        textColor=AWS_GOLD,
        alignment=TA_CENTER,
        fontName="Helvetica-Oblique",
    )
    cover_date_style = ParagraphStyle(
        "CoverDate",
        parent=styles["Normal"],
        fontSize=12,
        textColor=MED_GRAY,
        alignment=TA_CENTER,
        spaceAfter=8,
    )
    heading_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading1"],
        fontSize=20,
        spaceBefore=24,
        spaceAfter=12,
        textColor=AWS_ORANGE,
    )
    subheading_style = ParagraphStyle(
        "SubHeading",
        parent=styles["Heading2"],
        fontSize=14,
        spaceBefore=16,
        spaceAfter=8,
        textColor=AWS_DARK,
    )
    body_style = ParagraphStyle(
        "CustomBody",
        parent=styles["Normal"],
        fontSize=11,
        leading=16,
        spaceAfter=8,
        textColor=DARK_GRAY,
    )
    evidence_style = ParagraphStyle(
        "Evidence",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        spaceAfter=6,
        leftIndent=24,
        textColor=MED_GRAY,
        backColor=LIGHT_BG,
        borderPadding=6,
    )
    data_style = ParagraphStyle(
        "DataPoint",
        parent=styles["Normal"],
        fontSize=10,
        leading=14,
        spaceAfter=4,
        leftIndent=18,
        bulletIndent=8,
        textColor=DARK_GRAY,
    )
    citation_style = ParagraphStyle(
        "Citation",
        parent=styles["Normal"],
        fontSize=9,
        leading=12,
        textColor=colors.grey,
        spaceAfter=4,
    )
    toc_style = ParagraphStyle(
        "TOCEntry",
        parent=styles["Normal"],
        fontSize=12,
        leading=20,
        spaceAfter=4,
        textColor=AWS_DARK,
    )
    branding_style = ParagraphStyle(
        "Branding",
        parent=styles["Normal"],
        fontSize=10,
        textColor=MED_GRAY,
        alignment=TA_CENTER,
        spaceBefore=40,
    )

    story = []

    # ================================================================
    # 1. COVER PAGE
    # ================================================================
    story.append(Spacer(1, 120))
    story.append(Paragraph(_safe_text(topic), cover_title_style))

    subtitle = report.get("subtitle", "")
    if subtitle:
        story.append(Paragraph(_safe_text(subtitle), cover_subtitle_style))

    story.append(Spacer(1, 24))
    story.append(
        Paragraph(
            datetime.utcnow().strftime("%B %d, %Y"),
            cover_date_style,
        )
    )
    story.append(Spacer(1, 60))
    story.append(Paragraph("Powered by AWS Bedrock", branding_style))
    story.append(PageBreak())

    # ================================================================
    # 2. TABLE OF CONTENTS
    # ================================================================
    toc_sections = []
    toc_sections.append("Executive Summary")
    if report.get("methodology"):
        toc_sections.append("Methodology")
    if report.get("key_findings"):
        toc_sections.append("Key Findings")
    if report.get("supporting_evidence"):
        toc_sections.append("Supporting Evidence")
    if report.get("data_analysis"):
        toc_sections.append("Data Analysis")
    if report.get("conclusions"):
        toc_sections.append("Conclusions")
    if report.get("recommendations"):
        toc_sections.append("Recommendations")
    if report.get("limitations_and_future_research"):
        toc_sections.append("Limitations &amp; Future Research")
    if report.get("images"):
        toc_sections.append("Visual Appendix")
    if report.get("appendices"):
        toc_sections.append("Appendices")
    if report.get("citations"):
        toc_sections.append("References")

    story.append(Paragraph("Table of Contents", heading_style))
    story.append(Spacer(1, 12))
    for idx, section_name in enumerate(toc_sections, 1):
        story.append(Paragraph(f"{idx}. {section_name}", toc_style))
    story.append(PageBreak())

    # ================================================================
    # 3. EXECUTIVE SUMMARY
    # ================================================================
    executive_summary = report.get("executive_summary", "")
    if executive_summary:
        story.append(Paragraph("Executive Summary", heading_style))
        _add_paragraphs(story, executive_summary, body_style)
        story.append(Spacer(1, 12))

    # ================================================================
    # 4. METHODOLOGY
    # ================================================================
    methodology = report.get("methodology", {})
    if methodology:
        story.append(PageBreak())
        story.append(Paragraph("Methodology", heading_style))
        if isinstance(methodology, dict):
            for field in ["approach", "sources_analyzed", "limitations", "timeframe"]:
                val = methodology.get(field, "")
                if val:
                    label = field.replace("_", " ").title()
                    story.append(Paragraph(label, subheading_style))
                    _add_paragraphs(story, val, body_style)
        else:
            _add_paragraphs(story, str(methodology), body_style)

    # ================================================================
    # Helper: build an image+caption block for embedding in the report
    # ================================================================
    def _embed_image_block(img_info):
        """Create a Table with image + caption from an image info dict."""
        s3_key = img_info.get("s3_key", "")
        image_url = img_info.get("image_url", "")
        caption = img_info.get("caption", "")

        img_data = _fetch_image(s3_key, image_url)
        if not img_data:
            return None
        try:
            img = Image(img_data, width=4.5 * inch, height=3 * inch)
            img.hAlign = "CENTER"
            elements = [img]
            if caption:
                from reportlab.lib.enums import TA_CENTER as _TA_CENTER

                cap_style = ParagraphStyle(
                    "ImageCaption",
                    parent=styles["Normal"],
                    fontSize=9,
                    leading=12,
                    textColor=MED_GRAY,
                    alignment=_TA_CENTER,
                    spaceBefore=4,
                    spaceAfter=12,
                )
                elements.append(Paragraph(f"<i>{_safe_text(caption)}</i>", cap_style))
            return elements
        except Exception as e:
            logger.warning(f"Failed to embed image: {e}")
            return None

    # Build a lookup of images by placement hint and theme name
    report_images = report.get("images", [])
    images_by_theme: dict[str, list] = {}
    images_after_exec: list = []
    images_appendix: list = []

    for img in report_images if isinstance(report_images, list) else []:
        if not isinstance(img, dict):
            continue
        hint = img.get("placement_hint", "appendix").lower()
        if hint == "after_executive_summary":
            images_after_exec.append(img)
        elif hint.startswith("section:"):
            theme_key = hint[len("section:") :].strip().lower()
            images_by_theme.setdefault(theme_key, []).append(img)
        else:
            images_appendix.append(img)

    # Embed images after executive summary if requested
    for img_info in images_after_exec:
        blocks = _embed_image_block(img_info)
        if blocks:
            for b in blocks:
                story.append(b)

    # ================================================================
    # 5. KEY FINDINGS BY THEME
    # ================================================================
    key_findings = report.get("key_findings", [])
    if key_findings:
        story.append(PageBreak())
        story.append(Paragraph("Key Findings", heading_style))

        if isinstance(key_findings, list):
            for i, finding in enumerate(key_findings, 1):
                if isinstance(finding, dict):
                    theme = finding.get("theme", f"Finding {i}")
                    confidence = finding.get("confidence", "medium")
                    summary = finding.get("finding", "")
                    detailed = finding.get("detailed_analysis", "")
                    sub_findings = finding.get("sub_findings", [])
                    implications = finding.get("implications", "")

                    # Theme heading with confidence badge
                    conf_color = CONFIDENCE_COLORS.get(confidence, MED_GRAY)
                    conf_hex = f"#{int(conf_color.red * 255):02x}{int(conf_color.green * 255):02x}{int(conf_color.blue * 255):02x}"
                    theme_text = f'{_safe_text(theme)} <font color="{conf_hex}" size="9"><b>[{confidence.upper()} CONFIDENCE]</b></font>'
                    story.append(Paragraph(theme_text, subheading_style))

                    # Summary in italic
                    if summary:
                        story.append(
                            Paragraph(
                                f"<i>{_safe_text(summary)}</i>",
                                body_style,
                            )
                        )

                    # Detailed analysis
                    if detailed:
                        _add_paragraphs(story, detailed, body_style)

                    # Sub-findings
                    if isinstance(sub_findings, list):
                        for sf in sub_findings:
                            if isinstance(sf, dict):
                                point = sf.get("point", "")
                                evidence = sf.get("evidence", "")
                                implication = sf.get("implication", "")
                                if point:
                                    story.append(
                                        Paragraph(
                                            f"\u2022 {_safe_text(point)}",
                                            data_style,
                                        )
                                    )
                                if evidence:
                                    story.append(
                                        Paragraph(
                                            _safe_text(evidence),
                                            evidence_style,
                                        )
                                    )
                                if implication:
                                    story.append(
                                        Paragraph(
                                            f"<i>Implication: {_safe_text(implication)}</i>",
                                            data_style,
                                        )
                                    )
                            else:
                                story.append(
                                    Paragraph(
                                        f"\u2022 {_safe_text(sf)}",
                                        data_style,
                                    )
                                )

                    # Implications
                    if implications:
                        story.append(
                            Paragraph(
                                f"<b>Implications:</b> {_safe_text(implications)}",
                                body_style,
                            )
                        )

                    # Embed images matched to this theme
                    theme_lower = theme.lower()
                    matched_images = []
                    for key, imgs in images_by_theme.items():
                        if key in theme_lower or theme_lower in key:
                            matched_images.extend(imgs)
                    # Also check for substring matches across all theme keys
                    if not matched_images:
                        for key, imgs in list(images_by_theme.items()):
                            for word in key.split():
                                if len(word) > 3 and word in theme_lower:
                                    matched_images.extend(imgs)
                                    break

                    for img_info in matched_images:
                        blocks = _embed_image_block(img_info)
                        if blocks:
                            for b in blocks:
                                story.append(b)
                        # Remove from appendix fallback
                        if img_info in images_appendix:
                            images_appendix.remove(img_info)

                    story.append(Spacer(1, 12))
                else:
                    story.append(Paragraph(f"{i}. {_safe_text(finding)}", body_style))
        else:
            _add_paragraphs(story, str(key_findings), body_style)

    # ================================================================
    # 6. SUPPORTING EVIDENCE
    # ================================================================
    evidence = report.get("supporting_evidence", {})
    if evidence:
        story.append(PageBreak())
        story.append(Paragraph("Supporting Evidence", heading_style))

        if isinstance(evidence, dict):
            for source_type, items in evidence.items():
                label = source_type.replace("_", " ").title()
                story.append(Paragraph(label, subheading_style))
                if isinstance(items, list):
                    for item in items:
                        story.append(
                            Paragraph(
                                f"\u2022 {_safe_text(item)}",
                                evidence_style,
                            )
                        )
                else:
                    _add_paragraphs(story, str(items), evidence_style)
        else:
            _add_paragraphs(story, str(evidence), body_style)

    # ================================================================
    # 7. DATA ANALYSIS
    # ================================================================
    data_analysis = report.get("data_analysis", {})
    if data_analysis:
        story.append(PageBreak())
        story.append(Paragraph("Data Analysis", heading_style))

        if isinstance(data_analysis, dict):
            for section_key in ["quantitative", "qualitative", "trends", "comparative"]:
                items = data_analysis.get(section_key, [])
                if items:
                    label = section_key.title()
                    story.append(Paragraph(label, subheading_style))
                    if isinstance(items, list):
                        for item in items:
                            story.append(
                                Paragraph(
                                    f"\u2022 {_safe_text(item)}",
                                    data_style,
                                )
                            )
                    else:
                        _add_paragraphs(story, str(items), body_style)
        else:
            _add_paragraphs(story, str(data_analysis), body_style)

    # ================================================================
    # 8. CONCLUSIONS
    # ================================================================
    conclusions = report.get("conclusions", "")
    if conclusions:
        story.append(PageBreak())
        story.append(Paragraph("Conclusions", heading_style))
        _add_paragraphs(story, conclusions, body_style)

    # ================================================================
    # 9. RECOMMENDATIONS
    # ================================================================
    recommendations = report.get("recommendations", [])
    if recommendations:
        story.append(PageBreak())
        story.append(Paragraph("Recommendations", heading_style))

        if isinstance(recommendations, list):
            for i, rec in enumerate(recommendations, 1):
                if isinstance(rec, dict):
                    rec_title = rec.get("title", f"Recommendation {i}")
                    priority = rec.get("priority", "medium")
                    rationale = rec.get("rationale", "")
                    guidance = rec.get("implementation_guidance", "")
                    impact = rec.get("expected_impact", "")

                    pri_color = CONFIDENCE_COLORS.get(priority, MED_GRAY)
                    pri_hex = f"#{int(pri_color.red * 255):02x}{int(pri_color.green * 255):02x}{int(pri_color.blue * 255):02x}"
                    rec_heading = f'{i}. {_safe_text(rec_title)} <font color="{pri_hex}" size="9"><b>[{priority.upper()} PRIORITY]</b></font>'
                    story.append(Paragraph(rec_heading, subheading_style))

                    if rationale:
                        story.append(
                            Paragraph(
                                f"<b>Rationale:</b> {_safe_text(rationale)}",
                                body_style,
                            )
                        )
                    if guidance:
                        story.append(
                            Paragraph(
                                f"<b>Implementation:</b> {_safe_text(guidance)}",
                                body_style,
                            )
                        )
                    if impact:
                        story.append(
                            Paragraph(
                                f"<b>Expected Impact:</b> {_safe_text(impact)}",
                                body_style,
                            )
                        )
                    story.append(Spacer(1, 8))
                else:
                    story.append(Paragraph(f"{i}. {_safe_text(rec)}", body_style))
        else:
            _add_paragraphs(story, str(recommendations), body_style)

    # ================================================================
    # 10. LIMITATIONS & FUTURE RESEARCH
    # ================================================================
    limitations = report.get("limitations_and_future_research", "")
    if limitations:
        story.append(PageBreak())
        story.append(Paragraph("Limitations &amp; Future Research", heading_style))
        _add_paragraphs(story, limitations, body_style)

    # Also handle the older "conflicts_and_uncertainties" field
    conflicts = report.get("conflicts_and_uncertainties", "")
    if conflicts and not limitations:
        story.append(PageBreak())
        story.append(Paragraph("Conflicts &amp; Uncertainties", heading_style))
        _add_paragraphs(story, conflicts, body_style)

    # ================================================================
    # 10b. VISUAL APPENDIX (unmatched images)
    # ================================================================
    if images_appendix:
        story.append(PageBreak())
        story.append(Paragraph("Visual Appendix", heading_style))
        for img_info in images_appendix:
            blocks = _embed_image_block(img_info)
            if blocks:
                for b in blocks:
                    story.append(b)

    # ================================================================
    # 11. APPENDICES
    # ================================================================
    appendices = report.get("appendices", [])
    if appendices and isinstance(appendices, list):
        story.append(PageBreak())
        story.append(Paragraph("Appendices", heading_style))
        for idx, appendix in enumerate(appendices):
            letter_label = chr(65 + idx)  # A, B, C...
            if isinstance(appendix, dict):
                app_title = appendix.get("title", f"Appendix {letter_label}")
                app_content = appendix.get("content", "")
                story.append(
                    Paragraph(
                        f"Appendix {letter_label}: {_safe_text(app_title)}",
                        subheading_style,
                    )
                )
                if app_content:
                    _add_paragraphs(story, app_content, body_style)
            else:
                story.append(
                    Paragraph(
                        f"Appendix {letter_label}: {_safe_text(appendix)}",
                        body_style,
                    )
                )
            story.append(Spacer(1, 8))

    # ================================================================
    # 12. REFERENCES
    # ================================================================
    citations = report.get("citations", [])
    if citations:
        story.append(PageBreak())
        story.append(Paragraph("References", heading_style))
        if isinstance(citations, list):
            for i, citation in enumerate(citations, 1):
                cite_text = citation if isinstance(citation, str) else str(citation)
                story.append(Paragraph(f"[{i}] {_safe_text(cite_text)}", citation_style))
        else:
            story.append(Paragraph(_safe_text(str(citations)), citation_style))

    # ================================================================
    # Build PDF
    # ================================================================
    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    total_pages = page_count_ref[0]
    pdf_bytes = buffer.getvalue()
    buffer.close()

    # Upload to S3
    report_id = str(uuid.uuid4())[:8]
    safe_topic = "".join(c if c.isalnum() or c in " -_" else "" for c in topic)[:50].strip().replace(" ", "-")
    s3_key = f"reports/{safe_topic}-{report_id}.pdf"

    s3_client.put_object(
        Bucket=REPORTS_BUCKET,
        Key=s3_key,
        Body=pdf_bytes,
        ContentType="application/pdf",
        Metadata={
            "generated_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "pipeline": pipeline,
            "page_count": str(total_pages),
            **({"user_id": user_id} if user_id else {}),
        },
    )

    # Generate presigned URL (1 hour expiry) with inline display headers
    presigned_url = s3_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": REPORTS_BUCKET,
            "Key": s3_key,
            "ResponseContentDisposition": "inline",
            "ResponseContentType": "application/pdf",
        },
        ExpiresIn=3600,
    )

    return json.dumps(
        {
            "success": True,
            "url": presigned_url,
            "s3_key": s3_key,
            "bucket": REPORTS_BUCKET,
            "topic": topic,
            "pages": total_pages,
        }
    )


IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")


def _fetch_image(s3_key: str = "", image_url: str = "") -> BytesIO | None:
    """Fetch an image from S3 (preferred) or a presigned URL (fallback)."""
    # Try S3 direct download first
    if s3_key and IMAGES_BUCKET:
        try:
            resp = s3_client.get_object(Bucket=IMAGES_BUCKET, Key=s3_key)
            return BytesIO(resp["Body"].read())
        except Exception as e:
            logger.warning(f"S3 fetch failed for {s3_key}: {e}")

    # Fallback to presigned URL
    if image_url:
        # image_url originates from LLM-generated menu/report JSON; validate
        # the scheme so a prompt-injection payload cannot coerce urlopen into
        # following file:// or ftp:// URIs from inside the Lambda.
        parsed = urlparse(image_url)
        if parsed.scheme != "https":
            logger.warning("Blocked non-https image_url scheme: %r", parsed.scheme)
            return None
        try:
            with urllib.request.urlopen(image_url, timeout=15) as resp:  # nosec B310 — scheme validated above, https only
                return BytesIO(resp.read())
        except Exception as e:
            logger.warning(f"URL fetch failed for {image_url[:80]}: {e}")

    return None


def _generate_services_pdf(title: str, services_data: dict, user_id: str = "", pipeline: str = "services") -> str:
    """Generate a polished services catalog PDF with product imagery and upload to S3."""
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.platypus import HRFlowable

    NAVY = colors.HexColor("#1a1a2e")
    GOLD = colors.HexColor("#C49A6C")
    DARK_GRAY = colors.HexColor("#333333")
    MED_GRAY = colors.HexColor("#666666")

    BADGE_COLORS = {
        "V": colors.HexColor("#2e7d32"),
        "VG": colors.HexColor("#2e7d32"),
        "GF": colors.HexColor("#1565c0"),
        "DF": colors.HexColor("#e65100"),
    }

    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=72,
    )

    styles = getSampleStyleSheet()
    services_title_style = ParagraphStyle(
        "MenuTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=32,
        spaceAfter=20,
        textColor=NAVY,
        alignment=TA_CENTER,
    )
    date_style = ParagraphStyle(
        "MenuDate",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=10,
        textColor=MED_GRAY,
        spaceAfter=8,
        alignment=TA_CENTER,
    )
    section_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=16,
        spaceBefore=20,
        spaceAfter=8,
        textColor=GOLD,
        alignment=TA_CENTER,
        tracking=200,
    )
    dish_name_style = ParagraphStyle(
        "DishName",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=14,
        spaceBefore=0,
        spaceAfter=2,
        textColor=NAVY,
    )
    dish_price_style = ParagraphStyle(
        "DishPrice",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        textColor=NAVY,
        alignment=TA_RIGHT,
    )
    dish_desc_style = ParagraphStyle(
        "DishDesc",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=10,
        leading=14,
        textColor=MED_GRAY,
        spaceAfter=4,
    )
    badge_style = ParagraphStyle(
        "DietaryBadge",
        parent=styles["Normal"],
        fontSize=8,
    )
    footer_style = ParagraphStyle(
        "Footer",
        parent=styles["Normal"],
        fontName="Helvetica-Oblique",
        fontSize=9,
        textColor=MED_GRAY,
        alignment=TA_CENTER,
        spaceBefore=30,
    )

    story = []

    # ── Decorative header ──
    services_title = services_data.get("title", title)
    story.append(Paragraph(services_title, services_title_style))
    story.append(
        HRFlowable(
            width="40%",
            thickness=1,
            color=GOLD,
            spaceBefore=8,
            spaceAfter=4,
            hAlign="CENTER",
        )
    )
    story.append(Paragraph(datetime.utcnow().strftime("%B %d, %Y"), date_style))
    story.append(Spacer(1, 16))

    # ── Sections ──
    sections = services_data.get("sections", [])
    for section in sections:
        section_name = section.get("name", "")
        if section_name:
            story.append(
                HRFlowable(
                    width="100%",
                    thickness=0.5,
                    color=GOLD,
                    spaceBefore=16,
                    spaceAfter=4,
                    hAlign="CENTER",
                )
            )
            story.append(Paragraph(section_name.upper(), section_style))
            story.append(
                HRFlowable(
                    width="100%",
                    thickness=0.5,
                    color=GOLD,
                    spaceBefore=0,
                    spaceAfter=12,
                    hAlign="CENTER",
                )
            )

        items = section.get("items", [])
        for item in items:
            item_name = item.get("name", "Unnamed Product")
            description = item.get("description", "")
            price = item.get("price", "")
            dietary = item.get("dietary", [])
            s3_key = item.get("s3_key", "")
            img_url = item.get("image_url", "")

            img_data = _fetch_image(s3_key, img_url)

            # Build detail column: name+price row, description, badges
            name_para = Paragraph(item_name, dish_name_style)
            price_para = Paragraph(price, dish_price_style) if price else Paragraph("", dish_price_style)

            name_price_row = Table(
                [[name_para, price_para]],
                colWidths=[3.2 * inch, 1.0 * inch],
            )
            name_price_row.setStyle(
                TableStyle(
                    [
                        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ]
                )
            )

            detail_parts = [name_price_row]
            if description:
                detail_parts.append(Paragraph(description, dish_desc_style))

            if dietary:
                badge_parts = []
                for tag in dietary:
                    tag_color = BADGE_COLORS.get(tag.upper(), DARK_GRAY)
                    hex_str = f"#{int(tag_color.red * 255):02x}{int(tag_color.green * 255):02x}{int(tag_color.blue * 255):02x}"
                    badge_parts.append(f'<font color="{hex_str}"><b>[{tag}]</b></font>')
                detail_parts.append(Paragraph(" &nbsp; ".join(badge_parts), badge_style))

            if img_data:
                try:
                    img = Image(img_data, width=2 * inch, height=1.5 * inch)
                    img.hAlign = "LEFT"
                    row = [[img, detail_parts]]
                    tbl = Table(row, colWidths=[2.2 * inch, 4.3 * inch])
                    tbl.setStyle(
                        TableStyle(
                            [
                                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                            ]
                        )
                    )
                    story.append(tbl)
                except Exception as e:
                    logger.warning(f"Image embed failed for {item_name}: {e}")
                    for p in detail_parts:
                        story.append(p)
            else:
                for p in detail_parts:
                    story.append(p)

            story.append(Spacer(1, 8))

    # ── Footer ──
    story.append(
        HRFlowable(
            width="60%",
            thickness=0.5,
            color=GOLD,
            spaceBefore=20,
            spaceAfter=8,
            hAlign="CENTER",
        )
    )
    story.append(
        Paragraph(
            "Trinity Reserve Bank — Retail · Wealth · Markets",
            footer_style,
        )
    )

    # Build PDF
    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()

    # Upload to S3
    report_id = str(uuid.uuid4())[:8]
    safe_title = "".join(c if c.isalnum() or c in " -_" else "" for c in services_title)[:50].strip().replace(" ", "-")
    s3_key = f"menus/{safe_title}-{report_id}.pdf"

    s3_client.put_object(
        Bucket=REPORTS_BUCKET,
        Key=s3_key,
        Body=pdf_bytes,
        ContentType="application/pdf",
        Metadata={
            "generated_date": datetime.utcnow().strftime("%Y-%m-%d"),
            "pipeline": pipeline,
            **({"user_id": user_id} if user_id else {}),
        },
    )

    presigned_url = s3_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": REPORTS_BUCKET,
            "Key": s3_key,
            "ResponseContentDisposition": "inline",
            "ResponseContentType": "application/pdf",
        },
        ExpiresIn=3600,
    )

    return json.dumps(
        {
            "success": True,
            "url": presigned_url,
            "s3_key": s3_key,
            "bucket": REPORTS_BUCKET,
            "title": services_title,
            "format": "services",
        }
    )


def handler(event, context):
    """
    PDF report generation tool Lambda handler.

    Generates a formatted PDF report using ReportLab and uploads it to S3.
    Returns a presigned URL for downloading the report.
    """
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name == "pdf_generator":
            if not REPORTS_BUCKET:
                return {"error": "REPORTS_BUCKET environment variable not configured"}

            fmt = event.get("format", "research")
            user_id = event.get("user_id", "")

            # Validate pipeline. Defaults:
            #   fmt=menu     -> "menu"
            #   fmt=research -> "strategy_research" (backward compatible: legacy callers
            #                   for the Bistro Deep Dive pipeline need no changes).
            # Callers on the Open Research pipeline must pass pipeline="market_research".
            allowed_pipelines = {"strategy_research", "market_research", "services"}
            pipeline = event.get("pipeline")
            if pipeline not in allowed_pipelines:
                if pipeline:
                    logger.warning("pdf_generator: unknown pipeline %r, falling back to default", pipeline)
                pipeline = "services" if fmt == "services" else "strategy_research"
            logger.info(f"pdf_generator: fmt={fmt} pipeline={pipeline} user_id={'yes' if user_id else 'no'}")

            if fmt == "services":
                services_title = event.get("title", "Menu")
                services_data = event.get("services", {})
                result = _generate_services_pdf(services_title, services_data, user_id=user_id, pipeline=pipeline)
            else:
                topic = event.get("topic", "Report")
                report = event.get("report", {})
                if not topic:
                    return {"error": "Missing required parameter: topic"}
                result = _generate_pdf(topic, report, user_id=user_id, pipeline=pipeline)

            return {"content": [{"type": "text", "text": result}]}
        else:
            return {"error": f"This Lambda only supports 'pdf_generator', received: {tool_name}"}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
