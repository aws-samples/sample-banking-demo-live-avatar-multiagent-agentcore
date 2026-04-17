# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import os
import uuid
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


def _upload_html(html: str, s3_key: str, user_id: str = "") -> str:
    """Upload HTML to S3 and return presigned URL."""
    s3_client.put_object(
        Bucket=REPORTS_BUCKET,
        Key=s3_key,
        Body=html.encode("utf-8"),
        ContentType="text/html",
        Metadata={
            "generated_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "pipeline": "menu_website",
            **({"user_id": user_id} if user_id else {}),
        },
    )
    return s3_client.generate_presigned_url(
        "get_object",
        Params={"Bucket": REPORTS_BUCKET, "Key": s3_key},
        ExpiresIn=3600,
    )


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
        <p class="text-lg text-gray-300">Crafted with passion, served with pride</p>
    </div>
    <main class="max-w-6xl mx-auto px-6 py-16">{sections_html}</main>
    <footer class="bg-gray-900 text-gray-400 text-center py-8 text-sm">
        <p>&copy; {year} {menu_title}. Generated by AI Menu Designer.</p>
    </footer>
</body>
</html>"""


bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
)
EDIT_MODEL_ID = os.environ.get("WEBSITE_EDIT_MODEL_ID", "us.amazon.nova-pro-v1:0")


import re


def _add_images_to_website(s3_key: str, images: list, user_id: str = "") -> dict:
    """Patch images into an existing website HTML by matching dish names."""
    resp = s3_client.get_object(Bucket=REPORTS_BUCKET, Key=s3_key)
    html = resp["Body"].read().decode("utf-8")

    img_tag_tpl = (
        '<img src="{url}" alt="{name}" data-s3-key="{s3_key}" '
        'class="w-full h-48 object-cover rounded-t-xl" loading="lazy"/>'
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

        # Replace existing broken img tags with matching alt text
        html, count = re.subn(
            rf'<img\s[^>]*alt="{escaped_name}"[^>]*/?>',
            tag,
            html,
        )
        if count > 0:
            continue

        # No existing img — insert before the <div class="p-5"> that contains this dish name
        html = re.sub(
            rf'(<div\s+class="p-5">\s*<div\s+class="flex[^"]*">\s*<h3[^>]*>[^<]*{escaped_name})',
            tag + "\n\\1",
            html,
        )

    presigned_url = _upload_html(html, s3_key, user_id)
    return {"success": True, "url": presigned_url, "s3_key": s3_key}


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
                            "Do not remove or modify data-s3-key values or img tags.\n\n"
                            f"INSTRUCTIONS: {edit_instructions}\n\n"
                            f"HTML:\n{stripped}"
                        )
                    }
                ],
            }
        ],
        inferenceConfig={"maxTokens": 10000, "temperature": 0.2},
    )

    updated_html = "".join(
        b["text"] for b in response["output"]["message"]["content"] if "text" in b
    ).strip()
    if updated_html.startswith("```"):
        updated_html = updated_html[updated_html.index("\n") + 1 :]
    if updated_html.endswith("```"):
        updated_html = updated_html[:-3].rstrip()

    # Regenerate fresh presigned URLs for all images from their stored s3 keys
    updated_html = _refresh_image_urls(updated_html)

    presigned_url = _upload_html(updated_html, s3_key, user_id)
    return {"success": True, "url": presigned_url, "s3_key": s3_key}


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
                html = _refresh_image_urls(html)
                presigned_url = _upload_html(html, s3_key, user_id)
                logger.info("Update (html) successful: s3_key=%s", s3_key)
                result = {"success": True, "url": presigned_url, "s3_key": s3_key}
            elif edit_instructions:
                # AI-powered edit (avatar mode with Nova Sonic)
                logger.info("Update (ai_edit) starting: s3_key=%s", s3_key)
                result = _ai_edit_website(s3_key, edit_instructions, user_id)
                logger.info("Update (ai_edit) successful: s3_key=%s", s3_key)
            else:
                return {"error": "update mode requires 'html' or 'edit_instructions'"}

            return {"content": [{"type": "text", "text": json.dumps(result)}]}
        else:
            title = event.get("title", "Restaurant Menu")
            menu = event.get("menu", {})
            if not menu.get("sections"):
                return {"error": "Missing required parameter: menu with sections"}

            html = _render_html(title, menu)
            site_id = str(uuid.uuid4())[:8]
            safe_title = "".join(c if c.isalnum() or c in " -_" else "" for c in title)[:50].strip().replace(" ", "-")
            s3_key = f"websites/{safe_title}-{site_id}/index.html"

            presigned_url = _upload_html(html, s3_key, user_id)
            section_names = [s["name"] for s in menu.get("sections", [])]
            item_count = sum(len(s.get("items", [])) for s in menu.get("sections", []))

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "success": True,
                                "url": presigned_url,
                                "s3_key": s3_key,
                                "bucket": REPORTS_BUCKET,
                                "title": title,
                                "sections": section_names,
                                "item_count": item_count,
                            }
                        ),
                    }
                ]
            }

    except Exception as e:
        logger.error("Error: %s", str(e), exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
