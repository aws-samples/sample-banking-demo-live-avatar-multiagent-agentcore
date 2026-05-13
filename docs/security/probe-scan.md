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
- `.env.production` is regenerated locally by `npm run kit -- refresh-frontend`
  and must not be re-added to git.

## When to update this doc

- A new ProbeScan baseline is taken (replace the timestamped reference).
- A new suppression is added (append to the baseline table).
- A previously-suppressed finding becomes fixable at the source (remove the
  suppression and note the retirement here).
