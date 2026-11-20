#!/usr/bin/env node
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BanxicoClient } from "./clients/banxico.js";
import { InegiClient } from "./clients/inegi.js";
import { createEconomyMcpServer } from "./mcp/register-tools.js";
import { EconomyService } from "./services/economy.js";

export function createDefaultService(): EconomyService {
  return new EconomyService(
    new BanxicoClient(process.env.BANXICO_TOKEN),
    new InegiClient(process.env.INEGI_TOKEN),
  );
}

async function main(): Promise<void> {
  const server = createEconomyMcpServer(createDefaultService());
  if ((process.env.MCP_TRANSPORT ?? "stdio").toLowerCase() === "http") {
    const port = Number(process.env.MCP_HTTP_PORT ?? "3333");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("MCP_HTTP_PORT must be a valid TCP port.");
    }
    const transport = new StreamableHTTPServerTransport({});
    await server.connect(transport);
    const httpServer = createServer((request, response) => {
      void transport
        .handleRequest(request, response)
        .catch((error: unknown) => {
          response.statusCode = 500;
          response.end(
            error instanceof Error ? error.message : "Internal server error",
          );
        });
    });
    httpServer.listen(port, "127.0.0.1", () => {
      console.error(`mcp-mx-economy listening on http://127.0.0.1:${port}/mcp`);
    });
    const shutdown = (): void => {
      httpServer.close();
      void transport.close();
      void server.close();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Unable to start MCP server.",
    );
    process.exitCode = 1;
  });
}
