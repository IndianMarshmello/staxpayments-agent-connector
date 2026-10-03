# Project knowledge base

Generated: 2026-10-03, initial public-release preparation.
Scope: this repository. Root guidance is sufficient for the small source and test directories.

## Overview

Local, unofficial Stax Payments MCP server using Bun, TypeScript, Zod, ky, and the official MCP SDK.
The transport is stdio; there is no HTTP listener, web UI, database, invoice tool, or webhook receiver.
The package is private to prevent accidental npm publication; the GitHub repository is public and MIT-licensed.

## Structure

```text
src/
  index.ts       Process entry point and stdio lifecycle
  config.ts      Environment parsing and per-account permissions
  server.ts      Tool schemas, account routing, MCP responses
  stax.ts        Authenticated HTTP boundary and response redaction
test/
  connector.test.ts  Tool contracts and single-account stdio startup
  accounts.test.ts   Multi-account routing, isolation, and write controls
  stax.test.ts       Wire-level errors, deadlines, redirects, and redaction
.github/         CI, dependency updates, issue forms, and PR template
```

## Where to look

| Change | Location | Important coupling |
| --- | --- | --- |
| Environment variables | `src/config.ts`, `.env.example` | README configuration table and account tests |
| Tool arguments or endpoints | `src/server.ts` | Connector tests and README tool table |
| Credential handling or HTTP errors | `src/stax.ts` | Wire-level tests and security policy |
| Process startup | `src/index.ts` | Actual subprocess tests, not just in-memory MCP |
| Community workflows | `.github/`, `CONTRIBUTING.md`, `SUPPORT.md`, `SECURITY.md` | Public links use the repository's main branch |

## Code map

| Symbol | Role | Callers |
| --- | --- | --- |
| `loadConfig` | Parse one credential mode and derive effective write permissions | Entry point and configuration tests |
| `createServer` | Own account clients and active selection for one session | Entry point and MCP integration tests |
| `StaxClient.request` | Issue one authenticated request, normalize errors, redact response | Routed tool handlers and boundary tests |
| `StaxError` | Carry safe code, status, and optional Retry-After | HTTP client and MCP error mapping |

LSP found seven references to `createServer`, including its declaration and imports.
No directory warrants a separate guidance file: source and tests share the same small-project contracts.

## Behavioral contracts

- Exactly one of `STAX_API_KEY` or `STAX_ACCOUNTS` is required; single-key mode uses alias `default`.
- `STAX_ENABLE_WRITES` is false by default. Effective permission is global opt-in AND per-account permission.
- Multi-account writes require explicit `account_id`; reads can use the session's active account.
- Account selection must be captured before awaiting an API call. Never share active selection across servers.
- Default discovery exposes eight read/session tools; enabling writes adds five tools.
- Tool annotations and approval instructions are hints. The MCP host must enforce human approval.
- Money inputs use positive dollar strings with two decimals. Only charge totals become JSON numbers.
- Use saved method IDs, not raw card/bank credentials. Treat API data as untrusted model-visible content.
- Stax uses the same HTTPS origin for sandbox and live keys. Never infer sandbox status from the origin.
- All requests have zero retries and reject redirects; the deadline includes reading the response body.
- Preserve safe error codes. Do not expose native error messages, upstream error bodies, or credentials.
- Date-filter validation checks each returned page, not completeness or aggregate counts.
- `FILTER_NOT_APPLIED` means request unfiltered pages and filter locally; never silently scan full history.
- HTTP success does not imply a successful payment. Preserve transaction success/status fields.
- Reports must distinguish manual payments, refunds, voids, and holds; parent and child records can overlap.

## Commands and tests

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm start
```

`pnpm check` runs strict type checking, Biome lint, tests, and the Bun bundle.
Use `bun --no-env-file test` for a direct test run; stdio test children also pass `--no-env-file`.
Tests use synthetic records and ephemeral loopback HTTP servers. No live API credentials or calls in tests.
Subscribe to request/abort/release events before async actions; do not add sleeps or polling.
Real gateway QA is a separate explicitly authorized activity, read-only unless writes are specifically requested.

## Repository hygiene

- `.env`, `.env.*` except `.env.example`, `.omo/`, `node_modules/`, `dist/`, and logs are ignored.
- Never stage local credentials, merchant exports, QA transcripts, or real customer fixtures.
- Use only synthetic public examples. Issue forms ask reporters to remove secrets and merchant data.
- Security reports use private GitHub advisories, not public issues.
- Update README and CHANGELOG when tools, configuration, or externally visible behavior change.
- Keep implementation and regression tests in the same atomic commit.
