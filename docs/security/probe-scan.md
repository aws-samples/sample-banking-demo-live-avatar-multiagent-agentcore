# ProbeScan remediation policy

## What ProbeScan is

An internal security probe-scan pipeline that runs gitleaks + grype + semgrep
against a repository's default branch and exports findings to CSV. The CSV
used as the baseline for this repo lives at

    ~/Downloads/ProbeScanExport-37eef25c-407d-4305-8130-99d5136a5ebb-main-20260511.csv

39 findings on `main` were marked **ERROR** (Critical) on 2026-05-11; those
are the ones we remediated. Warning / Info severities are tracked but not
treated as blockers.

## Running the reviewer

```bash
python3 tools/security/review_probe_scan.py <path-to-csv>
```

The script groups ERROR findings by scanner, classifies each gitleaks hit as
"in-HEAD" vs "history-only", and prints a Markdown remediation table. It
exits non-zero if any finding still references a tracked file in HEAD.

## Suppression policy

Every suppression requires a justification comment. CI should reject
suppression diffs that add a new entry with no comment.

### gitleaks — `.gitleaksignore`

- One fingerprint per line: `<sha>:<path>:<rule>:<line>` (the format emitted
  by gitleaks itself in its `fingerprint` field).
- A `#` comment block above each group must explain provenance, e.g. "file
  deleted from repo" or "values are demo fixtures, not real credentials".
- Live credentials must be rotated before suppressing. Do not suppress a hit
  for a file currently tracked in HEAD without also rotating.

### grype — `package.json` overrides

- Transitive CVEs get pinned via the `overrides` block with a fix-version
  confirmed against the GHSA advisory.
- Nested bundled dependencies (e.g. `@aws/pdk` ships its own `node_modules/`
  via `bundledDependencies`) cannot be overridden; document the exception
  here rather than working around it.

### semgrep — `# nosemgrep` / `// nosemgrep`

- The comment must live on the triggering line (per semgrep's rules) and
  name each rule it suppresses, e.g.
  `// nosemgrep: detect-child-process, spawn-shell-true`.
- A one-line justification must follow the `nosemgrep` directive explaining
  why the pattern is safe in context (e.g. "CDK asset bundling, path is
  compile-time constant").

### bandit — `# nosec B<NNN> — <justification>`

- The comment must live on the triggering line (per bandit's rules) and
  name each rule it suppresses, e.g.
  `# nosec B310 — scheme validated above, https only` or
  `# nosec B603 B607 — args hardcoded, path regex-validated`.
- A justification must follow the rule list after an em-dash (`—`) so the
  reviewer at `tools/security/review_probe_scan.py` and human readers can
  tell at a glance why the pattern is safe in context. Suppressions without
  a justification should fail review.
- Prefer fixing the underlying issue (e.g. adding a `urlparse` scheme check
  before `urllib.request.urlopen`) over suppressing. Use suppressions only
  when the pattern is genuinely safe — hardcoded HTTPS endpoints, best-
  effort cleanup `except: pass`, or AgentCore-required `0.0.0.0` binds.

## 2026-05-11 baseline

| Scanner  | ERROR count | Remediation                                                                                                                                                                      |
| -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gitleaks | 17          | 2 live → `.env.production` untracked + gitignored; 15 history-only → `.gitleaksignore` fingerprints                                                                              |
| grype    | 12          | `package.json` `overrides` block pins `minimatch`, `hono`, `@hono/node-server`, `express-rate-limit` to fixed versions                                                           |
| semgrep  | 10          | `nosemgrep` comments with justification on each line (`tools/kit.ts`, `lib/stacks/backend/index.ts` x6, `gateway/tools/extract_pdf_images/handler.py`, `patterns/utils/auth.py`) |

### Known limitations

- `@aws/pdk` ships `minimatch@10.0.1` + `projen` (with its own
  `minimatch@3.1.2` / `5.1.6`) as `bundledDependencies`. The override cannot
  reach bundled deps. Risk is bounded: `@aws/pdk` is only used as a build-time
  scaffolding tool, not shipped to any runtime, and the affected `minimatch`
  calls are on trusted glob patterns from CDK templates (no user input).
- `@aws/pdk` bundledDependencies also carry Critical advisories for `tmp`,
  `js-yaml`, `lodash`, `brace-expansion`, and `diff`. Same limitation — the
  overrides block cannot reach them, and the same "build-time-only, not
  shipped" risk bound applies.
- `commitizen` and its dev-tool chain (e.g. `cz-conventional-changelog`) pull
  several transitive Criticals via their own `node_modules/` trees. These
  are pre-commit-time tooling only — never shipped to any runtime — so we
  accept the finding rather than force-patching upstream.
- `.env.production` is regenerated locally by `npm run kit -- refresh-frontend`
  and must not be re-added to git.

## 2026-05-13 baseline

Scan `53d8fa38-013f-4dfc-b67c-9d52f077e543` against `main` produced **16
Critical** (ERROR), 232 Warning, 60 Info. The new Critical set adds two
scanners (**bandit**, **grype**) on top of the gitleaks/semgrep suppression
regime codified on 2026-05-11.

| Scanner            | ERROR count | Remediation                                                                                                                            |
| ------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| bandit             | 11          | 2 fixes (orchestrator_agent.py logger adds ×3, pdf_generator.py urlparse guard) + 9 `# nosec` suppressions with justification comments |
| grype              | 4           | All inside `@aws/pdk` bundledDependencies or commitizen dev-tool chain; cannot be overridden; see Known Limitations                    |
| (gitleaks/semgrep) | 0 new       | Prior 2026-05-11 suppressions still cover HEAD                                                                                         |

Real code fixes:

- `patterns/orchestrator-agent/orchestrator_agent.py` — three silent
  `try/except/pass` blocks (B110) in `_on_chatbot_event` and
  `_pipeline_callback` replaced with `logger.debug` (SSE queue) /
  `logger.warning` (parse failures) so silent truncations surface in
  CloudWatch.
- `gateway/tools/pdf_generator/handler.py` — `urlopen(image_url)` now goes
  through a `urlparse` scheme guard that rejects anything that isn't
  `https`, so prompt-injected `file://` or `ftp://` URIs from LLM-generated
  menu/report JSON cannot coerce the Lambda into fetching local files.

## When to update this doc

- A new ProbeScan baseline is taken (replace the timestamped reference).
- A new suppression is added (append to the baseline table).
- A previously-suppressed finding becomes fixable at the source (remove the
  suppression and note the retirement here).
