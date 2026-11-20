import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { BanxicoClient } from "../src/clients/banxico.js";
import { InegiClient } from "../src/clients/inegi.js";
import { createEconomyMcpServer } from "../src/mcp/register-tools.js";
import { EconomyService } from "../src/services/economy.js";

describe("MCP protocol", () => {
  it("lists all tools and calls one using the SDK client over a linked in-memory transport", async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          bmx: {
            series: [
              {
                idSerie: "SF61745",
                titulo: "Target rate",
                datos: [{ fecha: "01/02/2025", dato: "9.5" }],
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const service = new EconomyService(
      new BanxicoClient("fixture-token", fetcher, 0),
      new InegiClient("fixture-token", fetcher, 0),
    );
    const server = createEconomyMcpServer(service);
    const client = new Client({ name: "protocol-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "mx_fix_rate",
      "mx_target_rate",
      "mx_inflation",
      "mx_udis",
      "mx_tiie_28d",
      "mx_banxico_series",
      "mx_inegi_indicator",
      "mx_compare_indicators",
    ]);
    const called = await client.callTool({
      name: "mx_target_rate",
      arguments: {},
    });
    expect(called.isError).not.toBe(true);
    expect(called.structuredContent).toMatchObject({
      seriesId: "SF61745",
      observations: [{ date: "2025-02-01", value: 9.5 }],
    });
    await client.close();
    await server.close();
  });
});
