import { z } from "zod";

export const accountId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const apiKey = z.string().trim().min(1).regex(/^\S+$/);
const accountsSchema = z
	.array(
		z.strictObject({
			id: accountId,
			apiKey,
			enableWrites: z.boolean().default(true),
		}),
	)
	.min(1)
	.refine(
		(accounts) => new Set(accounts.map((account) => account.id)).size === accounts.length,
		"Account IDs must be unique.",
	);

const environment = z.object({
	STAX_API_KEY: apiKey.optional(),
	STAX_ACCOUNTS: z.string().optional(),
	STAX_DEFAULT_ACCOUNT: accountId.optional(),
	STAX_ENABLE_WRITES: z.enum(["true", "false"]).default("false"),
	STAX_TIMEOUT_MS: z.coerce.number().int().min(1).max(120000).default(30000),
});

export class ConfigurationError extends Error { }

export function loadConfig(env: Readonly<Record<string, string | undefined>>) {
	const result = environment.safeParse(env);
	if (!result.success) {
		throw new ConfigurationError(
			`Invalid configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
		);
	}
	const data = result.data;
	if (data.STAX_API_KEY !== undefined && data.STAX_ACCOUNTS !== undefined) {
		throw new ConfigurationError("Set exactly one of STAX_API_KEY or STAX_ACCOUNTS.");
	}
	let accounts: z.infer<typeof accountsSchema>;
	if (data.STAX_ACCOUNTS !== undefined) {
		let input: unknown;
		try {
			input = JSON.parse(data.STAX_ACCOUNTS);
		} catch (error) {
			if (error instanceof SyntaxError)
				throw new ConfigurationError("STAX_ACCOUNTS must be valid JSON.");
			throw error;
		}
		const parsed = accountsSchema.safeParse(input);
		if (!parsed.success)
			throw new ConfigurationError(
				"STAX_ACCOUNTS requires unique account IDs and nonempty API keys.",
			);
		accounts = parsed.data;
	} else if (data.STAX_API_KEY !== undefined) {
		accounts = [{ id: "default", apiKey: data.STAX_API_KEY, enableWrites: true }];
	} else {
		throw new ConfigurationError("Set exactly one of STAX_API_KEY or STAX_ACCOUNTS.");
	}
	const defaultAccount = data.STAX_DEFAULT_ACCOUNT ?? accounts[0]?.id;
	if (!defaultAccount || !accounts.some((account) => account.id === defaultAccount)) {
		throw new ConfigurationError("STAX_DEFAULT_ACCOUNT must match a configured account ID.");
	}
	return {
		defaultAccount,
		accounts: accounts.map((account) => ({
			...account,
			enableWrites: data.STAX_ENABLE_WRITES === "true" && account.enableWrites,
			timeoutMs: data.STAX_TIMEOUT_MS,
		})),
	};
}

export type AccountConfig = {
	readonly apiKey: string;
	readonly enableWrites: boolean;
	readonly timeoutMs: number;
};

export type Config = {
	readonly defaultAccount: string;
	readonly accounts: readonly (AccountConfig & { readonly id: string })[];
};
