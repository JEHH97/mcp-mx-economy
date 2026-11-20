import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorForTool } from "../shared/errors.js";
import type { EconomyService } from "../services/economy.js";

const observationSchema = z.object({
  date: z.string(),
  value: z.number().nullable(),
});
const seriesSchema = z.object({
  seriesId: z.string(),
  title: z.string(),
  source: z.enum(["Banxico", "INEGI"]),
  unit: z.string().optional(),
  observations: z.array(observationSchema),
});

type ToolReply<T extends Record<string, unknown>> =
  | { content: Array<{ type: "text"; text: string }>; structuredContent: T }
  | { content: Array<{ type: "text"; text: string }>; isError: true };

async function reply<T extends Record<string, unknown>>(
  action: () => Promise<T>,
): Promise<ToolReply<T>> {
  try {
    const data = await action();
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: errorForTool(error) }],
      isError: true,
    };
  }
}

export function createEconomyMcpServer(service: EconomyService): McpServer {
  const server = new McpServer({ name: "mcp-mx-economy", version: "1.0.0" });

  server.registerTool(
    "mx_fix_rate",
    {
      title: "Mexican peso FIX exchange rate",
      description:
        "Get the latest Banxico FIX exchange rate or a historical date range.",
      inputSchema: {
        startDate: z
          .string()
          .optional()
          .describe("Range start in YYYY-MM-DD; supply with endDate."),
        endDate: z
          .string()
          .optional()
          .describe("Range end in YYYY-MM-DD; supply with startDate."),
      },
      outputSchema: seriesSchema.shape,
    },
    ({ startDate, endDate }) =>
      reply(() =>
        service.fix({
          ...(startDate === undefined ? {} : { startDate }),
          ...(endDate === undefined ? {} : { endDate }),
        }),
      ),
  );

  server.registerTool(
    "mx_target_rate",
    {
      title: "Banxico target rate",
      description: "Get the latest Mexican central bank target interest rate.",
      inputSchema: {},
      outputSchema: seriesSchema.shape,
    },
    () => reply(() => service.targetRate()),
  );

  server.registerTool(
    "mx_inflation",
    {
      title: "Mexican inflation",
      description:
        "Get the latest INPC index and compute monthly and annual percentage changes.",
      inputSchema: {},
      outputSchema: z.object({
        seriesId: z.string(),
        title: z.string(),
        latest: z.object({ date: z.string(), index: z.number() }),
        monthOverMonthPercent: z.number().nullable(),
        yearOverYearPercent: z.number().nullable(),
        source: z.literal("Banxico"),
      }).shape,
    },
    () => reply(() => service.inflation()),
  );

  server.registerTool(
    "mx_udis",
    {
      title: "UDIS value",
      description: "Get the latest value of the Mexican UDIS unit of account.",
      inputSchema: {},
      outputSchema: seriesSchema.shape,
    },
    () => reply(() => service.udis()),
  );

  server.registerTool(
    "mx_tiie_28d",
    {
      title: "TIIE 28-day rate",
      description: "Get the latest Banxico TIIE 28-day reference rate.",
      inputSchema: {},
      outputSchema: seriesSchema.shape,
    },
    () => reply(() => service.tiie()),
  );

  server.registerTool(
    "mx_banxico_series",
    {
      title: "Banxico time series",
      description:
        "Query any single Banxico SIE series by identifier, optionally over a date range.",
      inputSchema: {
        seriesId: z
          .string()
          .regex(/^[A-Z]{2}\d{1,10}$/)
          .describe("Banxico SIE identifier such as SF43718 or SP1."),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      },
      outputSchema: seriesSchema.shape,
    },
    ({ seriesId, startDate, endDate }) =>
      reply(() =>
        service.banxicoSeries(seriesId, {
          ...(startDate === undefined ? {} : { startDate }),
          ...(endDate === undefined ? {} : { endDate }),
        }),
      ),
  );

  server.registerTool(
    "mx_inegi_indicator",
    {
      title: "INEGI indicator",
      description:
        "Query a public INEGI indicator by identifier. The default geography is national.",
      inputSchema: {
        indicatorId: z.string().regex(/^\d{5,20}$/),
        geography: z
          .string()
          .optional()
          .describe("INEGI geography code; defaults to national (00)."),
        latest: z
          .boolean()
          .optional()
          .describe("Return only the latest observation; defaults to true."),
      },
      outputSchema: seriesSchema.shape,
    },
    ({ indicatorId, geography, latest }) =>
      reply(() =>
        service.inegiIndicator(indicatorId, {
          ...(geography === undefined ? {} : { geography }),
          ...(latest === undefined ? {} : { latest }),
        }),
      ),
  );

  server.registerTool(
    "mx_compare_indicators",
    {
      title: "Compare Mexican indicators",
      description:
        "Fetch latest observations for several Banxico series and/or INEGI indicators.",
      inputSchema: {
        banxicoSeriesIds: z
          .array(z.string().regex(/^[A-Z]{2}\d{1,10}$/))
          .max(8)
          .optional(),
        inegiIndicatorIds: z
          .array(z.string().regex(/^\d{5,20}$/))
          .max(8)
          .optional(),
      },
      outputSchema: z.object({
        indicators: z.array(
          z.object({
            seriesId: z.string(),
            source: z.enum(["Banxico", "INEGI"]),
            title: z.string(),
            latest: observationSchema.nullable(),
            error: z.string().optional(),
          }),
        ),
      }).shape,
    },
    ({ banxicoSeriesIds, inegiIndicatorIds }) =>
      reply(() =>
        service.compare({
          ...(banxicoSeriesIds === undefined ? {} : { banxicoSeriesIds }),
          ...(inegiIndicatorIds === undefined ? {} : { inegiIndicatorIds }),
        }),
      ),
  );

  return server;
}
