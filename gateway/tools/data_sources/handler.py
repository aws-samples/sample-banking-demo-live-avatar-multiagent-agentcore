# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

import json
import logging
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def _query_wikipedia(query: str, max_results: int = 3) -> list[dict]:
    """Search Wikipedia and return page summaries."""
    # Search for matching titles
    search_url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
        {
            "action": "query",
            "list": "search",
            "srsearch": query,
            "srlimit": max_results,
            "format": "json",
        }
    )

    req = urllib.request.Request(search_url, headers={"User-Agent": "GartnerResearchBot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        search_data = json.loads(resp.read().decode())

    results = []
    for item in search_data.get("query", {}).get("search", []):
        title = item.get("title", "")
        # Fetch summary for each result
        summary_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}"
        try:
            req = urllib.request.Request(summary_url, headers={"User-Agent": "GartnerResearchBot/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                summary = json.loads(resp.read().decode())
            results.append(
                {
                    "title": summary.get("title", title),
                    "extract": summary.get("extract", ""),
                    "url": summary.get("content_urls", {})
                    .get("desktop", {})
                    .get("page", f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title)}"),
                    "description": summary.get("description", ""),
                }
            )
        except Exception as e:
            logger.warning(f"Failed to fetch summary for {title}: {e}")
            results.append(
                {
                    "title": title,
                    "extract": item.get("snippet", "").replace('<span class="searchmatch">', "").replace("</span>", ""),
                    "url": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title)}",
                    "description": "",
                }
            )

    return results


def _query_arxiv(query: str, max_results: int = 5) -> list[dict]:
    """Search arXiv for academic papers."""
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(
        {
            "search_query": f"all:{query}",
            "start": 0,
            "max_results": max_results,
            "sortBy": "relevance",
            "sortOrder": "descending",
        }
    )

    req = urllib.request.Request(url, headers={"User-Agent": "GartnerResearchBot/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        xml_data = resp.read().decode()

    root = ET.fromstring(xml_data)
    ns = {"atom": "http://www.w3.org/2005/Atom"}

    results = []
    for entry in root.findall("atom:entry", ns):
        title = entry.find("atom:title", ns)
        summary = entry.find("atom:summary", ns)
        published = entry.find("atom:published", ns)
        link = entry.find("atom:id", ns)

        authors = []
        for author in entry.findall("atom:author", ns):
            name = author.find("atom:name", ns)
            if name is not None and name.text:
                authors.append(name.text)

        categories = []
        for cat in entry.findall("atom:category", ns):
            term = cat.get("term", "")
            if term:
                categories.append(term)

        results.append(
            {
                "title": title.text.strip() if title is not None and title.text else "",
                "summary": summary.text.strip() if summary is not None and summary.text else "",
                "authors": authors[:5],
                "published": published.text[:10] if published is not None and published.text else "",
                "url": link.text.strip() if link is not None and link.text else "",
                "categories": categories[:3],
            }
        )

    return results


def handler(event, context):
    """Data sources tool — queries Wikipedia or arXiv public APIs."""
    logger.info(f"Received event: {json.dumps(event)}")

    try:
        delimiter = "___"
        original_tool_name = context.client_context.custom["bedrockAgentCoreToolName"]
        tool_name = original_tool_name[original_tool_name.index(delimiter) + len(delimiter) :]

        logger.info(f"Processing tool: {tool_name}")

        if tool_name != "data_sources":
            return {"error": f"This Lambda only supports 'data_sources', received: {tool_name}"}

        source = event.get("source", "wikipedia")
        query = event.get("query", "")
        max_results = min(event.get("max_results", 5), 10)

        if not query:
            return {"error": "Missing required parameter: query"}

        if source == "wikipedia":
            results = _query_wikipedia(query, max_results)
        elif source == "arxiv":
            results = _query_arxiv(query, max_results)
        else:
            return {"error": f"Unknown source: {source}. Use 'wikipedia' or 'arxiv'."}

        result_json = json.dumps({"source": source, "query": query, "results": results, "count": len(results)})

        return {"content": [{"type": "text", "text": result_json}]}

    except Exception as e:
        logger.error(f"Error processing request: {str(e)}", exc_info=True)
        return {"error": f"Internal server error: {str(e)}"}
