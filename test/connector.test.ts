import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConfigurationError, loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { StaxClient, StaxError } from "../src/stax";

const id = "129520d1-3844-45fd-a0b1-afb66bcdc74c";
const config = { apiKey: "test-secret-key", enableWrites: true, timeoutMs: 1000 };
const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(
	enableWrites = true,
	status = 200,
	response: unknown = { id, success: true },
) {
	const requests: {
		method: string;
		path: string;
		auth: string | null;
		contentType: string | null;
		body: unknown;
	}[] = [];
	const http = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			requests.push({
				method: request.method,
				path: new URL(request.url).pathname + new URL(request.url).search,
				auth: request.headers.get("authorization"),
				contentType: request.headers.get("content-type"),
				body: request.method === "GET" ? null : await request.text(),
			});
			return Response.json(response, { status, headers: { "Retry-After": "15" } });
		},
	});
	cleanups.push(() => {
		http.stop(true);
	});
	const options = { ...config, enableWrites };
	const api = new StaxClient(options, http.url.toString());
	const server = createServer(
		{ defaultAccount: "default", accounts: [{ id: "default", ...options }] },
		() => api,
	);
	const client = new Client({ name: "test", version: "1.0.0" });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	cleanups.push(async () => {
		await client.close();
		await server.close();
	});
	return { client, api, requests };
}

describe("configuration", () => {
	test("defaults to read-only when only a key is configured", () => {
		// Given / When
		const result = loadConfig({ STAX_API_KEY: "secret" });
		// Then
		expect(result).toEqual({
			defaultAccount: "default",
			accounts: [{ id: "default", apiKey: "secret", enableWrites: false, timeoutMs: 30000 }],
		});
	});

	test.each([
		{},
		{ STAX_API_KEY: " " },
		{ STAX_API_KEY: "secret", STAX_ENABLE_WRITES: "yes" },
		{ STAX_API_KEY: "secret", STAX_TIMEOUT_MS: "0" },
	])("rejects invalid environment configuration %j", (env) => {
		// Given / When / Then
		expect(() => loadConfig(env)).toThrow(ConfigurationError);
	});
});

describe("MCP operations over HTTP", () => {
	test("advertises only read tools when writes are disabled", async () => {
		// Given
		const { client } = await fixture(false);
		// When
		const result = await client.listTools();
		// Then
		expect(result.tools).toHaveLength(8);
		expect(
			result.tools
				.filter((tool) => tool.name !== "stax_select_account")
				.every((tool) => tool.annotations?.readOnlyHint === true),
		).toBe(true);
	});

	test("blocks unadvertised write calls without contacting Stax", async () => {
		// Given
		const { client, requests } = await fixture(false);
		// When
		const result = await client.callTool({
			name: "stax_void_transaction",
			arguments: { transaction_id: id },
		});
		// Then
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(0);
	});

	test("blocks direct client writes when configured read-only", async () => {
		// Given
		const { api, requests } = await fixture(false);
		// When / Then
		await expect(api.request({ method: "POST", path: "charge", body: {} })).rejects.toBeInstanceOf(
			StaxError,
		);
		expect(requests).toHaveLength(0);
	});

	test("serializes filters and preserves pagination through MCP", async () => {
		// Given
		const payload = {
			data: [{ id, created_at: "2026-01-02 12:00:00" }],
			current_page: 2,
			last_page: 3,
		};
		const { client, requests } = await fixture(true, 200, payload);
		// When
		const result = await client.callTool({
			name: "stax_list_transactions",
			arguments: { customer_id: id, page: 2, per_page: 10, start_date: "2026-01-01" },
		});
		// Then
		expect(result.structuredContent).toEqual({ account_id: "default", data: payload });
		const request = requests[0];
		expect(request?.auth).toBe(`Bearer ${config.apiKey}`);
		expect(request?.contentType).toBe("application/json");
		const url = new URL(request?.path ?? "/", "http://test");
		expect(url.pathname).toBe("/transaction");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			customer_id: id,
			page: "2",
			per_page: "10",
			start_date: "2026-01-01",
		});
	});

	test.each([
		[{ start_date: "2026-01-01" }, "2025-12-31 23:59:59", "FILTER_NOT_APPLIED"],
		[{ end_date: "2026-01-31" }, "2026-02-01 00:00:00", "FILTER_NOT_APPLIED"],
		[{ start_date: "2026-01-01" }, "not-a-date", "INVALID_RESPONSE"],
	] as const)("rejects unverifiable date-filtered pages %j", async (query, created_at, code) => {
		// Given
		const { client, requests } = await fixture(true, 200, { data: [{ id, created_at }] });
		// When
		const result = await client.callTool({ name: "stax_list_transactions", arguments: query });
		// Then
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toBeUndefined();
		const content = result.content;
		if (!Array.isArray(content)) throw new TypeError("Expected MCP content");
		expect(JSON.parse(content[0].text)).toMatchObject({ account_id: "default", code });
		expect(requests).toHaveLength(1);
	});

	test("includes both date boundaries without changing pagination metadata", async () => {
		// Given
		const data = {
			data: [
				{ id, created_at: "2026-01-01 00:00:00" },
				{ id, created_at: "2026-01-31 23:59:59" },
			],
			total: 2,
		};
		const { client } = await fixture(true, 200, data);
		// When
		const result = await client.callTool({
			name: "stax_list_transactions",
			arguments: { start_date: "2026-01-01", end_date: "2026-01-31" },
		});
		// Then
		expect(result.structuredContent).toEqual({ account_id: "default", data });
	});

	test.each([
		["stax_get_customer", { customer_id: id }, `/customer/${id}`],
		["stax_list_payment_methods", { customer_id: id }, `/customer/${id}/payment-method`],
		["stax_get_payment_method", { payment_method_id: id }, `/payment-method/${id}`],
		["stax_get_transaction", { transaction_id: id }, `/transaction/${id}`],
		[
			"stax_list_customers",
			{ email: "a+b@example.com" },
			"/customer?page=1&email=a%2Bb%40example.com",
		],
	] as const)("routes %s to its documented GET endpoint", async (name, args, path) => {
		// Given
		const { client, requests } = await fixture();
		// When
		await client.callTool({ name, arguments: args });
		// Then
		expect(requests[0]?.method).toBe("GET");
		expect(requests[0]?.path).toBe(path);
	});

	test.each([
		[
			"stax_charge_payment_method",
			{ payment_method_id: id, total: "10.25", idempotency_id: "order-1" },
			"/charge",
			{ payment_method_id: id, total: 10.25, idempotency_id: "order-1", pre_auth: false },
		],
		[
			"stax_capture_transaction",
			{ transaction_id: id, total: "10.25" },
			`/transaction/${id}/capture`,
			{ total: "10.25" },
		],
		[
			"stax_refund_transaction",
			{ transaction_id: id, total: "10.25" },
			`/transaction/${id}/refund`,
			{ total: "10.25" },
		],
		["stax_void_transaction", { transaction_id: id }, `/transaction/${id}/void`, null],
		[
			"stax_create_customer",
			{ email: "alex@example.com" },
			"/customer",
			{ email: "alex@example.com" },
		],
	] as const)("sends the documented payload for %s", async (name, args, path, expected) => {
		// Given
		const { client, requests } = await fixture();
		// When
		const result = await client.callTool({ name, arguments: args });
		// Then
		expect(result.isError).not.toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.path).toBe(path);
		const body = requests[0]?.body;
		expect(typeof body === "string" && body ? JSON.parse(body) : null).toEqual(expected);
	});

	test.each([
		["stax_charge_payment_method", { payment_method_id: id, total: "0.00", idempotency_id: "x" }],
		["stax_charge_payment_method", { payment_method_id: id, total: 1025, idempotency_id: "x" }],
		["stax_charge_payment_method", { payment_method_id: id, total: "1.001", idempotency_id: "x" }],
		["stax_charge_payment_method", { payment_method_id: id, total: "1.00" }],
		[
			"stax_charge_payment_method",
			{
				payment_method_id: id,
				total: "1.00",
				idempotency_id: "x",
				card_number: "4111111111111111",
			},
		],
		["stax_get_customer", { customer_id: "../transaction" }],
		["stax_create_customer", {}],
		["stax_list_transactions", { per_page: 201 }],
		["stax_list_transactions", { start_date: "2026-02-01", end_date: "2026-01-01" }],
	] as const)("rejects invalid inputs for %s before HTTP", async (name, args) => {
		// Given
		const { client, requests } = await fixture();
		// When
		const result = await client.callTool({ name, arguments: args });
		// Then
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(0);
	});

	test.each([401, 422, 429, 500])(
		"returns sanitized HTTP %i errors without retrying",
		async (status) => {
			// Given
			const { client, requests } = await fixture(true, status, { secret: config.apiKey });
			// When
			const result = await client.callTool({
				name: "stax_void_transaction",
				arguments: { transaction_id: id },
			});
			// Then
			expect(result.isError).toBe(true);
			expect(requests).toHaveLength(1);
			expect(JSON.stringify(result)).not.toContain(config.apiKey);
			const content = result.content;
			expect(Array.isArray(content)).toBe(true);
			if (!Array.isArray(content)) throw new TypeError("Expected MCP content array");
			const error = JSON.parse(content[0].text);
			expect(error.status).toBe(status);
			expect(error.retry_after).toBe("15");
		},
	);

	test("redacts nested credential fields but preserves payment status", async () => {
		// Given
		const { client } = await fixture(true, 200, {
			success: false,
			payment_method: { card_number: "4111111111111111", card_last_four: "1111" },
			nested: [{ token: "gateway-secret", message: config.apiKey, [config.apiKey]: "kept" }],
		});
		// When
		const result = await client.callTool({
			name: "stax_get_transaction",
			arguments: { transaction_id: id },
		});
		// Then
		expect(result.structuredContent).toEqual({
			account_id: "default",
			data: {
				success: false,
				payment_method: { card_number: "[REDACTED]", card_last_four: "1111" },
				nested: [{ token: "[REDACTED]", message: "[REDACTED]", "[REDACTED]": "kept" }],
			},
		});
		expect(JSON.stringify(result.structuredContent)).not.toContain(config.apiKey);
		expect(JSON.stringify(result.content)).not.toContain(config.apiKey);
	});
});

test("starts the actual stdio executable and discovers tools", async () => {
	// Given
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ["--no-env-file", "run", new URL("../src/index.ts", import.meta.url).pathname],
		env: { STAX_API_KEY: "test-key", STAX_ENABLE_WRITES: "false" },
		stderr: "pipe",
	});
	const client = new Client({ name: "stdio-test", version: "1.0.0" });
	cleanups.push(() => client.close());
	await client.connect(transport);
	// When
	const result = await client.listTools();
	// Then
	expect(result.tools).toHaveLength(8);
	expect(client.getServerVersion()?.name).toBe("staxpayments");
}, 10000);
