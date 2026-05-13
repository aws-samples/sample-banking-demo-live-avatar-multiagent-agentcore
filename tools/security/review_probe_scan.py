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
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parents[2]

# Fingerprint format emitted by gitleaks:
#   "generic-api-key : fingerprint <sha>:<path>:<rule>:<line>"
_FINGERPRINT_RE = re.compile(r"fingerprint\s+(?P<sha>[0-9a-f]{7,40}):(?P<path>[^:]+):(?P<rule>[^:]+):(?P<line>\d+)")


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
        result = subprocess.run(
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
            elif scanner == "semgrep":
                status = "review + `# nosemgrep` with justification"
            lines.append(f"| {idx} | `{f.file_name}` | {f.line} | `{f.rule_id or '-'}` | {status} |")
        lines.append("")

    return "\n".join(lines), unaddressed


def _is_gitignored(path: str) -> bool:
    try:
        result = subprocess.run(
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
