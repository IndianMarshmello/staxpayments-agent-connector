# Contributing

Thanks for considering a contribution. This is an independent, unofficial connector for the Stax Payments API, maintained by volunteers. Help is welcome, and a little structure keeps it safe to accept.

## Ground rules

- Never commit API keys, real account aliases, customer data, or transaction details. Tests and docs use placeholders only.
- Tests run against local fixtures. No test may call the live Stax API or require credentials.
- Keep changes focused. One behavior per pull request beats a grab bag.
- New write tools, or any change to how money moves, need an issue first. The safety model gets agreed on before code arrives.

## Set up

Requires Bun 1.3.14+ and pnpm 11, pinned to 11.5.1 through the `packageManager` field. pnpm itself runs on Node, so keep Node 24 available for package tooling.

```sh
git clone https://github.com/IndianMarshmello/staxpayments-agent-connector.git
cd staxpayments-agent-connector
pnpm install
```

## Verify your change

```sh
pnpm check
```

This runs strict type checking, Biome lint, the Bun test suite, and a bundled build. All four must pass before you open a pull request. The tests use a local HTTP fixture and the real MCP client/server protocol, including a stdio subprocess. They run with Bun's `--no-env-file` flag, so a private `.env` in your checkout never participates. If you invoke the suite directly, use `bun --no-env-file test`.

If your change touches live behavior, say so in the PR and describe what you verified against a Stax sandbox account. Local test success doesn't establish live gateway behavior.

## Project layout

- `src/config.ts`: environment parsing and account validation
- `src/stax.ts`: Stax HTTP client, redaction, error mapping
- `src/server.ts`: tool registration, schemas, permission checks
- `src/index.ts`: stdio entry point
- `test/`: Bun tests, no credentials needed

## Style

Run `pnpm lint` for Biome lint checks. Use the formatting settings in `biome.json` when editing code. Match the existing code: strict Zod schemas, no silent fallbacks, errors returned as structured MCP errors. Use synthetic examples in tests and docs.

## Pull requests

Fill in the PR template and keep the diff reviewable. Update [CHANGELOG.md](CHANGELOG.md) under Unreleased, and update the README whenever tools, environment variables, or behavior change. Review happens when a maintainer has time; there's no guaranteed turnaround, but a complete template gets a faster look.
