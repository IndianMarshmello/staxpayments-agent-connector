# Security policy

## Reporting a vulnerability

Report vulnerabilities through a private GitHub security advisory:

<https://github.com/IndianMarshmello/staxpayments-agent-connector/security/advisories/new>

Don't open a public issue, and don't describe the problem in a pull request, a commit message, or anywhere else public until a fix is out.

Include in your report:

- The version or commit you tested.
- Your setup in broad strokes: single or multiple accounts, writes on or off. Never include API keys, account aliases, customer data, or transaction details.
- Steps to reproduce and the impact you see.

This connector handles merchant API keys and can move money when writes are enabled. The highest-impact reports are bugs that expose keys, bypass the write gates, or send one account's request to another account's credentials.

## What to expect

This is a volunteer-maintained project with no guaranteed response time. A maintainer will review the advisory when time allows, coordinate a fix, and credit you in the release notes if you'd like. If it goes quiet and the issue is urgent, add a comment inside the advisory to nudge it. Please keep the whole thread private until a fix ships.

## Scope notes

The connector runs locally on your machine, does not persist API responses, and opens no network listeners. Credentials live in your environment or local configuration. Keep them out of shell history, screenshots, model conversations, and issue reports.

Response redaction hides credential fields and the configured API key, but customer names, emails, and other merchant data stay visible to your AI client by design. Redaction is not PII anonymization. Treat whatever your AI client can see as visible to its provider, and keep writes disabled unless you're actively using them.
