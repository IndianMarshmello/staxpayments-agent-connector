import ky, { HTTPError } from "ky";
import { z } from "zod";
import type { AccountConfig } from "./config";

export class StaxError extends Error {
	readonly name = "StaxError";

	constructor(
		readonly code: string,
		message: string,
		readonly status?: number,
		readonly retryAfter?: string,
	) {
		super(message);
	}
}

// Never return gateway credentials or raw payment credentials to the model.
const secretField = /^(authorization|proxyauthorization|(?:x)?apikey|apisecret|password|secret|clientsecret|token|accesstoken|refreshtoken|bearertoken|cardnumber|creditcard(?:number)?|ccnumber|pan|cvv2?|cvc2?|cardcvv2?|cardcvc2?|securitycode|bankaccount(?:number)?|accountnumber|bankrouting(?:number)?|routingnumber|iban|paymenttoken)$/i;

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

function redactText(value: string, apiKey: string): string {
	return value
		.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
		.replaceAll(apiKey, "[REDACTED]");
}

function redact(value: JsonValue, apiKey: string): JsonValue {
	if (typeof value === "string") {
		return redactText(value, apiKey);
	}
	if (Array.isArray(value)) return value.map((item) => redact(item, apiKey));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				redactText(key, apiKey),
				secretField.test(key.replace(/[-_\s]/g, "")) ? "[REDACTED]" : redact(item, apiKey),
			]),
		);
	}
	return value;
}

export type ApiRequest = {
	readonly method: "GET" | "POST";
	readonly path: string;
	readonly query?: Readonly<Record<string, string | number | undefined>>;
	readonly body?: Readonly<Record<string, unknown>>;
};

export class StaxClient {
	private readonly http;

	constructor(
		private readonly config: AccountConfig,
		// Programmatic override for local integration tests; CLI always uses Stax.
		baseUrl = "https://apiprod.fattlabs.com",
	) {
		this.http = ky.create({
			prefixUrl: baseUrl,
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			// The request deadline below also covers consumption of the response body.
			timeout: false,
			retry: 0,
			redirect: "error",
		});
	}

	async request(request: ApiRequest): Promise<JsonValue> {
		if (request.method !== "GET" && !this.config.enableWrites) {
			throw new StaxError("WRITES_DISABLED", "Writes are disabled for this account. Check STAX_ENABLE_WRITES and its enableWrites setting.");
		}
		const searchParams = new URLSearchParams();
		for (const [key, value] of Object.entries(request.query ?? {})) {
			if (value !== undefined) searchParams.set(key, String(value));
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const response = await this.http(request.path, {
				method: request.method,
				searchParams,
				signal: controller.signal,
				...(request.body === undefined ? {} : { json: request.body }),
			});
			if (response.status === 204) return null;
			// Bun's Response.json() can resolve an empty body as null; only 204 is empty success.
			const body: unknown = JSON.parse(await response.text());
			const parsed = z.json().safeParse(body);
			if (!parsed.success) throw new StaxError("INVALID_RESPONSE", "Stax returned invalid JSON.");
			return redact(parsed.data, this.config.apiKey);
		} catch (error) {
			if (error instanceof StaxError) throw error;
			if (error instanceof HTTPError) {
				const retryAfter = error.response.headers.get("retry-after");
				const retryDate = Date.parse(retryAfter ?? "");
				const safeRetryAfter = retryAfter && (
					/^\d+$/.test(retryAfter)
					|| (Number.isFinite(retryDate) && new Date(retryDate).toUTCString() === retryAfter)
				) ? retryAfter : undefined;
				throw new StaxError(
					"STAX_HTTP_ERROR",
					`Stax returned HTTP ${error.response.status}. Check permissions and request fields; reconcile transactions before retrying writes.`,
					error.response.status,
					safeRetryAfter,
				);
			}
			if (controller.signal.aborted) {
				throw new StaxError("TIMEOUT", "Stax request timed out. A write may have completed; reconcile before retrying.");
			}
			if (error instanceof SyntaxError) {
				throw new StaxError("INVALID_RESPONSE", "Stax returned a non-JSON response.");
			}
			// Bun also throws ordinary Errors (ConnectionRefused, UnexpectedRedirect, etc.).
			// Never expose a native message, request URL, or upstream error as a cause.
			throw new StaxError("NETWORK_ERROR", "Stax connection failed. A write may have completed; reconcile before retrying.");
		} finally {
			clearTimeout(timeout);
		}
	}
}
