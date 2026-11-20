import { JsonHttpClient } from "./http.js";
import { EconomyError } from "../shared/errors.js";
import { TtlCache } from "../shared/cache.js";
import type { EconomicSeries, FetchLike } from "../types.js";

const BASE_URL =
  "https://www.inegi.org.mx/app/api/indicadores/desarrolladores/jsonxml";

type InegiPayload = {
  Series?: Array<{
    INDICADOR?: string;
    OBSERVATIONS?: Array<{ TIME_PERIOD?: string; OBS_VALUE?: string }>;
  }>;
};

export class InegiClient {
  private readonly http: JsonHttpClient;
  private readonly cache = new TtlCache<EconomicSeries>(60_000);

  constructor(
    private readonly token: string | undefined,
    fetcher?: FetchLike,
    intervalMs = 750,
  ) {
    this.http = new JsonHttpClient(fetcher, intervalMs);
  }

  async getIndicator(
    indicatorId: string,
    options: { geography?: string; latest?: boolean } = {},
  ): Promise<EconomicSeries> {
    if (!this.token) {
      throw new EconomyError(
        "TOKEN_MISSING",
        "Set INEGI_TOKEN to query INEGI indicator data.",
      );
    }
    if (!/^\d{5,20}$/.test(indicatorId)) {
      throw new EconomyError(
        "INVALID_INPUT",
        "indicatorId must contain 5 to 20 digits.",
      );
    }
    const geography = options.geography ?? "00";
    if (!/^(?:00|00000|\d{2,4})$/.test(geography)) {
      throw new EconomyError(
        "INVALID_INPUT",
        "geography must be a supported INEGI area code.",
      );
    }
    const latest = options.latest ?? true;
    const cacheKey = `${indicatorId}:${geography}:${latest}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const endpoint = [
      BASE_URL,
      "INDICATOR",
      encodeURIComponent(indicatorId),
      "es",
      encodeURIComponent(geography),
      String(latest),
      "BISE",
      "2.0",
      encodeURIComponent(this.token),
    ].join("/");
    const payload = await this.http.getJson<InegiPayload>(
      `${endpoint}?type=json`,
      {
        Accept: "application/json",
      },
    );
    const series = payload.Series?.[0];
    if (!series) {
      throw new EconomyError(
        "INVALID_RESPONSE",
        "INEGI returned no observations for the requested indicator.",
      );
    }
    const result: EconomicSeries = {
      seriesId: series.INDICADOR ?? indicatorId,
      title: `INEGI indicator ${indicatorId}`,
      source: "INEGI",
      observations: (series.OBSERVATIONS ?? []).map(
        ({ TIME_PERIOD, OBS_VALUE }) => {
          const numeric =
            OBS_VALUE === undefined || OBS_VALUE === ""
              ? Number.NaN
              : Number(OBS_VALUE);
          return {
            date: TIME_PERIOD ?? "",
            value: Number.isFinite(numeric) ? numeric : null,
          };
        },
      ),
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
