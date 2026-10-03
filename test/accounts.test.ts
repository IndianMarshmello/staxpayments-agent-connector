import { afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConfigurationError, loadConfig } from "../src/config";
import { createServer } from "../src/server";
import { StaxClient } from "../src/stax";

const accounts = [
	{ id: "east", apiKey: "east-secret", enableWrites: true },
	{ id: "west", apiKey: "west-secret", enableWrites: false },
];
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(handler?: (request: Request) => Promise<Response>) {
	const requests: { auth: string | null; path: string; body: string }[] = [];
	const http = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const auth = request.headers.get("authorization");
			requests.push({
				auth,
				path: new URL(request.url).pathname + new URL(request.url).search,
				body: await request.clone().text(),
			});
			if (handler) return handler(request);
			return Response.json({ merchant: auth === "Bearer east-secret" ? "east" : "west" });
		},
	});
	cleanups.push(() => {
		http.stop(true);
	});
	const config = loadConfig({
		STAX_ACCOUNTS: JSON.stringify(accounts),
		STAX_ENABLE_WRITES: "true",
	});
	async function connect() {
		const server = createServer(config, (account) => new StaxClient(account, http.url.toString()));
		const client = new Client({ name: "multi-account-test", version: "1.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		cleanups.push(async () => {
			await client.close();
			await server.close();
		});
		return client;
	}
	return { client: await connect(), connect, requests };
}

test("parses named accounts and applies global and per-account write permissions", () => {
	// Given / When
	const config = loadConfig({
		STAX_ACCOUNTS: JSON.stringify(accounts),
		STAX_DEFAULT_ACCOUNT: "west",
		STAX_ENABLE_WRITES: "true",
	});
	// Then
	expect(config.defaultAccount).toBe("west");
	expect(config.accounts.map((account) => [account.id, account.enableWrites])).toEqual([
		["east", true],
		["west", false],
	]);
	expect(
		loadConfig({ STAX_ACCOUNTS: JSON.stringify(accounts) }).accounts.every(
			(account) => !account.enableWrites,
		),
	).toBe(true);
});

test.each([
	{ STAX_ACCOUNTS: "not-json" },
	{ STAX_ACCOUNTS: "[]" },
	{ STAX_ACCOUNTS: JSON.stringify([accounts[0], accounts[0]]) },
	{ STAX_ACCOUNTS: JSON.stringify([{ id: "east", apiKey: "" }]) },
	{ STAX_ACCOUNTS: JSON.stringify(accounts), STAX_DEFAULT_ACCOUNT: "missing" },
	{ STAX_ACCOUNTS: JSON.stringify(accounts), STAX_API_KEY: "conflicting-key" },
])("rejects invalid multi-account configuration without exposing keys %j", (env) => {
	// Given / When / Then
	expect(() => loadConfig(env)).toThrow(ConfigurationError);
});

test("lists account names and permissions without credentials or HTTP requests", async () => {
	// Given
	const { client, requests } = await fixture();
	// When
	const result = await client.callTool({ name: "stax_list_accounts", arguments: {} });
	// Then
	expect(result.structuredContent).toEqual({
		active_account_id: "east",
		accounts: [
			{ account_id: "east", writes_enabled: true },
			{ account_id: "west", writes_enabled: false },
		],
	});
	expect(JSON.stringify(result)).not.toContain("secret");
	expect(requests).toHaveLength(0);
});

test("switches the account used by subsequent reads", async () => {
	// Given
	const { client, requests } = await fixture();
	await client.callTool({ name: "stax_select_account", arguments: { account_id: "west" } });
	// When
	const result = await client.callTool({ name: "stax_list_customers", arguments: {} });
	// Then
	expect(result.structuredContent).toEqual({ account_id: "west", data: { merchant: "west" } });
	expect(requests[0]?.auth).toBe("Bearer west-secret");
});

test("pulls both accounts concurrently without changing the active account", async () => {
	// Given
	const { client, requests } = await fixture();
	// When
	const results = await Promise.all(
		["east", "west"].map((account_id) =>
			client.callTool({ name: "stax_list_transactions", arguments: { account_id, page: 2 } }),
		),
	);
	// Then
	expect(results.map((result) => result.structuredContent)).toEqual([
		{ account_id: "east", data: { merchant: "east" } },
		{ account_id: "west", data: { merchant: "west" } },
	]);
	expect(requests.map((request) => request.auth).sort()).toEqual([
		"Bearer east-secret",
		"Bearer west-secret",
	]);
	expect(requests.every((request) => !request.path.includes("account_id"))).toBe(true);
	const listing = await client.callTool({ name: "stax_list_accounts", arguments: {} });
	expect(listing.structuredContent).toMatchObject({ active_account_id: "east" });
});

test("does not reroute an in-flight read when the active account switches", async () => {
	// Given: subscribe to HTTP arrival before triggering the read.
	const arrived = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	cleanups.push(() => {
		release.resolve();
	});
	const { client } = await fixture(async (request) => {
		const auth = request.headers.get("authorization");
		arrived.resolve();
		await release.promise;
		return Response.json({ merchant: auth === "Bearer east-secret" ? "east" : "west" });
	});
	const pending = client.callTool({ name: "stax_list_customers", arguments: {} });
	await arrived.promise;
	// When
	await client.callTool({ name: "stax_select_account", arguments: { account_id: "west" } });
	release.resolve();
	// Then
	expect((await pending).structuredContent).toEqual({
		account_id: "east",
		data: { merchant: "east" },
	});
}, 5000);

test("keeps active account selection local to each server session", async () => {
	// Given
	const { client, connect } = await fixture();
	const other = await connect();
	await client.callTool({ name: "stax_select_account", arguments: { account_id: "west" } });
	// When
	const result = await other.callTool({ name: "stax_list_customers", arguments: {} });
	// Then
	expect(result.structuredContent).toEqual({ account_id: "east", data: { merchant: "east" } });
});

test.each(["stax_select_account", "stax_list_customers"])(
	"rejects unknown accounts for %s without fallback",
	async (name) => {
		// Given
		const { client, requests } = await fixture();
		// When
		const result = await client.callTool({ name, arguments: { account_id: "missing" } });
		// Then
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(0);
		const listing = await client.callTool({ name: "stax_list_accounts", arguments: {} });
		expect(listing.structuredContent).toMatchObject({ active_account_id: "east" });
	},
);

test.each([{}, { account_id: "west" }])(
	"blocks implicit or read-only account writes %j",
	async (args) => {
		// Given
		const { client, requests } = await fixture();
		// When
		const result = await client.callTool({
			name: "stax_create_customer",
			arguments: { ...args, email: "alex@example.com" },
		});
		// Then
		expect(result.isError).toBe(true);
		expect(requests).toHaveLength(0);
	},
);

test("routes an explicit write to its enabled account and strips routing metadata", async () => {
	// Given
	const { client, requests } = await fixture();
	await client.callTool({ name: "stax_select_account", arguments: { account_id: "west" } });
	// When
	const result = await client.callTool({
		name: "stax_create_customer",
		arguments: { account_id: "east", email: "alex@example.com" },
	});
	// Then
	expect(result.isError).not.toBe(true);
	expect(requests[0]?.auth).toBe("Bearer east-secret");
	expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ email: "alex@example.com" });
});

test("labels an account failure while another account succeeds", async () => {
	// Given
	const { client } = await fixture(async (request) => {
		const east = request.headers.get("authorization") === "Bearer east-secret";
		return Response.json(east ? { secret: "east-secret" } : { merchant: "west" }, {
			status: east ? 401 : 200,
		});
	});
	// When
	const [east, west] = await Promise.all(
		["east", "west"].map((account_id) =>
			client.callTool({ name: "stax_list_customers", arguments: { account_id } }),
		),
	);
	// Then
	expect(east?.isError).toBe(true);
	expect(JSON.stringify(east)).not.toContain("east-secret");
	expect(west?.structuredContent).toEqual({ account_id: "west", data: { merchant: "west" } });
});

test("discovers and switches configured accounts through the stdio executable", async () => {
	// Given
	const client = new Client({ name: "multi-stdio", version: "1.0.0" });
	cleanups.push(() => client.close());
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ["--no-env-file", "run", new URL("../src/index.ts", import.meta.url).pathname],
			env: {
				STAX_ACCOUNTS: JSON.stringify(accounts),
				STAX_DEFAULT_ACCOUNT: "west",
				STAX_ENABLE_WRITES: "false",
			},
			stderr: "pipe",
		}),
	);
	// When
	const result = await client.callTool({
		name: "stax_select_account",
		arguments: { account_id: "east" },
	});
	// Then
	expect(result.structuredContent).toEqual({ active_account_id: "east" });
}, 10000);
