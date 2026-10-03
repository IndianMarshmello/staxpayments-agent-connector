# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-03

First public release.

### Added

- Local stdio MCP server for Stax Payments merchant accounts, built on the official MCP SDK.
- 13 tools: 8 read and session tools available by default, plus 5 write tools (create customer, charge, capture, refund, void) gated behind opt-in flags.
- Multiple accounts through `STAX_ACCOUNTS`, with per-account write control, a configurable default account, and per-call `account_id` overrides.
- Single-account mode through `STAX_API_KEY` for simple setups.
- Date-filter guard on `stax_list_transactions`: when `start_date` or `end_date` is set, every returned row's `created_at` date is verified against the requested range. Rows outside the range fail with `FILTER_NOT_APPLIED`; rows with invalid or missing dates fail with `INVALID_RESPONSE`. The guard validates one page at a time, and upstream totals are not guaranteed date-scoped, so reports should fetch and validate every page. The documented fallback is to request pages without date filters and filter locally; pagination is unchanged.
- Recursive redaction of credential fields and the configured API key in every response.
- Strict per-request timeouts via `STAX_TIMEOUT_MS`, no automatic retries, redirects refused.
- Test suite using local HTTP fixtures and the real MCP protocol, including a stdio subprocess, run under `--no-env-file` so a private `.env` never participates. No credentials required.
