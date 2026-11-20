import { JsonHttpClient } from "./http.js";
import { EconomyError } from "../shared/errors.js";
import { TtlCache } from "../shared/cache.js";
import { validateDateRange } from "../shared/dates.js";
import type { EconomicSeries, FetchLike } from "../types.js";

const BASE_URL = "https://www.banxico.org.mx/SieAPIRest/service/v1";

type BanxicoPayload = {
  bmx?: {
    series?: Array<{
      idSerie?: string;
      titulo?: string;
      datos?: Array<{ fecha?: string; dato?: string }>;
    }>;
  };
};

function parseDate(value: string | undefined): string {
  if (!value) return "";
  const parts = value.split("/");
  if (parts.length === 3 && parts[2]) {
    return `${parts[2]}-${(parts[1] ?? "").padStart(2, "0")}-${(parts[0] ?? "").padStart(2, "0")}`;
  }
  return value;
}

export class BanxicoClient {
  private readonly http: JsonHttpClient;
  private readonly cache = new TtlCache<EconomicSeries>(60_000);

  constructor(
    private readonly token: string | undefined,
    fetcher?: FetchLike,
    intervalMs = 750,
  ) {
    this.http = new JsonHttpClient(fetcher, intervalMs);
  }

  async getSeries(
    seriesId: string,
    range?: { startDate: string; endDate: string },
  ): Promise<EconomicSeries> {
    if (!this.token) {
      throw new EconomyError(
        "TOKEN_MISSING",
        "Set BANXICO_TOKEN to query Banxico economic data.",
      );
    }
    if (!/^[A-Z]{2}\d{1,10}$/.test(seriesId)) {
      throw new EconomyError(
        "INVALID_INPUT",
        "seriesId must be a single Banxico identifier such as SF43718 or SP1.",
      );
    }
    if (range) validateDateRange(range.startDate, range.endDate);
    const suffix = range
      ? `/datos/${encodeURIComponent(range.startDate)}/${encodeURIComponent(range.endDate)}`
      : "/datos/oportuno";
    const cacheKey = `${seriesId}:${suffix}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const payload = await this.http.getJson<BanxicoPayload>(
      `${BASE_URL}/series/${seriesId}${suffix}`,
      { "Bmx-Token": this.token, Accept: "application/json" },
    );
    const series = payload.bmx?.series?.[0];
    if (!series?.idSerie) {
      throw new EconomyError(
        "INVALID_RESPONSE",
        "Banxico returned no data for the requested series.",
      );
    }
    const observations = (series.datos ?? []).map(({ fecha, dato }) => {
      const parsed =
        dato && dato !== "N/E" ? Number(dato.replaceAll(",", "")) : Number.NaN;
      return {
        date: parseDate(fecha),
        value: Number.isFinite(parsed) ? parsed : null,
      };
    });
    const result: EconomicSeries = {
      seriesId: series.idSerie,
      title: series.titulo ?? series.idSerie,
      observations,
      source: "Banxico",
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
