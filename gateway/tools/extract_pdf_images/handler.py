# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
import logging
import os
import time
import uuid

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
ci_client = boto3.client(
    "bedrock-agentcore",
    region_name=os.environ.get("AWS_REGION", "us-east-1"),
    endpoint_url=f"https://bedrock-agentcore.{os.environ.get('AWS_REGION', 'us-east-1')}.amazonaws.com",
)
REPORTS_BUCKET = os.environ.get("REPORTS_BUCKET", "")
IMAGES_BUCKET = os.environ.get("IMAGES_BUCKET", "")
CI_IDENTIFIER = "aws.codeinterpreter.v1"

EXTRACT_CODE = """
import pypdfium2 as pdfium, base64, json, pathlib

pdf = pdfium.PdfDocument("menu.pdf")
images = []
for i, page in enumerate(pdf):
    for j, obj in enumerate(page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE])):
        bmp = obj.get_bitmap(render=False)
        pil_img = bmp.to_pil()
        if pil_img.width < 100 or pil_img.height < 100:
            continue
        fname = f"img_p{i}_{j}.png"
        pil_img.save(fname)
        # Read back as base64 for transfer
        with open(fname, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        images.append({"file": fname, "b64": b64})

# Print just the filenames for the first output
print(json.dumps([img["file"] for img in images]))

# Write base64 data to a JSON file for retrieval
with open("images_b64.json", "w") as f:
    json.dump(images, f)
"""


def _invoke_ci(session_id: str, name: str, arguments: dict) -> dict:
    """Invoke a Code Interpreter tool and consume the event stream response."""
    import ast

    resp = ci_client.invoke_code_interpreter(
        codeInterpreterIdentifier=CI_IDENTIFIER,
        sessionId=session_id,
        name=name,
        arguments=arguments,
    )

    result = {}
    stream = resp.get("stream")
    if stream:
        for event in stream:
            for key, value in event.items():
                if isinstance(value, str):
                    # Stream events come as string repr of dicts
                    try:
                        parsed = ast.literal_eval(value)
                        if isinstance(parsed, dict):
                            result.update(parsed)
                            continue
                    except Exception:
                        pass
                    result[key] = value
                elif isinstance(value, dict):
                    result.update(value)
    else:
        result = resp

    logger.info("CI %s result keys: %s", name, list(result.keys()))
    return result


def _get_dish_names(menu: dict) -> list[str]:
    """Flatten menu JSON into ordered list of dish names."""
    names = []
    for section in menu.get("sections", []):
        for item in section.get("items", []):
            if item.get("name"):
                names.append(item["name"])
    return names


def handler(event, context):
    """Extract images from a menu PDF via AgentCore Code Interpreter."""
    logger.info("Received event keys: %s", list(event.keys()))

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]
        if tool_name != "extract_pdf_images":
            return {"error": f"Unexpected tool: {tool_name}"}

        pdf_s3_key = event.get("pdf_s3_key", "")
        menu = event.get("menu", {})

        if not menu.get("sections"):
            return {"error": "Requires menu with sections"}

        dish_names = _get_dish_names(menu)

        # Find the PDF — try exact key first, then search for latest menu PDF
        actual_key = pdf_s3_key
        if pdf_s3_key:
            try:
                s3_client.head_object(Bucket=REPORTS_BUCKET, Key=pdf_s3_key)
            except Exception:
                actual_key = ""
                logger.warning("PDF not found at %s, searching for latest", pdf_s3_key)

        if not actual_key:
            # Find most recent menu PDF in the bucket
            resp = s3_client.list_objects_v2(Bucket=REPORTS_BUCKET, Prefix="menus/", MaxKeys=50)
            pdfs = [obj for obj in resp.get("Contents", []) if obj["Key"].endswith(".pdf")]
            if not pdfs:
                return {"error": "No menu PDFs found in the reports bucket"}
            actual_key = sorted(pdfs, key=lambda o: o["LastModified"], reverse=True)[0]["Key"]
            logger.info("Using latest menu PDF: %s", actual_key)

        logger.info("Extracting images for %d dishes from %s", len(dish_names), actual_key)

        # Download PDF from S3
        pdf_obj = s3_client.get_object(Bucket=REPORTS_BUCKET, Key=actual_key)
        pdf_bytes = pdf_obj["Body"].read()

        # Create Code Interpreter session
        session_resp = ci_client.start_code_interpreter_session(
            codeInterpreterIdentifier=CI_IDENTIFIER,
            name=f"pdf-extract-{uuid.uuid4().hex[:6]}",
        )
        session_id = session_resp["sessionId"]
        logger.info("Created CI session: %s", session_id)

        try:
            # Wait for session to be ready
            for _ in range(30):
                status = ci_client.get_code_interpreter_session(
                    codeInterpreterIdentifier=CI_IDENTIFIER,
                    sessionId=session_id,
                ).get("status", "")
                if status == "READY":
                    break
                time.sleep(1)

            # Upload PDF to session using blob
            _invoke_ci(session_id, "writeFiles", {"content": [{"path": "menu.pdf", "blob": pdf_bytes}]})

            # Run extraction code
            result = _invoke_ci(
                session_id,
                "executeCode",
                {
                    "language": "python",
                    "code": EXTRACT_CODE,
                },
            )

            # Parse stdout to get image filenames
            stdout = result.get("stdout", "") or result.get("output", "") or ""
            # Also check structuredContent (Code Interpreter wraps output there)
            sc = result.get("structuredContent", {})
            if not stdout and isinstance(sc, dict):
                stdout = sc.get("stdout", "")
            # Also check content array
            if not stdout:
                for c in result.get("content", []):
                    if isinstance(c, dict) and c.get("text"):
                        stdout = c["text"]
                        break

            stderr = result.get("stderr", "") or (sc.get("stderr", "") if isinstance(sc, dict) else "")
            logger.info("Extract stdout: %s", stdout[:500])
            logger.info("Extract stderr: %s", stderr[:500])

            if not stdout.strip():
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {
                                    "success": False,
                                    "error": f"Code produced no output. stderr: {stderr[:300]}",
                                    "result_dump": json.dumps(result, default=str)[:500],
                                }
                            ),
                        }
                    ]
                }

            image_files = json.loads(stdout.strip().split("\n")[-1])

            # Read extracted images from session
            if not image_files:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps({"success": True, "images": [], "message": "No images found in PDF"}),
                        }
                    ]
                }

            # Read base64-encoded images from the JSON file we wrote
            read_result = _invoke_ci(session_id, "readFiles", {"paths": ["images_b64.json"]})
            # Parse the content — it's in content[0].resource.text or content[0].text
            img_json_text = ""
            for c in read_result.get("content", []):
                if isinstance(c, dict):
                    if c.get("type") == "resource":
                        res = c.get("resource", {})
                        img_json_text = res.get("text", "") or res.get("blob", b"").decode("utf-8", errors="replace")
                    elif c.get("text"):
                        img_json_text = c["text"]
                    if img_json_text:
                        break

            if not img_json_text:
                # Fallback: re-run code to print base64 data directly
                b64_code = 'import json; f=open("images_b64.json"); print(f.read()); f.close()'
                b64_result = _invoke_ci(session_id, "executeCode", {"language": "python", "code": b64_code})
                img_json_text = b64_result.get("structuredContent", {}).get("stdout", "") or next(
                    (c.get("text", "") for c in b64_result.get("content", []) if isinstance(c, dict) and c.get("text")),
                    "",
                )

            if not img_json_text:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps({"success": False, "error": "Could not retrieve extracted images"}),
                        }
                    ]
                }

            extracted = json.loads(img_json_text)

            # Upload to S3 images bucket and map to dish names
            images = []
            for idx, img_data in enumerate(extracted):
                b64 = img_data.get("b64", "")
                if not b64:
                    continue

                dish_name = dish_names[idx] if idx < len(dish_names) else f"dish_{idx}"
                safe_name = "".join(c if c.isalnum() or c in " -_" else "" for c in dish_name).strip().replace(" ", "-")
                img_s3_key = f"images/extracted/{safe_name}-{uuid.uuid4().hex[:6]}.png"

                s3_client.put_object(
                    Bucket=IMAGES_BUCKET,
                    Key=img_s3_key,
                    Body=base64.b64decode(b64),
                    ContentType="image/png",
                )
                images.append({"name": dish_name, "s3_key": img_s3_key})
                logger.info("Uploaded %s -> %s", dish_name, img_s3_key)

            return {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "success": True,
                                "images": images,
                                "count": len(images),
                            }
                        ),
                    }
                ]
            }

        finally:
            # Clean up session
            try:
                ci_client.stop_code_interpreter_session(
                    codeInterpreterIdentifier=CI_IDENTIFIER,
                    sessionId=session_id,
                )
            except Exception:
                logger.warning("Failed to delete CI session %s", session_id, exc_info=True)

    except Exception as e:
        logger.error("Error: %s", str(e), exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
