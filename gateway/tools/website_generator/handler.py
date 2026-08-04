# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import io
import json
import logging
import os
import re
import uuid
import zipfile
from datetime import datetime, timezone
from html import escape

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
REPORTS_BUCKET = os.environ.get("REPORTS_BUCKET", "")
IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")

DIETARY_LABELS = {"V": "Vegetarian", "VG": "Vegan", "GF": "Gluten-Free", "DF": "Dairy-Free"}


def _get_image_url(s3_key: str, image_url: str = "") -> str:
    """Get a presigned URL for the image."""
    try:
        if s3_key and IMAGES_BUCKET:
            return s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": IMAGES_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )
    except Exception:
        logger.warning("Failed to generate presigned URL for: %s", s3_key, exc_info=True)
    return image_url or ""


def _zip_key_for(html_key: str) -> str:
    """Deterministic zip key next to the HTML — overwritten on every update."""
    return html_key.rsplit("/", 1)[0] + "/site.zip"


def _build_and_upload_zip(html: str, html_key: str) -> str:
    """Bundle HTML + referenced S3 images into a zip, rewrite img srcs to local paths, return presigned URL."""
    # Collect {s3_key: local_filename} for each image referenced via data-s3-key
    image_keys: dict[str, str] = {}
    for match in re.finditer(r'data-s3-key="([^"]+)"', html):
        s3_key = match.group(1)
        if s3_key and s3_key not in image_keys:
            image_keys[s3_key] = f"images/{os.path.basename(s3_key)}"

    # Rewrite <img src="..."> to local paths for images we're bundling
    offline_html = html
    for s3_key, local_path in image_keys.items():
        offline_html = re.sub(
            rf'(<img\s[^>]*?)src="[^"]*"([^>]*data-s3-key="{re.escape(s3_key)}")',
            rf'\1src="{local_path}"\2',
            offline_html,
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", offline_html)
        for s3_key, local_path in image_keys.items():
            try:
                obj = s3_client.get_object(Bucket=IMAGES_BUCKET, Key=s3_key)
                zf.writestr(local_path, obj["Body"].read())
            except Exception:
                logger.warning("Failed to bundle image %s", s3_key, exc_info=True)

    zip_key = _zip_key_for(html_key)
    s3_client.put_object(
        Bucket=REPORTS_BUCKET,
        Key=zip_key,
        Body=buf.getvalue(),
        ContentType="application/zip",
    )
    return s3_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": REPORTS_BUCKET,
            "Key": zip_key,
            "ResponseContentDisposition": 'attachment; filename="site.zip"',
        },
        ExpiresIn=3600,
    )


def _upload_html(html: str, s3_key: str, user_id: str = "", layout: str = "article") -> tuple[str, str]:
    """Upload HTML + zip bundle to S3. Returns (view_url, download_url)."""
    # Pipeline tag reflects the actual layout so KB ingestion / retrieval can scope correctly.
    # Restaurant menu sites live in the `menu` pipeline; generic topic sites live in the
    # `website` pipeline (not the menu pipeline — that was the old bug that made every
    # generated site look like a menu when searched via the chatbot).
    pipeline_tag = "menu_website" if layout == "menu" else "website"
    s3_client.put_object(
        Bucket=REPORTS_BUCKET,
        Key=s3_key,
        Body=html.encode("utf-8"),
        ContentType="text/html",
        Metadata={
            "generated_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "pipeline": pipeline_tag,
            "layout": layout,
            **({"user_id": user_id} if user_id else {}),
        },
    )
    view_url = s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": REPORTS_BUCKET, "Key": s3_key},
        ExpiresIn=3600,
    )
    try:
        download_url = _build_and_upload_zip(html, s3_key)
    except Exception:
        logger.warning("Failed to build download zip", exc_info=True)
        download_url = ""
    return view_url, download_url


def _render_generic_html(title: str, content: dict, layout: str = "article") -> str:
    """Render a self-contained HTML site for any topic (article or landing layout).

    `content` is a dict of {subtitle?, sections: [{heading, body?, items?}]}.
    Used for research reports, topic overviews, landing pages — anything that is NOT
    a restaurant menu. The restaurant-menu path is `_render_html` which has a dedicated
    dish-card grid with prices and dietary badges.
    """
    subtitle = escape(content.get("subtitle", ""))
    sections = content.get("sections", [])

    nav_items = ""
    for section in sections:
        heading = section.get("heading", "")
        if not heading:
            continue
        sid = escape(heading.lower().replace(" ", "-"))
        nav_items += f'<a href="#{sid}" class="hover:text-sky-600 transition">{escape(heading)}</a>\n'

    def _body_html(body: str) -> str:
        """Turn a plain-text body (with \\n paragraph breaks) into <p> tags."""
        if not body:
            return ""
        # Split on blank lines, fall back to single newlines if none.
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        if not paragraphs:
            paragraphs = [body.strip()]
        return "\n".join(f'<p class="text-gray-700 leading-relaxed mb-4">{escape(p)}</p>' for p in paragraphs)

    sections_html = ""
    for section in sections:
        heading = section.get("heading", "")
        if not heading:
            continue
        sid = escape(heading.lower().replace(" ", "-"))
        body_html = _body_html(section.get("body", ""))

        items_html = ""
        for item in section.get("items", []):
            img_uri = _get_image_url(item.get("s3_key", ""), item.get("image_url", ""))
            img_tag = (
                f'<img src="{img_uri}" alt="{escape(item["name"])}" data-s3-key="{escape(item.get("s3_key", ""))}" '
                f'class="w-full h-40 object-cover rounded-lg mb-3" loading="lazy"/>'
                if img_uri
                else ""
            )
            desc = escape(item.get("description", ""))
            items_html += f"""
            <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition">
                {img_tag}
                <h3 class="text-lg font-semibold text-gray-900 mb-2">{escape(item["name"])}</h3>
                <p class="text-gray-600 text-sm">{desc}</p>
            </div>"""
        items_block = (
            f'<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">{items_html}</div>'
            if items_html
            else ""
        )

        sections_html += f"""
        <section id="{sid}" class="mb-14">
            <h2 class="text-3xl font-bold text-gray-900 mb-4 border-b border-sky-500 pb-2">
                {escape(heading)}
            </h2>
            {body_html}
            {items_block}
        </section>"""

    year = datetime.now(timezone.utc).year
    escaped_title = escape(title)
    hero_body = f'<p class="text-lg text-gray-300">{subtitle}</p>' if subtitle else ""

    # Color palette differs subtly between article (editorial, narrow column) and
    # landing (wider, more marketing-flavored). Both avoid the amber/serif menu look.
    container_class = "max-w-3xl" if layout == "article" else "max-w-6xl"
    body_font = "'Inter', system-ui, sans-serif"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>{escaped_title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com"/>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
    <style>
        html {{ scroll-behavior: smooth; }}
        body {{ font-family: {body_font}; }}
    </style>
</head>
<body class="bg-gray-50 text-gray-800">
    <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div class="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <h1 class="text-xl font-bold text-gray-900">{escaped_title}</h1>
            <nav class="flex gap-5 text-sm text-gray-600">{nav_items}</nav>
        </div>
    </header>
    <div class="bg-gradient-to-br from-slate-900 to-sky-900 text-white py-20 text-center">
        <h2 class="text-4xl sm:text-5xl font-bold mb-3 max-w-4xl mx-auto px-6">{escaped_title}</h2>
        {hero_body}
    </div>
    <main class="{container_class} mx-auto px-6 py-14">{sections_html}</main>
    <footer class="bg-gray-900 text-gray-400 text-center py-8 text-sm">
        <p>&copy; {year} {escaped_title}. Generated by website_generator.</p>
    </footer>
</body>
</html>"""


def _render_html(title: str, menu: dict) -> str:
    """Render a self-contained HTML restaurant website from menu data."""
    menu_title = escape(menu.get("title", title))
    sections = menu.get("sections", [])

    nav_items = ""
    for section in sections:
        sid = escape(section["name"].lower().replace(" ", "-"))
        nav_items += f'<a href="#{sid}" class="hover:text-amber-400 transition">{escape(section["name"])}</a>\n'

    sections_html = ""
    for section in sections:
        sid = escape(section["name"].lower().replace(" ", "-"))
        items_html = ""
        for item in section.get("items", []):
            img_uri = _get_image_url(item.get("s3_key", ""), item.get("image_url", ""))
            img_tag = (
                f'<img src="{img_uri}" alt="{escape(item["name"])}" '
                f'class="w-full h-48 object-cover rounded-lg mb-4" loading="lazy"/>'
                if img_uri
                else ""
            )

            badges = ""
            for tag in item.get("dietary", []):
                label = DIETARY_LABELS.get(tag, tag)
                badges += (
                    f'<span class="inline-block text-xs font-semibold px-2 py-0.5 rounded-full '
                    f'border border-gray-300 text-gray-600">{escape(label)}</span>\n'
                )

            price = escape(item.get("price", "")) if item.get("price") else ""
            desc = escape(item.get("description", ""))

            items_html += f"""
            <div class="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition">
                {img_tag}
                <div class="p-5">
                    <div class="flex justify-between items-start mb-2">
                        <h3 class="text-lg font-bold text-gray-900">{escape(item["name"])}</h3>
                        <span class="text-lg font-semibold text-amber-700 whitespace-nowrap ml-3">{price}</span>
                    </div>
                    <p class="text-gray-600 text-sm mb-3">{desc}</p>
                    <div class="flex flex-wrap gap-1">{badges}</div>
                </div>
            </div>"""

        sections_html += f"""
        <section id="{sid}" class="mb-16">
            <h2 class="text-3xl font-bold text-gray-900 mb-8 border-b-2 border-amber-500 pb-3">
                {escape(section["name"])}
            </h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {items_html}
            </div>
        </section>"""

    year = datetime.now(timezone.utc).year

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>{menu_title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        html {{ scroll-behavior: smooth; }}
        body {{ font-family: 'Georgia', serif; }}
    </style>
</head>
<body class="bg-stone-50 text-gray-800">
    <header class="bg-gray-900 text-white sticky top-0 z-50 shadow-lg">
        <div class="max-w-6xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <h1 class="text-2xl font-bold tracking-wide">{menu_title}</h1>
            <nav class="flex gap-6 text-sm uppercase tracking-wider">{nav_items}</nav>
        </div>
    </header>
    <div class="bg-gray-900 text-white py-20 text-center">
        <h2 class="text-5xl font-bold mb-4">{menu_title}</h2>
        <p class="text-lg text-gray-300">Built for you, backed by trust</p>
    </div>
    <main class="max-w-6xl mx-auto px-6 py-16">{sections_html}</main>
    <footer class="bg-gray-900 text-gray-400 text-center py-8 text-sm">
        <p>&copy; {year} {menu_title}. Generated by AI.</p>
    </footer>
</body>
</html>"""


bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
EDIT_MODEL_ID = os.environ.get("WEBSITE_EDIT_MODEL_ID", "us.amazon.nova-pro-v1:0")


def _layout_from_existing(resp: dict) -> str:
    """Recover the original layout tag from an existing S3 object's metadata.
    Falls back to 'menu' (legacy behaviour) when no tag is present, since the
    only pre-layout-dispatch callers were the menu pipeline.
    """
    return (resp.get("Metadata") or {}).get("layout") or "menu"


def _add_images_to_website(s3_key: str, images: list, user_id: str = "") -> dict:
    """Patch images into an existing website HTML by matching section/dish names.

    Handles both menu-layout (h-48, p-5 card body) and article/landing-layout
    (h-40, shadow-sm card) — tries the menu template's insertion pattern first,
    falls back to the generic article/landing card pattern emitted by
    `_render_generic_html`.
    """
    resp = s3_client.get_object(Bucket=REPORTS_BUCKET, Key=s3_key)
    html = resp["Body"].read().decode("utf-8")
    layout = _layout_from_existing(resp)

    # Tag template depends on layout — menu cards are taller (h-48, rounded-t-xl
    # because they sit at the top of an overflow-hidden card) than generic
    # article/landing cards (h-40, rounded-lg, mb-3). Match the template
    # `_render_*` emits so the inserted tag looks native.
    if layout == "menu":
        img_tag_tpl = (
            '<img src="{url}" alt="{name}" data-s3-key="{s3_key}" '
            'class="w-full h-48 object-cover rounded-t-xl" loading="lazy"/>'
        )
    else:
        img_tag_tpl = (
            '<img src="{url}" alt="{name}" data-s3-key="{s3_key}" '
            'class="w-full h-40 object-cover rounded-lg mb-3" loading="lazy"/>'
        )

    for img in images:
        name = img.get("name", "")
        img_s3_key = img.get("s3_key", "")
        image_url = img.get("image_url", "")
        url = _get_image_url(img_s3_key, image_url)
        if not name or not url:
            continue

        escaped_name = re.escape(name)
        tag = img_tag_tpl.format(url=url, name=name, s3_key=img_s3_key)

        # 1. Replace existing <img alt="name"> (any layout).
        html, count = re.subn(
            rf'<img\s[^>]*alt="{escaped_name}"[^>]*/?>',
            tag,
            html,
        )
        if count > 0:
            continue

        # 2. Menu-template card: insert before <div class="p-5">...<h3>name.
        html, count = re.subn(
            rf'(<div\s+class="p-5">\s*<div\s+class="flex[^"]*">\s*<h3[^>]*>[^<]*{escaped_name})',
            tag + "\n\\1",
            html,
        )
        if count > 0:
            continue

        # 3. Generic article/landing card: insert at start of card body,
        #    before the <h3> whose text matches this section name.
        html = re.sub(
            rf'(<div\s+class="bg-white\s+rounded-xl\s+shadow-sm[^"]*"\s*>\s*)(<h3[^>]*>{escaped_name})',
            rf"\1{tag}\n\2",
            html,
        )

    view_url, download_url = _upload_html(html, s3_key, user_id, layout=layout)
    return {
        "success": True,
        "url": view_url,
        "download_url": download_url,
        "s3_key": s3_key,
        "title": _extract_title(html) or "Updated Website",
        "layout": layout,
    }


def _extract_title(html: str) -> str:
    """Extract current <title> text from an HTML document."""
    m = re.search(r"<title[^>]*>([^<]*)</title>", html, re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _replace_title(html: str, title: str) -> str:
    """Overwrite <title> and the two hero headings with `title`.

    The h1/h2 regexes are class-scoped to the sticky-nav bar and hero block in
    `_render_generic_html` so arbitrary mid-body headings aren't touched.
    """
    esc = escape(title)
    html = re.sub(
        r"(<title[^>]*>)[^<]*(</title>)",
        rf"\1{esc}\2",
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'(<h1\s+class="text-xl font-bold[^"]*">)[^<]*(</h1>)',
        rf"\1{esc}\2",
        html,
        count=1,
    )
    html = re.sub(
        r'(<h2\s+class="text-4xl sm:text-5xl[^"]*">)[^<]*(</h2>)',
        rf"\1{esc}\2",
        html,
        count=1,
    )
    return html


def _user_requested_rename(instructions: str) -> bool:
    """True if the user's edit instructions mention a title/rename change."""
    return bool(
        re.search(
            r"\b(title|rename|call it|name (?:it|the site))\b",
            instructions or "",
            re.IGNORECASE,
        )
    )


def _strip_fabricated_img_tags(html: str) -> str:
    """Remove <img> tags whose src looks like a fabricated S3 URL and has no
    data-s3-key. Real images ingested by _inject_images keep their data-s3-key
    and are left alone — this catches only LLM-invented URLs (e.g. Claude
    writing `<img src="https://...s3.amazonaws.com/new-high-quality-..."/>`
    which 403s and surfaces as NS_BINDING_ABORTED in the browser).
    """

    def _maybe_strip(m: re.Match) -> str:
        tag = m.group(0)
        if 'data-s3-key="' in tag:
            return tag
        src_match = re.search(r'src="([^"]*)"', tag)
        if not src_match:
            return ""  # malformed — drop
        src = src_match.group(1)
        if ".s3.amazonaws.com" in src or src.startswith("s3://") or src == "PLACEHOLDER":
            logger.info("Stripping fabricated img tag: src=%s", src[:80])
            return ""
        return tag

    return re.sub(r"<img\s[^>]*/?\s*>", _maybe_strip, html)


def _refresh_image_urls(html: str) -> str:
    """Regenerate presigned URLs for all images that have a data-s3-key attribute."""

    def _replace_src(match):
        full_tag = match.group(0)
        s3_key_match = re.search(r'data-s3-key="([^"]+)"', full_tag)
        if not s3_key_match:
            return full_tag
        s3_key = s3_key_match.group(1)
        if not s3_key:
            return full_tag
        fresh_url = _get_image_url(s3_key)
        if not fresh_url:
            return full_tag
        return re.sub(r'src="[^"]*"', f'src="{fresh_url}"', full_tag)

    return re.sub(r'<img\s[^>]*data-s3-key="[^"]*"[^>]*/?\s*>', _replace_src, html)


def _extract_image_map(html: str) -> dict[str, str]:
    """Extract {alt_text: s3_key} mapping from all img tags with data-s3-key."""
    mapping = {}
    for match in re.finditer(r'<img\s[^>]*data-s3-key="([^"]+)"[^>]*alt="([^"]*)"', html):
        mapping[match.group(2)] = match.group(1)
    # Also try alt before data-s3-key
    for match in re.finditer(r'<img\s[^>]*alt="([^"]*)"[^>]*data-s3-key="([^"]+)"', html):
        mapping[match.group(1)] = match.group(2)
    return mapping


def _inject_images(new_html: str, image_map: dict[str, str]) -> str:
    """Inject images from old HTML into new HTML by matching dish names.

    Only replaces existing <img> tags with matching alt text — does NOT insert
    new img tags into arbitrary positions (that corrupts the HTML structure).
    """
    for dish_name, s3_key in image_map.items():
        url = _get_image_url(s3_key)
        if not url:
            continue

        escaped = re.escape(dish_name)
        tag = (
            f'<img src="{url}" alt="{dish_name}" data-s3-key="{s3_key}" '
            f'class="w-full h-48 object-cover rounded-t-xl" loading="lazy"/>'
        )

        new_html = re.sub(
            rf'<img\s[^>]*alt="{escaped}"[^>]*/?\s*>',
            tag,
            new_html,
        )

    return new_html


def _strip_presigned_urls(html: str) -> str:
    """Replace presigned URLs with placeholder to reduce tokens for Bedrock, keep data-s3-key."""
    return re.sub(
        r'(<img\s[^>]*?)src="https://[^"]*"([^>]*data-s3-key="[^"]*")',
        r'\1src="PLACEHOLDER"\2',
        html,
    )


def _ai_edit_website(s3_key: str, edit_instructions: str, user_id: str = "") -> dict:
    """Fetch existing HTML from S3, apply edits via Bedrock, re-upload."""
    resp = s3_client.get_object(Bucket=REPORTS_BUCKET, Key=s3_key)
    current_html = resp["Body"].read().decode("utf-8")
    layout = _layout_from_existing(resp)

    # Strip presigned URLs before sending to Bedrock — reduces tokens, avoids corruption
    stripped = _strip_presigned_urls(current_html)

    response = bedrock_runtime.converse(
        modelId=EDIT_MODEL_ID,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "text": (
                            "Edit this HTML based on the instructions. "
                            "Return ONLY the complete updated HTML. No markdown fences, no explanation.\n"
                            "IMPORTANT: Keep ALL <img> tags with their data-s3-key attributes intact. "
                            "Do not remove or modify data-s3-key values or img tags.\n"
                            "Preserve the existing <title> and hero headings exactly unless the "
                            "instructions explicitly request a rename.\n\n"
                            f"INSTRUCTIONS: {edit_instructions}\n\n"
                            f"HTML:\n{stripped}"
                        )
                    }
                ],
            }
        ],
        inferenceConfig={"maxTokens": 10000, "temperature": 0.2},
    )

    updated_html = "".join(b["text"] for b in response["output"]["message"]["content"] if "text" in b).strip()
    if updated_html.startswith("```"):
        updated_html = updated_html[updated_html.index("\n") + 1 :]
    if updated_html.endswith("```"):
        updated_html = updated_html[:-3].rstrip()

    # Regenerate fresh presigned URLs for all images from their stored s3 keys
    updated_html = _refresh_image_urls(updated_html)

    # Strip any <img> tags the LLM fabricated (no data-s3-key, bogus S3 URL) —
    # these 403 from S3 and surface as NS_BINDING_ABORTED in the browser.
    updated_html = _strip_fabricated_img_tags(updated_html)

    # If AI dropped any images, re-inject them from the original HTML
    image_map = _extract_image_map(current_html)
    if image_map:
        updated_html = _inject_images(updated_html, image_map)

    # Pin the original title unless the user explicitly asked for a rename —
    # Nova Pro sometimes rewrites <title> even when the prompt says not to.
    if not _user_requested_rename(edit_instructions):
        original_title = _extract_title(current_html)
        if original_title:
            updated_html = _replace_title(updated_html, original_title)

    presigned_url = _upload_html(updated_html, s3_key, user_id, layout=layout)
    return {
        "success": True,
        "url": presigned_url[0],
        "download_url": presigned_url[1],
        "s3_key": s3_key,
        "title": _extract_title(updated_html) or "Updated Website",
        "layout": layout,
    }


def handler(event, context):
    """Website generator Lambda handler."""
    logger.info("Received event keys: %s", list(event.keys()))

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        if tool_name != "website_generator":
            return {"error": f"This Lambda only supports 'website_generator', received: {tool_name}"}

        mode = event.get("mode", "create")
        user_id = event.get("user_id", "")

        if mode == "add_images":
            s3_key = event.get("s3_key", "")
            images = event.get("images", [])
            if not s3_key or not images:
                return {"error": "add_images mode requires 's3_key' and 'images'"}
            result = _add_images_to_website(s3_key, images, user_id)
            return {"content": [{"type": "text", "text": json.dumps(result)}]}

        if mode == "update":
            s3_key = event.get("s3_key", "")
            html = event.get("html", "")
            edit_instructions = event.get("edit_instructions", "")

            if not s3_key:
                return {"error": "update mode requires 's3_key'"}

            if html:
                # Agent-generated HTML (chatbot mode with Claude)
                # Carry images from old site into new HTML — Claude often drops data-s3-key attrs
                existing_layout = "menu"
                old_html = ""
                try:
                    old_resp = s3_client.get_object(Bucket=REPORTS_BUCKET, Key=s3_key)
                    existing_layout = _layout_from_existing(old_resp)
                    old_html = old_resp["Body"].read().decode("utf-8")
                    image_map = _extract_image_map(old_html)
                    if image_map:
                        html = _inject_images(html, image_map)
                        logger.info("Injected %d images from old site", len(image_map))
                except Exception:
                    logger.warning("Could not carry images from old site", exc_info=True)
                html = _refresh_image_urls(html)
                # Drop LLM-invented <img> tags (no data-s3-key, bogus S3 URL).
                html = _strip_fabricated_img_tags(html)
                # Preserve original <title>/hero headings unless the user's
                # instructions explicitly requested a rename.
                if old_html and not _user_requested_rename(edit_instructions):
                    original_title = _extract_title(old_html)
                    if original_title:
                        html = _replace_title(html, original_title)
                view_url, download_url = _upload_html(html, s3_key, user_id, layout=existing_layout)
                logger.info("Update (html) successful: s3_key=%s", s3_key)
                result = {
                    "success": True,
                    "url": view_url,
                    "download_url": download_url,
                    "s3_key": s3_key,
                    "title": _extract_title(html) or "Updated Website",
                    "layout": existing_layout,
                }
            elif edit_instructions:
                # AI-powered edit (avatar mode with Nova Sonic)
                logger.info("Update (ai_edit) starting: s3_key=%s", s3_key)
                result = _ai_edit_website(s3_key, edit_instructions, user_id)
                logger.info("Update (ai_edit) successful: s3_key=%s", s3_key)
            else:
                return {"error": "update mode requires 'html' or 'edit_instructions'"}

            return {"content": [{"type": "text", "text": json.dumps(result)}]}
        else:
            # Dispatch on `layout`. Backward-compat: if only `menu` was sent
            # (no layout), default to the legacy restaurant-menu path so
            # existing MenuWebsiteWriter callers keep working unchanged.
            menu = event.get("menu", {})
            content = event.get("content", {})
            layout = event.get("layout") or ("menu" if menu else "article")

            title = event.get(
                "title",
                "Services Catalog" if layout == "menu" else "Generated Site",
            )

            site_id = str(uuid.uuid4())[:8]
            safe_title = (
                "".join(c if c.isalnum() or c in " -_" else "" for c in title)[:50].strip().replace(" ", "-") or "site"
            )

            if layout == "menu":
                if not menu.get("sections"):
                    return {"error": "Missing required parameter: menu with sections"}
                html = _render_html(title, menu)
                s3_key = f"websites/{safe_title}-{site_id}/index.html"
                presigned_url = _upload_html(html, s3_key, user_id, layout="menu")
                section_names = [s["name"] for s in menu.get("sections", [])]
                item_count = sum(len(s.get("items", [])) for s in menu.get("sections", []))
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {
                                    "success": True,
                                    "url": presigned_url[0],
                                    "download_url": presigned_url[1],
                                    "s3_key": s3_key,
                                    "bucket": REPORTS_BUCKET,
                                    "title": title,
                                    "layout": "menu",
                                    "sections": section_names,
                                    "item_count": item_count,
                                }
                            ),
                        }
                    ]
                }

            # article / landing (topic-agnostic)
            if layout not in ("article", "landing"):
                return {"error": f"Unknown layout '{layout}'. Use 'article', 'landing', or 'menu'."}
            sections = content.get("sections") or []
            if not sections or not any(s.get("heading") for s in sections):
                return {
                    "error": (
                        "Missing required parameter: 'content.sections' with at least "
                        "one {heading} entry (for article/landing layouts)."
                    )
                }
            html = _render_generic_html(title, content, layout)
            s3_key = f"websites/{safe_title}-{site_id}/index.html"
            presigned_url = _upload_html(html, s3_key, user_id, layout=layout)
            section_headings = [s.get("heading", "") for s in sections if s.get("heading")]
            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "success": True,
                                "url": presigned_url[0],
                                "download_url": presigned_url[1],
                                "s3_key": s3_key,
                                "bucket": REPORTS_BUCKET,
                                "title": title,
                                "layout": layout,
                                "sections": section_headings,
                            }
                        ),
                    }
                ]
            }

    except Exception as e:
        logger.error("Error: %s", str(e), exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
