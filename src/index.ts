import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigurationError, loadConfig } from "./config";
import { createServer } from "./server";

async function main() {
  const server = createServer(loadConfig(process.env));
  await server.connect(new StdioServerTransport());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? error.message : "Stax MCP failed to start.");
  process.exitCode = 1;
});
