import { afterEach, describe, expect, test } from "bun:test";
import type { AccountConfig } from "../src/config";
import { type JsonValue, StaxClient, StaxError } from "../src/stax";

const config: AccountConfig = {
	apiKey: "fixture-api-secret",
	enableWrites: true,
	timeoutMs: 1000,
};
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(
	handler: (request: Request) => Response | Promise<Response>,
	options: AccountConfig = config,
) {
	const requests: Request[] = [];
	const http = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			requests.push(request);
			return handler(request);
		},
	});
	cleanups.push(() => http.stop(true));
	return {
		http,
		requests,
		api: new StaxClient(options, http.url.toString()),
	};
}

async function failure(pending: Promise<JsonValue>): Promise<StaxError> {
	const error: unknown = await pending.then(() => undefined, (error: unknown) => error);
	expect(error).toBeInstanceOf(StaxError);
	if (!(error instanceof StaxError)) throw new TypeError("Expected a StaxError");
	return error;
}

describe("HTTP response contracts", () => {
	const payloads: JsonValue[] = [null, false, 0, "ok", [1, null], { success: false, data: [], current_page: 2 }];
	test.each(payloads.map((payload) => ({ payload })))(
		"preserves valid JSON %j",
		async ({ payload }) => {
			// Given
			const { api } = fixture(() => Response.json(payload));
			// When / Then
			expect(await api.request({ method: "GET", path: "customer" })).toEqual(payload);
		},
	);

	test("returns null for a no-content response", async () => {
		// Given
		const { api } = fixture(() => new Response(null, { status: 204 }));
		// When / Then
		expect(await api.request({ method: "POST", path: "transaction/void" })).toBeNull();
	});

	test.each(["", " ", "<html>fixture-api-secret</html>", '{"secret":"fixture-api-secret"', "1e400"])(
		"rejects invalid successful JSON without leaking its body: %j",
		async (body) => {
			// Given
			const { api, requests } = fixture(() => new Response(body));
			// When
			const error = await failure(api.request({ method: "GET", path: "customer" }));
			// Then
			expect(error.code).toBe("INVALID_RESPONSE");
			expect(error.message).not.toContain(config.apiKey);
			expect(JSON.stringify(error)).not.toContain(config.apiKey);
			expect(error.cause).toBeUndefined();
			expect(requests).toHaveLength(1);
		},
	);

	test("blocks writes before opening a connection", async () => {
		// Given
		const { api, requests } = fixture(() => Response.json({}), { ...config, enableWrites: false });
		// When
		const error = await failure(api.request({ method: "POST", path: "charge", body: {} }));
		// Then
		expect(error.code).toBe("WRITES_DISABLED");
		expect(requests).toHaveLength(0);
	});

	test("sends authentication, encoded query values, and JSON bodies", async () => {
		// Given
		const { api } = fixture(async (request) => Response.json({
			method: request.method,
			query: Object.fromEntries(new URL(request.url).searchParams),
			body: await request.json(),
			authenticated: request.headers.get("authorization") === `Bearer ${config.apiKey}`,
			accept: request.headers.get("accept"),
			contentType: request.headers.get("content-type"),
		}));
		// When
		const result = await api.request({
			method: "POST",
			path: "customer",
			query: { email: "a+b@example.com", page: 2, absent: undefined },
			body: { email: "a+b@example.com" },
		});
		// Then
		expect(result).toEqual({
			method: "POST", query: { email: "a+b@example.com", page: "2" },
			body: { email: "a+b@example.com" }, authenticated: true,
			accept: "application/json", contentType: "application/json",
		});
	});
});

describe("sanitized failures without retries", () => {
	test.each([401, 422, 429, 500, 503])("sanitizes HTTP %i without retrying reads", async (status) => {
		// Given
		const { api, requests } = fixture(() => new Response(config.apiKey, {
			status, headers: { "Retry-After": "15" },
		}));
		// When
		const error = await failure(api.request({ method: "GET", path: "customer" }));
		// Then
		expect(error.code).toBe("STAX_HTTP_ERROR");
		expect(error.status).toBe(status);
		expect(error.retryAfter).toBe("15");
		expect(error.message).not.toContain(config.apiKey);
		expect(error.cause).toBeUndefined();
		expect(requests).toHaveLength(1);
	});

	test.each(["15", "Wed, 21 Oct 2015 07:28:00 GMT", `Bearer ${config.apiKey}`, "card_number=4111111111111111"])(
		"only exposes valid Retry-After values: %s",
		async (retryAfter) => {
			// Given
			const { api } = fixture(() => new Response(config.apiKey, {
				status: 429, headers: { "Retry-After": retryAfter },
			}));
			// When
			const error = await failure(api.request({ method: "POST", path: "charge" }));
			// Then
			expect(error.retryAfter).toBe(
				retryAfter === "15" || retryAfter.startsWith("Wed,") ? retryAfter : undefined,
			);
			expect(JSON.stringify(error)).not.toContain(config.apiKey);
			expect(JSON.stringify(error)).not.toContain("4111111111111111");
		},
	);

	test("normalizes Bun connection refusal instead of leaking native errors", async () => {
		// Given
		const { http, api } = fixture(() => Response.json({}));
		await http.stop(true);
		// When
		const error = await failure(api.request({ method: "GET", path: `customer?secret=${config.apiKey}` }));
		// Then
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.message).not.toContain(config.apiKey);
		expect(error.cause).toBeUndefined();
	});

	test.each([301, 302, 303, 307, 308])("refuses HTTP %i without contacting the redirect target", async (status) => {
		// Given
		const target = fixture(() => Response.json({}));
		const source = fixture(() => new Response(config.apiKey, {
			status, headers: { Location: target.http.url.toString() },
		}));
		// When
		const error = await failure(source.api.request({
			method: "POST", path: `charge?secret=${config.apiKey}`, body: { payment_method_id: "saved-id" },
		}));
		// Then
		expect(error.code).toBe("NETWORK_ERROR");
		expect(error.message).not.toContain(config.apiKey);
		expect(error.cause).toBeUndefined();
		expect(source.requests).toHaveLength(1);
		expect(target.requests).toHaveLength(0);
	});
});

describe("credential redaction", () => {
	test("removes credentials from nested JSON property names", async () => {
		// Given
		const { api } = fixture(() => Response.json({
			data: [{ meta: { [config.apiKey]: "kept", "Bearer other.secret": config.apiKey }, id: "saved-id" }],
		}));
		// When
		const result = await api.request({ method: "GET", path: "customer" });
		// Then
		expect(result).toEqual({
			data: [{ meta: { "[REDACTED]": "kept", "Bearer [REDACTED]": "[REDACTED]" }, id: "saved-id" }],
		});
		expect(JSON.stringify(result)).not.toContain(config.apiKey);
		expect(JSON.stringify(result)).not.toContain("other.secret");
	});

	test.each([
		"authorization", "Proxy-Authorization", "api_key", "apiKey", "X-API-Key", "api_secret",
		"password", "secret", "client_secret", "token", "access_token", "refreshToken", "bearer_token",
		"card_number", "cardNumber", "credit_card", "credit_card_number", "cc_number", "pan",
		"cvv", "cvv2", "cvc", "cvc2", "card_cvv", "card_cvc", "security_code",
		"bank_account", "bank_account_number", "bankAccountNumber", "account_number",
		"bank_routing", "bank_routing_number", "routing_number", "iban", "payment_token",
	])("redacts nested %s fields", async (field) => {
		// Given
		const { api } = fixture(() => Response.json({
			data: [{ [field]: "sensitive-value", card_last_four: "1111", payment_method_id: "saved-id" }],
			success: false,
		}));
		// When
		const result = await api.request({ method: "GET", path: "payment-method/saved-id" });
		// Then
		expect(result).toEqual({
			data: [{ [field]: "[REDACTED]", card_last_four: "1111", payment_method_id: "saved-id" }],
			success: false,
		});
	});

	test("removes configured API keys and bearer credentials from text", async () => {
		// Given
		const { api } = fixture(() => Response.json({
			notes: [`first ${config.apiKey}; second ${config.apiKey}`, "Authorization: bEaReR other.secret+/= done"],
		}));
		// When
		const result = await api.request({ method: "GET", path: "customer" });
		// Then
		expect(JSON.stringify(result)).not.toContain(config.apiKey);
		expect(JSON.stringify(result)).not.toContain("other.secret");
		expect(result).toMatchObject({ notes: expect.arrayContaining(["first [REDACTED]; second [REDACTED]"]) });
	});
});

describe("request deadlines", () => {
	test.each(["headers", "body"])("aborts a stalled %s response without retrying a write", async (stage) => {
		// Given: subscribe to arrival and cancellation before the request starts.
		const arrived = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const { api, requests } = fixture(async (request) => {
			request.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
			arrived.resolve();
			if (stage === "headers") {
				await release.promise;
				return Response.json({});
			}
			return new Response(new ReadableStream({
				start(controller) { controller.enqueue(new TextEncoder().encode('{"pending":')); },
			}));
		}, { ...config, timeoutMs: 100 });
		cleanups.push(() => { release.resolve(); });
		// When
		const pending = failure(api.request({ method: "POST", path: "charge" }));
		await arrived.promise;
		const error = await pending;
		// Then
		expect(error.code).toBe("TIMEOUT");
		expect(error.cause).toBeUndefined();
		await aborted.promise;
		expect(requests).toHaveLength(1);
	}, 2000);
});
