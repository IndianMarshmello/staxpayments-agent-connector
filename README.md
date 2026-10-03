# Stax Payments MCP connector

A local, multi-account MCP server that lets AI clients work with Stax Payments merchant accounts over **stdio**, including Claude Desktop and Cursor. Built with TypeScript, Bun, and the official MCP SDK. No hosted service, no model API key.

This is an independent, unofficial community project. It isn't affiliated with, endorsed by, or supported by Stax Payments, and it comes with no warranty or support agreement. See [SUPPORT.md](SUPPORT.md) for where to get help.

Repository: <https://github.com/IndianMarshmello/staxpayments-agent-connector>

## What you get

13 tools in total:

- **8 read and session tools, on by default:** discover and switch accounts, find customers, list saved payment methods, and read transactions.
- **5 write tools, hidden until you opt in:** create customers, charge saved payment methods, capture, refund, and void.

This version deliberately omits: invoices, payment links, sending money or payouts, recurring schedule management, raw card or bank tokenization, and webhooks. There's no generic API request tool and no hosted variant either. Missing something? Open a feature request; the safety model gets discussed before any new money-moving tool lands.

## Setup

Requires Bun 1.3.14+ and pnpm 11, pinned to 11.5.1 through the `packageManager` field. pnpm itself runs on Node, so keep Node 24 available for package tooling.

```sh
git clone https://github.com/IndianMarshmello/staxpayments-agent-connector.git
cd staxpayments-agent-connector
pnpm install
export STAX_API_KEY='your-merchant-api-key'
pnpm start
```

The process waits for MCP messages on stdin; it is not an interactive terminal prompt. Standard output is reserved for protocol messages.

Create a **Merchant API key** in Stax Pay under Apps > API Keys. Start with a sandbox account's key. Stax uses `https://apiprod.fattlabs.com` for both sandbox and live accounts; the key determines which account and gateway are used. The connector cannot determine whether a key is sandbox or live, so treat every key as live until you've confirmed otherwise.

### Connect your AI client

Add this entry to the client's MCP server configuration. Use absolute paths everywhere: desktop clients don't inherit your shell's PATH or working directory, so a bare `bun` or a relative path may not resolve. Run `which bun` to find the binary's full path.

```json
{
  "mcpServers": {
    "staxpayments": {
      "command": "/absolute/path/to/bun",
      "args": ["run", "/absolute/path/staxpayments-agent-connector/src/index.ts"],
      "env": {
        "STAX_API_KEY": "your-merchant-api-key",
        "STAX_ENABLE_WRITES": "false",
        "STAX_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

Restart the client. Ask: "Find the Stax customer with email alex@example.com", then "List that customer's saved payment methods and recent transactions."

Environment variables can also go in a local `.env` file when launching from this directory with Bun; `.env.example` shows the available settings. Do not commit keys or paste them into model conversations.

### Multiple Stax accounts

Use `STAX_ACCOUNTS` instead of `STAX_API_KEY`. Supply a JSON array with a unique local `id` and merchant `apiKey` for each account:

```sh
unset STAX_API_KEY
export STAX_ACCOUNTS='[{"id":"east","apiKey":"east-merchant-key"},{"id":"west","apiKey":"west-merchant-key","enableWrites":false}]'
export STAX_DEFAULT_ACCOUNT='east'
pnpm start
```

For a desktop MCP client, replace its `env` object with:

```json
{
  "STAX_ACCOUNTS": "[{\"id\":\"east\",\"apiKey\":\"east-merchant-key\"},{\"id\":\"west\",\"apiKey\":\"west-merchant-key\",\"enableWrites\":false}]",
  "STAX_DEFAULT_ACCOUNT": "east",
  "STAX_ENABLE_WRITES": "false"
}
```

Account IDs are case-sensitive local aliases (1-64 letters, numbers, underscores, or hyphens, starting with a letter or number), not Stax merchant IDs. The key determines the merchant. If no default is specified, the first configured account is selected. Setting both key variables, duplicate IDs, or an unknown default fails startup. Legacy `STAX_API_KEY` creates one account named `default`.

The agent can:

1. Call `stax_list_accounts` with `{}` to discover aliases, write permissions, and the active account. Keys are never returned.
2. Call `stax_select_account` with `{"account_id":"west"}` to switch the default for subsequent reads.
3. Pass `account_id` directly to any Stax data tool to override the default without changing it.

For example, compare transactions by calling `stax_list_transactions` once with `{"account_id":"east","start_date":"2026-10-01"}` and once with `{"account_id":"west","start_date":"2026-10-01"}`. These calls can run concurrently. Each response includes `account_id`; paginate each account independently. There is no combined cross-account pagination or aggregate endpoint; the agent combines the labeled results.

Selection is local to the running server session and resets on restart. A call captures its account before making its request, so switching does not redirect in-flight work. Use explicit account IDs for parallel workflows. Unknown IDs fail without falling back to another account. A failed call for one account does not prevent another account from succeeding.

Every caller connected to this MCP process can access all configured accounts. Account selection is not user authorization; run separate server processes with separate configurations for users who should see different merchants.

## Configuration reference

Set exactly one of `STAX_API_KEY` or `STAX_ACCOUNTS`. Anything invalid stops startup with a configuration error; nothing is guessed or silently repaired.

| Variable | Default | Meaning |
| --- | --- | --- |
| `STAX_API_KEY` | none | Single-account mode: one merchant API key, exposed locally as account `default`. Mutually exclusive with `STAX_ACCOUNTS`. |
| `STAX_ACCOUNTS` | none | JSON array of `{"id":"...","apiKey":"...","enableWrites":true|false}`. IDs are unique local aliases, 1-64 characters: letters, numbers, `_`, `-`, starting with a letter or number. `enableWrites` is optional and defaults to `true`. |
| `STAX_DEFAULT_ACCOUNT` | first configured account | Which account is active at startup. Must match a configured ID. |
| `STAX_ENABLE_WRITES` | `"false"` | Global write switch, exactly `"true"` or `"false"`. A write needs both this and the account's `enableWrites`. |
| `STAX_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds, an integer from 1 to 120000. |

Setting both key variables, setting neither, duplicate IDs, empty keys, or an unknown default all fail at startup.

## Tools

| Tool | Stax endpoint | Availability |
| --- | --- | --- |
| `stax_list_accounts` | Local account registry | Default |
| `stax_select_account` | Local session selection | Default |
| `stax_list_customers` | `GET /customer` | Default |
| `stax_get_customer` | `GET /customer/{id}` | Default |
| `stax_list_payment_methods` | `GET /customer/{id}/payment-method` | Default |
| `stax_get_payment_method` | `GET /payment-method/{id}` | Default |
| `stax_list_transactions` | `GET /transaction` | Default |
| `stax_get_transaction` | `GET /transaction/{id}` | Default |
| `stax_create_customer` | `POST /customer` | Writes enabled |
| `stax_charge_payment_method` | `POST /charge` | Writes enabled |
| `stax_capture_transaction` | `POST /transaction/{id}/capture` | Writes enabled |
| `stax_refund_transaction` | `POST /transaction/{id}/refund` | Writes enabled |
| `stax_void_transaction` | `POST /transaction/{id}/void` | Writes enabled |

Tool schemas expose the supported fields. Lists return one page at a time; request more pages with `page`, using the pagination metadata in each response. Transaction pages allow 1-200 records (`per_page`, default 50). A customer's payment methods are not paginated. There is no cross-account pagination or aggregation; every response is labeled with its `account_id`.

### Date filters

`stax_list_transactions` accepts `start_date` and `end_date` (`YYYY-MM-DD`, and `start_date` must not follow `end_date`). Live testing has shown that Stax sometimes ignores these filters, so the connector validates each page it returns: if any transaction's `created_at` date falls outside the requested range, the call fails with a `FILTER_NOT_APPLIED` error instead of handing you a misleading page. Rows with invalid or missing dates fail with `INVALID_RESPONSE` for the same reason.

The guard has limits worth understanding. It validates one page at a time, so it can't prove anything about pages you didn't fetch, and Stax's pagination totals are never guaranteed to be date-scoped, whether or not the current page passed. For anything report-shaped, fetch every page, keep the original pagination, and check every row before you aggregate. Never read the upstream totals as filtered counts.

If a call fails with `FILTER_NOT_APPLIED`, don't retry the same filtered call. Request pages without the date filters and filter locally on your side; pagination works identically either way, so no data is lost. The connector never scans ahead, retries, or walks your full history on its own.

### Enable writes

Set `STAX_ENABLE_WRITES=true` and restart. This global switch is required for every write. An account's optional `enableWrites:false` blocks that account's writes on top of the global switch; `enableWrites` defaults to true, but it can never switch writes on while the global switch is off. Write tools are advertised only when at least one account permits writes, and permissions are checked again on every call.

With multiple accounts configured, every write call needs an explicit `account_id`, even after selecting an active account. With one account, it stays optional.

**Approvals are the host's job, not this server's.** MCP tool annotations like `destructiveHint` are hints for the client, not an authorization boundary. The connector never prompts; once writes are enabled, any caller that can reach the process can invoke them directly. Configure your AI client to require human approval for every financial action, including which account it targets.

### Payment semantics worth knowing

- **HTTP success is not payment success.** A 200 from Stax means the request was accepted. Inspect the returned transaction's `success` flag, its status, and its child transactions before treating a payment as done. The same goes for refunds and captures: check the resulting child transaction, not just the response code.
- **Transactions are not all processed revenue.** Stax Pay lets merchants record payments manually, and those records show up in transaction lists next to gateway-processed charges. Don't sum a transaction list and call it revenue; check each row's type, method, and success fields first.
- **Amounts are decimal dollar strings.** `"10.25"` means $10.25, never `1025` cents. The connector converts charge totals to JSON numbers and sends capture/refund totals as strings, matching the endpoint schemas. The charge page's prose mentions smallest currency units, but its OpenAPI `total` field explicitly specifies dollars and cents; this connector follows that schema.
- **Idempotency is on you.** Supply a stable `idempotency_id` for each intended charge and reuse it only when reconciling or retrying that same charge. Capture, refund, void, and customer creation claim no idempotency guarantees, and no request is automatically retried.
- **Refunds and voids have preconditions.** Check `is_refundable` or `is_voidable` first. Stax decides eligibility and the remaining refundable amount. A refund appears as a child transaction of the original; verify its status. Sandbox refunds may need to wait until settlement.

Payment tools accept **saved Stax payment method IDs only**. Collect and tokenize new payment credentials through Stax.js or another appropriate Stax integration, outside the model conversation. Raw card and bank account inputs are not supported.

Example charge tool arguments, after the user approves the account, customer, method, and amount (replace `east` with your configured alias):

```json
{
  "account_id": "east",
  "payment_method_id": "129520d1-3844-45fd-a0b1-afb66bcdc74c",
  "total": "10.25",
  "pre_auth": false,
  "idempotency_id": "order-1042-payment-1",
  "meta": {
    "transaction_initiation_type": "CIT",
    "transaction_schedule_type": "unscheduled"
  }
}
```

Use `pre_auth: true` for a hold, then capture the returned transaction ID. A timeout or network error can leave a write's outcome unknown: inspect the transaction history for that same account before resubmitting, and preserve the charge idempotency key.

## Errors and data handling

Successful data tools return `{account_id, data}` in text content and structured content, preserving Stax JSON and pagination under `data`. Account tools return local metadata. Selected credential fields and occurrences of the request's API key are redacted recursively. Customer names, emails, addresses, notes, and other merchant data remain visible to the AI client; redaction is not full PII anonymization.

Failures return `isError: true` with the account ID, a JSON error code, message, HTTP status when available, and `retry_after` when supplied by Stax. Local guard failures such as `FILTER_NOT_APPLIED` use the same shape. Schema validation failures are returned by the MCP SDK before any HTTP call. Raw upstream error bodies are not exposed. Rate limits are returned to the caller without retries.

The CLI only connects to the documented HTTPS origin and refuses redirects. There is no generic API request tool, inbound HTTP listener, partner onboarding, invoice management, recurring schedule management, raw tokenization, or webhook receiver in this version.

## Development

```sh
pnpm check
```

Runs strict type checking, Biome lint, the Bun test suite, and a bundled build (`dist/index.js`, runnable with Bun). Tests execute with Bun's `--no-env-file` flag, including the stdio subprocess tests, so a private `.env` in your checkout can never leak into a test run. The suite uses a local HTTP fixture and the actual MCP client/server protocol; it needs no credentials and moves no money. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

Live sandbox verification requires your Stax key: start read-only, find a known customer, retrieve its payment methods, and compare a known transaction with Stax Pay. Only then enable writes and approve a small sandbox charge; inspect the transaction before testing capture, void, or refund. Local test success does not establish live gateway behavior.

## Project docs

- [CHANGELOG.md](CHANGELOG.md): release notes
- [CONTRIBUTING.md](CONTRIBUTING.md): development workflow and ground rules
- [SECURITY.md](SECURITY.md): report vulnerabilities privately
- [SUPPORT.md](SUPPORT.md): where to get help

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Amaan Zaidi.

## API references

Implementation checked against Stax documentation on 2026-10-03:

- [API overview and authentication](https://docs.staxpayments.com/reference/overview)
- [Merchant API keys](https://docs.staxpayments.com/reference/merchant-api-keys)
- [Customers](https://docs.staxpayments.com/reference/find-all-customers)
- [Create customer](https://docs.staxpayments.com/reference/create-customer)
- [Customer payment methods](https://docs.staxpayments.com/reference/get-all-payment-methods-for-a-customer)
- [Transactions](https://docs.staxpayments.com/reference/list-and-filter-all-transactions)
- [Charge](https://docs.staxpayments.com/reference/charge-a-payment-method)
- [Capture](https://docs.staxpayments.com/reference/capture-a-pre-auth-transaction)
- [Refund](https://docs.staxpayments.com/reference/refund-transaction)
- [Void](https://docs.staxpayments.com/reference/void-transaction)
