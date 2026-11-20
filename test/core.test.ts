import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BanxicoClient } from "../src/clients/banxico.js";
import { InegiClient } from "../src/clients/inegi.js";
import { EconomyError } from "../src/shared/errors.js";
import { monthsBefore, validateDateRange } from "../src/shared/dates.js";
import { TtlCache } from "../src/shared/cache.js";
import { MinimumIntervalLimiter } from "../src/shared/rate-limiter.js";
import { withRetry } from "../src/shared/retry.js";
import { EconomyService } from "../src/services/economy.js";
import type { FetchLike } from "../src/types.js";

const fixFixture = JSON.parse(
  await readFile(resolve("test/fixtures/banxico-fix.json"), "utf8"),
) as unknown;
const inegiFixture = JSON.parse(
  await readFile(resolve("test/fixtures/inegi-indicator.json"), "utf8"),
) as unknown;
const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("shared domain utilities", () => {
  it("expires cache values and supports clearing", () => {
    let time = 10;
    const cache = new TtlCache<string>(5, () => time);
    expect(cache.get("missing")).toBeUndefined();
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
    time = 15;
    expect(cache.get("key")).toBeUndefined();
    cache.set("key", "again");
    cache.clear();
    expect(cache.get("key")).toBeUndefined();
  });

  it("validates ranges and rejects impossible or reversed dates", () => {
    expect(() => validateDateRange("2025-01-01", "2025-01-31")).not.toThrow();
    expect(() => validateDateRange("2025-02-31", "2025-03-01")).toThrow(
      EconomyError,
    );
    expect(() => validateDateRange("2025-03-01", "2025-02-28")).toThrow(
      "startDate must be on or before endDate",
    );
    expect(() => validateDateRange("2025/01/01", "2025-01-02")).toThrow(
      "YYYY-MM-DD",
    );
  });

  it("computes a date fourteen months earlier at the start of the month", () => {
    expect(monthsBefore(new Date("2025-03-15T12:00:00Z"), 14)).toBe(
      "2024-01-01",
    );
  });

  it("retries transient errors with exponential delays and stops on non-retryable errors", async () => {
    const waits: number[] = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary");
        return "ok";
      },
      () => true,
      { baseDelayMs: 5, wait: async (ms) => void waits.push(ms) },
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([5, 10]);
    await expect(
      withRetry(
        async () => {
          throw new Error("permanent");
        },
        () => false,
      ),
    ).rejects.toThrow("permanent");
  });

  it("serializes requests with a minimum interval", async () => {
    let now = 100;
    const delays: number[] = [];
    const limiter = new MinimumIntervalLimiter(
      20,
      () => now,
      async (delay) => {
        delays.push(delay);
        now += delay;
      },
    );
    await Promise.all([
      limiter.schedule(async () => "a"),
      limiter.schedule(async () => "b"),
    ]);
    expect(delays).toEqual([20]);
  });
});

describe("provider clients", () => {
  it("parses and caches Banxico series, sends the documented token header, and builds range URLs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: FetchLike = async (url, init) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      return jsonResponse(fixFixture);
    };
    const client = new BanxicoClient("fake-banxico-token", fetcher, 0);
    const range = { startDate: "2025-01-01", endDate: "2025-01-31" };
    const first = await client.getSeries("SF43718", range);
    const cached = await client.getSeries("SF43718", range);
    expect(first).toEqual(cached);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain(
      "/series/SF43718/datos/2025-01-01/2025-01-31",
    );
    expect(new Headers(calls[0]?.init?.headers).get("Bmx-Token")).toBe(
      "fake-banxico-token",
    );
    expect(first.observations).toEqual([
      { date: "2025-01-02", value: 20.5 },
      { date: "2025-01-01", value: null },
    ]);
    const inpcClient = new BanxicoClient(
      "fake",
      async () =>
        jsonResponse({ bmx: { series: [{ idSerie: "SP1", datos: [] }] } }),
      0,
    );
    await expect(inpcClient.getSeries("SP1")).resolves.toMatchObject({
      seriesId: "SP1",
    });
  });

  it("fails clearly for missing tokens, malformed identifiers, and invalid provider payloads", async () => {
    const noToken = new BanxicoClient(
      undefined,
      async () => jsonResponse(fixFixture),
      0,
    );
    await expect(noToken.getSeries("SF43718")).rejects.toThrow(
      "Set BANXICO_TOKEN",
    );
    const client = new BanxicoClient(
      "fake",
      async () => jsonResponse({ bmx: { series: [] } }),
      0,
    );
    await expect(client.getSeries("bad")).rejects.toThrow("seriesId");
    await expect(client.getSeries("SF43718")).rejects.toThrow("no data");
  });

  it("parses INEGI observations, defaults to national latest, and validates identifiers", async () => {
    let requested = "";
    const client = new InegiClient(
      "fake-inegi-token",
      async (url) => {
        requested = url;
        return jsonResponse(inegiFixture);
      },
      0,
    );
    const result = await client.getIndicator("1002000001");
    expect(requested).toContain(
      "/INDICATOR/1002000001/es/00/true/BISE/2.0/fake-inegi-token",
    );
    expect(result.observations[0]).toEqual({ date: "2025", value: 130000000 });
    await expect(client.getIndicator("no-id")).rejects.toThrow(
      "5 to 20 digits",
    );
    await expect(
      new InegiClient(undefined).getIndicator("1002000001"),
    ).rejects.toThrow("Set INEGI_TOKEN");
  });

  it("retries a transient HTTP failure and reports client errors without retrying", async () => {
    let calls = 0;
    const retrying = new BanxicoClient(
      "fake",
      async () => {
        calls += 1;
        return calls === 1 ? jsonResponse({}, 503) : jsonResponse(fixFixture);
      },
      0,
    );
    const data = await retrying.getSeries("SF43718");
    expect(data.seriesId).toBe("SF43718");
    expect(calls).toBe(2);
    const clientError = new BanxicoClient(
      "fake",
      async () => jsonResponse({}, 401),
      0,
    );
    await expect(clientError.getSeries("SF43718")).rejects.toThrow(
      "status 401",
    );
  });
});

describe("economy service calculations", () => {
  it("computes monthly and annual changes from the correct INPC reference months", async () => {
    const obs = [
      { date: "2025-01-01", value: 100 },
      { date: "2025-02-01", value: 102 },
      { date: "2026-02-01", value: 110 },
    ];
    const banxico = {
      getSeries: vi.fn(async () => ({
        seriesId: "SP1",
        title: "INPC",
        observations: obs,
        source: "Banxico" as const,
      })),
    };
    const inegi = { getIndicator: vi.fn() };
    const service = new EconomyService(
      banxico,
      inegi,
      () => new Date("2026-03-01T00:00:00Z"),
    );
    const result = await service.inflation();
    expect(result.latest).toEqual({ date: "2026-02-01", index: 110 });
    expect(result.monthOverMonthPercent).toBe(7.8431);
    expect(result.yearOverYearPercent).toBe(7.8431);
    expect(banxico.getSeries).toHaveBeenCalledWith("SP1", {
      startDate: "2025-01-01",
      endDate: "2026-03-01",
    });
  });

  it("returns null inflation deltas without matching previous data and rejects empty index data", async () => {
    const banxico = {
      getSeries: vi.fn(async () => ({
        seriesId: "SP1",
        title: "INPC",
        observations: [{ date: "2026-01-01", value: 0 }],
        source: "Banxico" as const,
      })),
    };
    const service = new EconomyService(
      banxico,
      { getIndicator: vi.fn() },
      () => new Date("2026-01-01T00:00:00Z"),
    );
    expect(await service.inflation()).toMatchObject({
      monthOverMonthPercent: null,
      yearOverYearPercent: null,
    });
    banxico.getSeries.mockResolvedValue({
      seriesId: "SP1",
      title: "INPC",
      observations: [],
      source: "Banxico",
    });
    await expect(service.inflation()).rejects.toThrow("no numeric INPC");
  });

  it("requires complete ranges and allows mixed-provider comparison with per-item errors", async () => {
    const banxico = {
      getSeries: vi.fn(async (id: string) => {
        if (id === "SF00000") throw new Error("unknown series");
        return {
          seriesId: id,
          title: "Test",
          observations: [{ date: "2025-01-01", value: 1 }],
          source: "Banxico" as const,
        };
      }),
    };
    const inegi = {
      getIndicator: vi.fn(async (id: string) => ({
        seriesId: id,
        title: "Demo",
        observations: [],
        source: "INEGI" as const,
      })),
    };
    const service = new EconomyService(banxico, inegi);
    await expect(service.fix({ startDate: "2025-01-01" })).rejects.toThrow(
      "both startDate and endDate",
    );
    const result = await service.compare({
      banxicoSeriesIds: ["SF43718", "SF00000"],
      inegiIndicatorIds: ["1002000001"],
    });
    expect(result.indicators).toHaveLength(3);
    expect(result.indicators[1]).toMatchObject({
      latest: null,
      error: "unknown series",
    });
    await expect(service.compare({})).rejects.toThrow("at least one");
  });
});
