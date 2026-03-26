# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AWS Marketing Demo Starter Kit — a full-stack CDK + React template for building secure, compliant AWS demos with Cognito/Federate authentication. Built by AWS Marketing Demo Engineering. Currently at version 5.0.0 with placeholder project identifiers (needs configuration via `cdk.json`).

## Common Commands

```bash
npm install                      # Install all deps (also sets up Python venv via uv, installs ruff)
npm run kit                      # Interactive CLI for all operations (credentials, deploy, destroy, etc.)
npm run kit -- deploy [stage] --all   # Deploy all stacks headlessly
npm run kit -- synth [stage]          # Synthesize + cdk-nag validation
npm run kit -- hotswap [stage] --all  # Fast Lambda/asset deployment
npm run kit -- destroy [stage]        # Destroy stacks (interactive selection)
npm run build                    # TypeScript compilation (tsc)
npm run test                     # Jest tests (from test/ directory)
npm run lint                     # ESLint + ruff check
npm run format                   # Prettier + ruff format
npm run commit                   # Interactive conventional commit (commitizen)
npm run -w frontend dev          # Vite dev server on :3000
npm run -w frontend build        # Build frontend (tsc -b && vite build)
npm run cdk -- <command>         # Direct CDK CLI (pinned to 2.1108.0)
```

## Architecture

### CDK 3-Stack Pattern

```
bin/app.ts → lib/stage.ts (ApplicationStage)
  ├── Frontend         — S3 + CloudFront (OAC) + WAF (CloudFront scope)
  ├── Auth             — Cognito User Pool/Client/Identity Pool + WAF (Regional scope)
  └── FrontendDeployment — CodeBuild builds React app in-cloud, deploys to S3
```

**Deployment order**: Frontend + Auth deploy in parallel; FrontendDeployment must be last (consumes cross-stack env vars from Auth via `environmentVariables` passed through `stage.ts`).

**Stack naming**: `{stage}/{projectId}-{StackId}` — the custom `Stack` base class (`lib/common/constructs/stack.ts`) auto-prefixes with `projectId` from `cdk.json`.

### Property Injectors (Blueprints)

Applied globally via `App({ propertyInjectors })` in `bin/app.ts`. Never duplicate these configs per-construct:

- **LogGroupInjector**: 3-month retention, DESTROY removal
- **FunctionLogGroupInjector**: Auto-creates LogGroup per Lambda
- **FunctionPlatformInjector**: ARM64 architecture, Node.js 22.x / Python 3.12 runtimes
- **BucketInjector**: Block all public access, enforce SSL, auto-delete + DESTROY removal

Note: `FunctionPlatformInjector` is NOT in the global list — it's selectively applied (e.g., to WAF ACL constructs via `PropertyInjectors.of()`).

### Frontend App

React 19 + Vite + TypeScript with CloudScape Design System, Tailwind v4, Framer Motion, Zustand. Authentication via Amplify libraries with Cognito. The app workspace is at `lib/stacks/frontend/app/`.

Environment variables are injected via CodeBuild at deploy time (prefixed with `VITE_`). For local dev, `npm run kit -- refresh-frontend [stage]` generates a `.env` file from deployed CloudFormation outputs.

### Kit CLI

`tools/kit.ts` — interactive and headless modes. AWS profile naming: `{stage}-{projectId}`. Supports multiple credential methods (AWS Developer Account, Isengard, IAM Identity Center, etc.).

### Export CLI

`tools/export.ts` — processes `@export` directives in source files to strip internal/sensitive code before sharing. Directives like `// @export {"deleteLines": N}` and `<!-- @export {"deleteFile": true} -->` appear throughout the codebase — do not remove them.

## Configuration

All CDK config lives in `cdk.json` context:

- `projectId`: Resource naming prefix (< 15 chars, no `aws`/`amazon`/`cognito`)
- `accounts`: Stage → `{ id, region, midway?, prod? }` mapping
- `midway: true`: Enables Federate/Midway auth for that stage

## Key Conventions

- **cdk-nag**: `AwsSolutionsChecks` applied to the entire stage in `lib/stage.ts`. Suppressions are colocated with constructs.
- **Federate constructs**: `FederateUserPool`/`FederateUserPoolClient` in `lib/common/constructs/federate/` wrap standard Cognito constructs with Midway support. Replace with standard constructs for public distribution.
- **Monorepo workspaces**: Frontend is an npm workspace (`lib/stacks/frontend/app`). Use `-w frontend` for frontend-specific commands.
- **Pre-commit hooks**: Husky + lint-staged runs Prettier/ESLint on TS and ruff on Python for staged files.
- **Tests**: Jest with ts-jest, test files in `test/` matching `**/*.test.ts`.
- **File organization**: Group by stack, then construct/component. `common/` only for code imported by 2+ files. Collocate related files.
- **Named imports, destructuring props, intermediate constructor variables** — assign to `this.*` at end of constructor.
