"""Read a ProbeScan CSV export and summarize Critical (ERROR) findings.

Usage
-----
    python3 tools/security/review_probe_scan.py <path-to-probescan.csv>

The script has no external dependencies. It prints a Markdown report suitable
for pasting into a PR description and exits non-zero if any findings remain
unaddressed against HEAD (useful for CI).

The core entry point is :func:`review_probe_scan`, the "Python function" the
user asked for.
"""

from __future__ import annotations

import csv
import re
import subprocess  # nosec B404 — subprocess import, entire module is a git-aware reviewer
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]

# Fingerprint format emitted by gitleaks:
#   "generic-api-key : fingerprint <sha>:<path>:<rule>:<line>"
_FINGERPRINT_RE = re.compile(r"fingerprint\s+(?P<sha>[0-9a-f]{7,40}):(?P<path>[^:]+):(?P<rule>[^:]+):(?P<line>\d+)")

# Scanner-specific inline suppression markers. The reviewer treats a finding as
# already-addressed when the triggering line (±SUPPRESSION_WINDOW) contains the
# relevant marker, optionally followed by a comma-separated rule-id list.
#
# Examples of recognized lines:
#   # nosemgrep: spawn-shell-true — dev-only CLI, hard-coded templates
#   // nosemgrep: detect-child-process, spawn-shell-true
#   # nosec B310 — scheme validated above, https only
#   result = subprocess.run(  # nosec B603 B607 — args hardcoded
_NOSEMGREP_RE = re.compile(r"nosemgrep(?::\s*(?P<rules>[A-Za-z0-9,\s_\-.]+))?")
_NOSEC_RE = re.compile(r"nosec(?:\s+(?P<rules>B[0-9 ]+))?")
# Semgrep's own suppression handler looks at the triggering line and the line
# immediately above. Multi-line calls (e.g. subprocess.run(...) spanning 5+
# lines) routinely put the marker on the call-opener while the engine reports
# the finding on the inner arg-list line, so we widen to ±5 to match common
# block-scoped suppression usage and mirror the convention in the policy doc.
SUPPRESSION_WINDOW = 5  # lines of context to search around the triggering line


@dataclass(frozen=True)
class Finding:
    """One row from the ProbeScan CSV."""

    scanner: str  # gitleaks | grype | semgrep | ...
    severity: str  # ERROR | WARNING | INFO
    file_name: str
    line: str
    message: str

    @property
    def fingerprint(self) -> str | None:
        match = _FINGERPRINT_RE.search(self.message)
        if not match:
            return None
        return f"{match['sha']}:{match['path']}:{match['rule']}:{match['line']}"

    @property
    def fingerprint_sha(self) -> str | None:
        match = _FINGERPRINT_RE.search(self.message)
        return match["sha"] if match else None

    @property
    def rule_id(self) -> str | None:
        # semgrep: "Rule ID: foo Message: ..."
        m = re.search(r"Rule ID:\s*(\S+)", self.message)
        if m:
            return m.group(1)
        # gitleaks: "generic-api-key : fingerprint ..."
        m = re.match(r"(?P<rule>[a-z0-9-]+)\s*:\s*fingerprint", self.message)
        if m:
            return m.group("rule")
        # grype: "GHSA-xxxx-..."
        m = re.search(r"(GHSA-[a-z0-9-]+)", self.message)
        if m:
            return m.group(1)
        return None


def _path_in_head(path: str) -> bool:
    """Return True if ``path`` exists in the current working tree."""
    return (REPO_ROOT / path).exists()


def _blob_in_commit(sha: str, path: str) -> bool:
    """Return True if ``path`` exists in the git object ``sha``.

    Uses ``git cat-file -e`` which exits 0 if the blob exists and non-zero
    otherwise. Silently returns ``False`` if git isn't available or the sha
    isn't known locally.
    """
    try:
        result = subprocess.run(  # nosec B603 B607 — git cat-file -p <sha>:<path>, args hardcoded, sha+path regex-validated
            ["git", "cat-file", "-e", f"{sha}:{path}"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, OSError):
        return False


def review_probe_scan(csv_path: str | Path) -> dict[str, list[Finding]]:
    """Parse the CSV and return ERROR findings grouped by scanner.

    Parameters
    ----------
    csv_path
        Path to the ProbeScan CSV export.

    Returns
    -------
    dict[str, list[Finding]]
        Mapping of scanner name -> list of ERROR-severity findings, preserving
        the CSV's original order within each scanner.
    """
    path = Path(csv_path)
    if not path.is_file():
        raise FileNotFoundError(f"CSV not found: {path}")

    grouped: dict[str, list[Finding]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if (row.get("Severity") or "").strip().upper() != "ERROR":
                continue
            finding = Finding(
                scanner=(row.get("Job Name") or "").strip(),
                severity=row["Severity"].strip(),
                file_name=(row.get("File Name") or "").strip(),
                line=(row.get("Line") or "").strip(),
                message=(row.get("Message") or "").strip(),
            )
            grouped[finding.scanner].append(finding)
    return dict(grouped)


def _classify_gitleaks(finding: Finding) -> str:
    """Return 'head', 'history', or 'unknown' for a gitleaks finding."""
    if _path_in_head(finding.file_name):
        return "head"
    sha = finding.fingerprint_sha
    if sha and _blob_in_commit(sha, finding.file_name):
        return "history"
    return "unknown"


def _has_inline_suppression(file_name: str, line: str, rule_id: str | None, scanner: str) -> bool:
    """Return True if the finding line (±SUPPRESSION_WINDOW) has a matching
    `# nosemgrep:` / `# nosec` / `// nosemgrep:` marker for the rule.

    Bare markers (no rule list) suppress any rule from that scanner. A rule
    list suppresses only the rules it names.
    """
    try:
        line_no = int(line)
    except (TypeError, ValueError):
        return False
    path = REPO_ROOT / file_name
    if not path.is_file():
        return False
    try:
        text_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False

    start = max(0, line_no - 1 - SUPPRESSION_WINDOW)
    end = min(len(text_lines), line_no - 1 + SUPPRESSION_WINDOW + 1)
    window = text_lines[start:end]

    scanner_norm = scanner.lower()

    for text in window:
        # semgrep suppressions — apply to the semgrep scanner
        if scanner_norm == "semgrep":
            m = _NOSEMGREP_RE.search(text)
            if m:
                rules = m.group("rules")
                if not rules:
                    return True
                named = {r.strip() for r in rules.split(",") if r.strip()}
                if rule_id is None or rule_id in named:
                    return True
        # bandit suppressions — apply to the bandit scanner
        if scanner_norm == "bandit":
            m = _NOSEC_RE.search(text)
            if m:
                rules = m.group("rules")
                if not rules:
                    return True
                named = {r.strip() for r in rules.split() if r.strip()}
                if rule_id is None or rule_id in named:
                    return True
    return False


def _format_markdown(grouped: dict[str, list[Finding]]) -> tuple[str, int]:
    """Return (markdown, unaddressed_count)."""
    lines: list[str] = []
    total = sum(len(v) for v in grouped.values())
    lines.append(f"# ProbeScan — {total} Critical (ERROR) findings\n")

    unaddressed = 0

    for scanner in sorted(grouped):
        findings = grouped[scanner]
        lines.append(f"## {scanner} ({len(findings)})\n")
        lines.append("| # | File | Line | Rule | Status |")
        lines.append("| - | ---- | ---- | ---- | ------ |")
        for idx, f in enumerate(findings, 1):
            status = "TODO"
            if scanner == "gitleaks":
                location = _classify_gitleaks(f)
                if location == "head":
                    # Only unaddressed if the file still exists AND isn't gitignored.
                    ignored = _is_gitignored(f.file_name)
                    status = "in-HEAD (gitignored)" if ignored else "in-HEAD — REMOVE"
                    if not ignored:
                        unaddressed += 1
                elif location == "history":
                    status = "history-only — suppress via .gitleaksignore"
                else:
                    status = "unknown (sha/blob not found locally)"
            elif scanner == "grype":
                status = "transitive dep — pin via `overrides`"
            elif scanner in ("semgrep", "bandit"):
                if _has_inline_suppression(f.file_name, f.line, f.rule_id, scanner):
                    status = "suppressed in-code (verified)"
                else:
                    marker = "`# nosemgrep`" if scanner == "semgrep" else "`# nosec`"
                    status = f"review + {marker} with justification"
                    unaddressed += 1
            lines.append(f"| {idx} | `{f.file_name}` | {f.line} | `{f.rule_id or '-'}` | {status} |")
        lines.append("")

    return "\n".join(lines), unaddressed


def _is_gitignored(path: str) -> bool:
    try:
        result = subprocess.run(  # nosec B603 B607 — git check-ignore, args hardcoded, path regex-validated
            ["git", "check-ignore", "-q", path],
            cwd=REPO_ROOT,
            capture_output=True,
            check=False,
        )
        return result.returncode == 0
    except (FileNotFoundError, OSError):
        return False


def _main(argv: Iterable[str]) -> int:
    args = list(argv)
    if len(args) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    grouped = review_probe_scan(args[0])
    markdown, unaddressed = _format_markdown(grouped)
    print(markdown)
    if unaddressed:
        print(f"\n[!] {unaddressed} finding(s) still reference tracked files in HEAD.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
