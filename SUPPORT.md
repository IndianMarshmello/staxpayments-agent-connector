# Support

## Where to ask

- **Something's broken:** open a [bug report](https://github.com/IndianMarshmello/staxpayments-agent-connector/issues/new?template=bug_report.yml). Check the README's configuration reference and date-filter notes first; both explain behavior people often mistake for bugs.
- **You want a feature:** open a [feature request](https://github.com/IndianMarshmello/staxpayments-agent-connector/issues/new?template=feature_request.yml).
- **Security concern:** use a private GitHub security advisory as described in [SECURITY.md](SECURITY.md). Never file these publicly.
- **Questions about the Stax API, your keys, billing, or your merchant account:** those belong to Stax. Start with the [Stax documentation](https://docs.staxpayments.com/) and Stax's own support channels. This project can't see your account and can't change anything on Stax's side.

## What to expect

This is an independent, unofficial project maintained by volunteers. There's no support contract and no promised response time. Clear reports get better answers: include your connector version, your AI client, what you tried, and what happened, with secrets and customer data removed.

Before filing, it's worth a minute to:

1. Confirm your setup against the README's configuration reference. Most startup failures are a mistyped or conflicting environment variable.
2. Run `pnpm check` if you're building from source.
3. Try a read-only call first when writes are involved. It separates "can't reach Stax" from "writes are blocked".
