"""
Convert the Graphviz DOT output from render_svg.py into a native draw.io
XML file. Every node, cluster, and edge becomes an individually editable
draw.io shape positioned at the coordinates Graphviz already computed.

Input:  research_agent_architecture.dot  (produced by render_svg.py)
Output: architecture.drawio               (in toolkit dir + repo root)

Run after render_svg.py and inline_svg_icons.py:
    python3 dot_to_drawio.py

Design notes:
  - draw.io uses a top-left origin with Y growing downward. Graphviz
    uses a bottom-left origin with Y growing upward. We flip Y using
    the graph bounding box height.
  - Graphviz units are points (72 pt = 1 inch). draw.io native units
    are also points at 72 DPI, so no scaling needed.
  - Nodes are emitted as draw.io `shape=image` cells with the icon
    base64-embedded inline (so the file is fully self-contained and
    portable, just like architecture.svg).
  - Clusters become draw.io containers (parents) so dragging a
    cluster moves its contents with it.
  - Edges are emitted as simple draw.io `edgeStyle=orthogonalEdgeStyle`
    with the source/target cell IDs and the Graphviz color preserved.
    Spline / control points from the DOT `pos` attribute are NOT
    replayed — draw.io's orthogonal router re-lays them, which is
    actually what you want when you then drag nodes around.
"""

from __future__ import annotations

import base64
import mimetypes
import re
import shutil
from dataclasses import dataclass
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOT_FILE = HERE / "research_agent_architecture.dot"
LOCAL_OUT = HERE / "architecture.drawio"
REPO_ROOT_OUT = HERE.parent.parent / "architecture.drawio"

if not DOT_FILE.exists():
    raise SystemExit(f"ERROR: {DOT_FILE} does not exist. Run render_svg.py first.")

dot = DOT_FILE.read_text(encoding="utf-8")

# Graphviz soft-wraps long attribute values with a trailing backslash followed
# by a newline and indentation. Left folded, a wrapped `image="..."` path parses
# as a filename containing a newline, the icon silently fails to resolve, and
# every node in the draw.io export degrades to a plain grey box. Unfold first.
dot = re.sub(r"\\\s*\n\s*", "", dot)


# ---------------------------------------------------------------------------
# Parsing — DOT is structured enough that regex handles it reliably
# ---------------------------------------------------------------------------


@dataclass
class Node:
    id: str
    label: str
    x: float  # graphviz coords (bottom-left origin)
    y: float
    width: float  # points
    height: float
    image: str | None = None
    cluster: str | None = None  # parent cluster id, or None for top-level


@dataclass
class Cluster:
    id: str
    label: str
    bb: tuple[float, float, float, float]  # llx, lly, urx, ury
    bgcolor: str = "#FFFFFF"
    pencolor: str = "#000000"
    penwidth: float = 1.0
    parent: str | None = None


@dataclass
class Edge:
    source: str
    target: str
    color: str = "#7B8894"
    xlabel: str | None = None
    style: str | None = None  # "dashed" etc


# Parse graph bounding box (for Y-flip)
bb_match = re.search(r'graph\s*\[bb="([^"]+)"', dot)
if not bb_match:
    raise SystemExit("Could not find graph bb=")
gbb = [float(v) for v in bb_match.group(1).split(",")]
GRAPH_HEIGHT = gbb[3] - gbb[1]


def flip_y(y: float, h: float = 0.0) -> float:
    """Convert Graphviz y (bottom-left origin) to draw.io y (top-left origin)."""
    return GRAPH_HEIGHT - y - h


# Parse clusters. A cluster block starts with `subgraph "cluster_NAME" {` and
# ends at a matching brace. For simplicity, we scan line-by-line tracking
# brace depth.
clusters: dict[str, Cluster] = {}
nodes: dict[str, Node] = {}
edges: list[Edge] = []


def _unquote(s: str) -> str:
    s = s.strip()
    if s.startswith('"') and s.endswith('"'):
        s = s[1:-1]
    return s.replace("\\N", "").replace('\\"', '"')


def _parse_attrs(block: str) -> dict[str, str]:
    """Parse `key=value, key="value", ...` attribute blocks."""
    attrs = {}
    # key=value where value is either "..." or a simple token
    for m in re.finditer(r'(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,\]]+))', block):
        key = m.group(1)
        val = m.group(2) if m.group(2) is not None else m.group(3)
        attrs[key] = val
    return attrs


# First pass: find clusters and their attributes + bbox
cluster_stack: list[str] = []
lines = dot.splitlines()
i = 0
current_cluster_attrs_buffer: list[str] = []
in_cluster_graph_attrs = False

for line in lines:
    m = re.match(r'\s*subgraph\s+(?:"(cluster_[^"]+)"|(cluster_[A-Za-z0-9_]+))\s*\{', line)
    if m:
        cluster_id = m.group(1) or m.group(2)
        cluster_stack.append(cluster_id)
        clusters[cluster_id] = Cluster(
            id=cluster_id,
            label=cluster_id.replace("cluster_", ""),
            bb=(0, 0, 0, 0),
            parent=cluster_stack[-2] if len(cluster_stack) > 1 else None,
        )
        continue
    if re.match(r"\s*\}\s*$", line) and cluster_stack:
        cluster_stack.pop()
        continue

# Second pass: parse cluster attributes using a per-cluster buffer
for cid in clusters:
    # Find the opening of this cluster and extract its graph [...] block
    pattern = re.escape(cid)
    # Cluster names with spaces/special chars are quoted in DOT; plain
    # identifiers are emitted unquoted. Accept either form.
    m = re.search(
        rf'subgraph\s+(?:"{pattern}"|{pattern})\s*\{{\s*graph\s*\[(?P<attrs>.*?)\]',
        dot,
        re.DOTALL,
    )
    if not m:
        continue
    attrs = _parse_attrs(m.group("attrs"))
    c = clusters[cid]
    if "bb" in attrs:
        vals = [float(v) for v in attrs["bb"].split(",")]
        if len(vals) == 4:
            c.bb = tuple(vals)  # type: ignore[assignment]
    if "label" in attrs:
        c.label = attrs["label"]
    if "bgcolor" in attrs:
        c.bgcolor = attrs["bgcolor"]
    if "pencolor" in attrs:
        c.pencolor = attrs["pencolor"]
    if "penwidth" in attrs:
        try:
            c.penwidth = float(attrs["penwidth"])
        except ValueError:
            pass


# Parse nodes: `id [attr=..., ...];`. Reliable regex: id = quoted or unquoted
# identifier, followed by [ attrs ] ending with ];
# We use a stateful scan: track which cluster we're in via brace depth.
node_re = re.compile(
    r'(?P<id>"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*\[(?P<attrs>[^\]]+)\]\s*;',
    re.DOTALL,
)

# Walk through dot with brace tracking
depth = 0
cluster_stack = []
pos = 0
for m in re.finditer(r'(subgraph\s+"(cluster_[^"]+)"\s*\{)|(\})|' + node_re.pattern, dot):
    # Emit any open/close events up to this match position
    text = dot[pos : m.start()]
    # This is approximate; we don't use it further. Just advance.
    pos = m.end()

# Simpler: walk char-by-char tracking depth, recording each node match.
depth = 0
cluster_stack = []
idx = 0
cluster_open_re = re.compile(r'subgraph\s+(?:"(cluster_[^"]+)"|(cluster_[A-Za-z0-9_]+))\s*\{')
while idx < len(dot):
    ch = dot[idx]
    if ch == "{":
        # Check if we just entered a cluster subgraph
        # Look back from idx to find 'subgraph "cluster_..." '
        m = cluster_open_re.search(dot, max(0, idx - 200), idx + 1)
        if m and m.end() == idx + 1:
            cluster_stack.append(m.group(1) or m.group(2))
        depth += 1
        idx += 1
        continue
    if ch == "}":
        depth -= 1
        if cluster_stack and depth == len(cluster_stack) - 1:
            # Closing brace for the innermost cluster we're tracking
            cluster_stack.pop()
        idx += 1
        continue
    # Try to match a node at current position
    m = node_re.match(dot, idx)
    if m:
        node_id = _unquote(m.group("id"))
        attrs = _parse_attrs(m.group("attrs"))
        # Skip edges (node_re can match `a -> b [...]` if we're not careful,
        # but our regex requires no `->` so this is just a safety check)
        if "->" in node_id:
            idx = m.end()
            continue
        # Skip graph/node/edge attribute defaults
        if node_id in ("graph", "node", "edge"):
            idx = m.end()
            continue
        if "pos" in attrs:
            try:
                x, y = [float(v) for v in attrs["pos"].split(",")]
            except ValueError:
                idx = m.end()
                continue
            width = float(attrs.get("width", "1.4")) * 72  # inches -> pts
            height = float(attrs.get("height", "1.4")) * 72
            nodes[node_id] = Node(
                id=node_id,
                label=attrs.get("label", node_id),
                x=x,
                y=y,
                width=width,
                height=height,
                image=attrs.get("image"),
                cluster=cluster_stack[-1] if cluster_stack else None,
            )
        idx = m.end()
        continue
    idx += 1


# Parse edges: `"a" -> "b" [attrs];`
edge_re = re.compile(
    r'(?P<src>"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s*->\s*'
    r'(?P<tgt>"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)'
    r"(?:\s*\[(?P<attrs>[^\]]*)\])?\s*;",
    re.DOTALL,
)
for m in edge_re.finditer(dot):
    src = _unquote(m.group("src"))
    tgt = _unquote(m.group("tgt"))
    attrs = _parse_attrs(m.group("attrs") or "")
    edges.append(
        Edge(
            source=src,
            target=tgt,
            color=attrs.get("color", "#7B8894"),
            xlabel=attrs.get("xlabel") or attrs.get("label"),
            style=attrs.get("style"),
        )
    )


print(f"Parsed: {len(clusters)} clusters, {len(nodes)} nodes, {len(edges)} edges")


# ---------------------------------------------------------------------------
# Icon embedding — convert each image= path into an inline data URI
# ---------------------------------------------------------------------------


def _embed_icon(path: str | None) -> str | None:
    if not path:
        return None
    p = Path(path)
    if not p.is_absolute():
        p = HERE / path
    if not p.exists():
        return None
    mime = mimetypes.guess_type(str(p))[0] or "image/png"
    data = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


# ---------------------------------------------------------------------------
# Emit draw.io XML
# ---------------------------------------------------------------------------


def _sanitize_id(raw: str) -> str:
    """draw.io cell IDs should be safe identifiers."""
    return re.sub(r"[^A-Za-z0-9_]", "_", raw)


def _cluster_geom(c: Cluster) -> tuple[float, float, float, float]:
    llx, lly, urx, ury = c.bb
    w = urx - llx
    h = ury - lly
    return llx, flip_y(ury, h), w, h


def _node_geom(n: Node) -> tuple[float, float, float, float]:
    # Graphviz pos is the node's center; draw.io wants top-left
    x = n.x - n.width / 2
    y = flip_y(n.y + n.height / 2, n.height)
    return x, y, n.width, n.height


# Build a lookup of cluster_id -> geometry (for parent-relative positioning)
cluster_geoms: dict[str, tuple[float, float, float, float]] = {}
for c in clusters.values():
    cluster_geoms[c.id] = _cluster_geom(c)


# Compute absolute top-level content bbox so we can (a) shift everything so
# the origin is non-negative and (b) size the draw.io page to fit the real
# content, not a fixed 1200x1800 placeholder that truncates big graphs.
# Child cells inside clusters are emitted parent-relative, so the bbox is
# computed over top-level clusters + orphan nodes only.
_abs_boxes: list[tuple[float, float, float, float]] = []
for c in clusters.values():
    if c.parent is None:
        _abs_boxes.append(cluster_geoms[c.id])
for n in nodes.values():
    if n.cluster is None:
        _abs_boxes.append(_node_geom(n))

if _abs_boxes:
    _min_x = min(b[0] for b in _abs_boxes)
    _min_y = min(b[1] for b in _abs_boxes)
    _max_x = max(b[0] + b[2] for b in _abs_boxes)
    _max_y = max(b[1] + b[3] for b in _abs_boxes)
else:
    _min_x = _min_y = 0.0
    _max_x = _max_y = 0.0

PAGE_MARGIN = 40.0
OFFSET_X = PAGE_MARGIN - _min_x
OFFSET_Y = PAGE_MARGIN - _min_y
PAGE_WIDTH = int(_max_x - _min_x + 2 * PAGE_MARGIN)
PAGE_HEIGHT = int(_max_y - _min_y + 2 * PAGE_MARGIN)


out: list[str] = []
out.append('<mxfile host="app.diagrams.net" agent="dot_to_drawio.py" version="24.0.0">')
out.append('<diagram id="architecture" name="Architecture">')
out.append(
    f'<mxGraphModel dx="1600" dy="1000" grid="1" gridSize="10" '
    f'guides="1" tooltips="1" connect="1" arrows="1" fold="1" '
    f'page="1" pageScale="1" pageWidth="{PAGE_WIDTH}" pageHeight="{PAGE_HEIGHT}" '
    f'math="0" shadow="0">'
)
out.append("<root>")
out.append('<mxCell id="0"/>')
out.append('<mxCell id="1" parent="0"/>')


# Emit clusters first so they can be parents
for c in clusters.values():
    x, y, w, h = cluster_geoms[c.id]
    # Skip empty clusters (no children after feature-flag filtering) —
    # Graphviz omits their bb, so they'd render as a zero-size cell.
    if w <= 0 or h <= 0:
        continue
    parent = _sanitize_id(c.parent) if c.parent else "1"
    # Translate child coords to cluster-relative if parent is a cluster;
    # otherwise apply the global offset so top-level cells are non-negative.
    if c.parent and c.parent in cluster_geoms:
        px, py, _, _ = cluster_geoms[c.parent]
        x -= px
        y -= py
    else:
        x += OFFSET_X
        y += OFFSET_Y
    style = (
        f"rounded=0;whiteSpace=wrap;html=1;"
        f"fillColor={c.bgcolor};strokeColor={c.pencolor};"
        f"strokeWidth={int(c.penwidth)};fontSize=14;"
        f"verticalAlign=top;horizontalAlign=left;"
        f"spacingLeft=10;spacingTop=6;container=1;"
        f"collapsible=0;"
    )
    out.append(
        f'<mxCell id="{_sanitize_id(c.id)}" value="{escape(c.label)}" '
        f'style="{style}" vertex="1" parent="{parent}">'
        f'<mxGeometry x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" '
        f'height="{h:.1f}" as="geometry"/></mxCell>'
    )


# Emit nodes. If a node is inside a cluster, coordinates become relative
# to that cluster.
for n in nodes.values():
    x, y, w, h = _node_geom(n)
    parent = _sanitize_id(n.cluster) if n.cluster else "1"
    if n.cluster and n.cluster in cluster_geoms:
        cx, cy, _, _ = cluster_geoms[n.cluster]
        x -= cx
        y -= cy
    else:
        x += OFFSET_X
        y += OFFSET_Y
    icon_data = _embed_icon(n.image)
    if icon_data:
        style = (
            f"shape=image;verticalLabelPosition=bottom;labelBackgroundColor=none;"
            f"verticalAlign=top;aspect=fixed;imageAspect=1;"
            f"image={icon_data};fontSize=11;"
        )
    else:
        style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#6B7280;fontSize=11;"
    out.append(
        f'<mxCell id="{_sanitize_id(n.id)}" value="{escape(n.label)}" '
        f'style="{style}" vertex="1" parent="{parent}">'
        f'<mxGeometry x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" '
        f'height="{h:.1f}" as="geometry"/></mxCell>'
    )


# Emit edges. draw.io edges live at the top-level parent ("1") regardless
# of where their endpoints are.
for i, e in enumerate(edges):
    # Skip layout-only edges. `style=invis` edges exist purely to pin
    # Graphviz ranks (they draw nothing in the PNG/SVG); emitting them here
    # would add phantom connectors that imply relationships the
    # architecture does not have.
    if e.style and "invis" in e.style:
        continue
    src = _sanitize_id(e.source)
    tgt = _sanitize_id(e.target)
    if src not in {_sanitize_id(n.id) for n in nodes.values()}:
        continue
    if tgt not in {_sanitize_id(n.id) for n in nodes.values()}:
        continue
    style_parts = [
        "edgeStyle=orthogonalEdgeStyle",
        "rounded=0",
        "html=1",
        f"strokeColor={e.color}",
        "strokeWidth=1.5",
        "endArrow=classic",
        "endFill=1",
    ]
    if e.style == "dashed":
        style_parts.append("dashed=1")
    edge_style = ";".join(style_parts) + ";"
    label = escape(e.xlabel) if e.xlabel else ""
    out.append(
        f'<mxCell id="e{i}" value="{label}" style="{edge_style}" '
        f'edge="1" parent="1" source="{src}" target="{tgt}">'
        f'<mxGeometry relative="1" as="geometry"/></mxCell>'
    )


out.append("</root>")
out.append("</mxGraphModel>")
out.append("</diagram>")
out.append("</mxfile>")


xml = "\n".join(out)
LOCAL_OUT.write_text(xml, encoding="utf-8")
shutil.copy2(LOCAL_OUT, REPO_ROOT_OUT)
print(f"Wrote: {LOCAL_OUT} ({LOCAL_OUT.stat().st_size:,} bytes)")
print(f"Wrote: {REPO_ROOT_OUT} ({REPO_ROOT_OUT.stat().st_size:,} bytes)")
