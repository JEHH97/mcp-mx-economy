import type { BanxicoClient } from "../clients/banxico.js";
import type { InegiClient } from "../clients/inegi.js";
import { EconomyError } from "../shared/errors.js";
import { monthsBefore } from "../shared/dates.js";
import type { EconomicSeries } from "../types.js";

export const INDICATORS = {
  fix: { id: "SF43718", label: "FIX exchange rate", unit: "MXN per USD" },
  targetRate: { id: "SF61745", label: "Target rate", unit: "percent per year" },
  inpc: { id: "SP1", label: "Consumer price index", unit: "index points" },
  udis: { id: "SP68257", label: "UDIS value", unit: "MXN per UDI" },
  tiie: { id: "SF60648", label: "TIIE 28-day rate", unit: "percent per year" },
} as const;

export type SeriesResult = {
  seriesId: string;
  title: string;
  source: "Banxico" | "INEGI";
  unit?: string;
  observations: EconomicSeries["observations"];
};

export class EconomyService {
  constructor(
    private readonly banxico: Pick<BanxicoClient, "getSeries">,
    private readonly inegi: Pick<InegiClient, "getIndicator">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fix(
    options: { startDate?: string; endDate?: string } = {},
  ): Promise<SeriesResult> {
    const series = await this.banxico.getSeries(
      INDICATORS.fix.id,
      this.range(options),
    );
    return this.withUnit(series, INDICATORS.fix.unit);
  }

  async targetRate(): Promise<SeriesResult> {
    return this.withUnit(
      await this.banxico.getSeries(INDICATORS.targetRate.id),
      INDICATORS.targetRate.unit,
    );
  }

  async inflation(): Promise<{
    seriesId: string;
    title: string;
    latest: { date: string; index: number };
    monthOverMonthPercent: number | null;
    yearOverYearPercent: number | null;
    source: "Banxico";
  }> {
    const currentDate = this.now();
    const series = await this.banxico.getSeries(INDICATORS.inpc.id, {
      startDate: monthsBefore(currentDate, 14),
      endDate: currentDate.toISOString().slice(0, 10),
    });
    const observations = series.observations
      .filter(
        (item): item is { date: string; value: number } => item.value !== null,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = observations.at(-1);
    if (!latest) {
      throw new EconomyError(
        "INVALID_RESPONSE",
        "Banxico returned no numeric INPC observations.",
      );
    }
    const currentMonth = latest.date.slice(0, 7);
    const priorMonth = observations
      .filter((item) => item.date.slice(0, 7) < currentMonth)
      .at(-1);
    const previousYearMonth = `${Number(currentMonth.slice(0, 4)) - 1}${currentMonth.slice(4)}`;
    const priorYear = observations.find(
      (item) => item.date.slice(0, 7) === previousYearMonth,
    );
    return {
      seriesId: series.seriesId,
      title: series.title,
      latest: { date: latest.date, index: latest.value },
      monthOverMonthPercent: priorMonth
        ? percentChange(latest.value, priorMonth.value)
        : null,
      yearOverYearPercent: priorYear
        ? percentChange(latest.value, priorYear.value)
        : null,
      source: "Banxico",
    };
  }

  async udis(): Promise<SeriesResult> {
    return this.withUnit(
      await this.banxico.getSeries(INDICATORS.udis.id),
      INDICATORS.udis.unit,
    );
  }

  async tiie(): Promise<SeriesResult> {
    return this.withUnit(
      await this.banxico.getSeries(INDICATORS.tiie.id),
      INDICATORS.tiie.unit,
    );
  }

  async banxicoSeries(
    seriesId: string,
    options: { startDate?: string; endDate?: string } = {},
  ): Promise<SeriesResult> {
    return this.withUnit(
      await this.banxico.getSeries(seriesId, this.range(options)),
    );
  }

  async inegiIndicator(
    indicatorId: string,
    options: { geography?: string; latest?: boolean } = {},
  ): Promise<SeriesResult> {
    const series = await this.inegi.getIndicator(indicatorId, options);
    return { ...series };
  }

  async compare(input: {
    banxicoSeriesIds?: string[];
    inegiIndicatorIds?: string[];
  }): Promise<{
    indicators: Array<{
      seriesId: string;
      source: "Banxico" | "INEGI";
      title: string;
      latest: { date: string; value: number | null } | null;
      error?: string;
    }>;
  }> {
    const tasks = [
      ...(input.banxicoSeriesIds ?? []).map((seriesId) => ({
        seriesId,
        source: "Banxico" as const,
        load: () => this.banxico.getSeries(seriesId),
      })),
      ...(input.inegiIndicatorIds ?? []).map((seriesId) => ({
        seriesId,
        source: "INEGI" as const,
        load: () => this.inegi.getIndicator(seriesId),
      })),
    ];
    if (tasks.length === 0) {
      throw new EconomyError(
        "INVALID_INPUT",
        "Provide at least one series or indicator identifier to compare.",
      );
    }
    const settled = await Promise.allSettled(tasks.map((task) => task.load()));
    return {
      indicators: settled.map((result, index) => {
        const task = tasks[index];
        if (!task)
          throw new EconomyError(
            "INVALID_RESPONSE",
            "Unable to associate comparison result.",
          );
        if (result.status === "rejected") {
          return {
            seriesId: task.seriesId,
            source: task.source,
            title: task.seriesId,
            latest: null,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Data request failed.",
          };
        }
        const latest = result.value.observations.at(-1) ?? null;
        return {
          seriesId: result.value.seriesId,
          source: task.source,
          title: result.value.title,
          latest,
        };
      }),
    };
  }

  private range(options: {
    startDate?: string;
    endDate?: string;
  }): { startDate: string; endDate: string } | undefined {
    if (options.startDate === undefined && options.endDate === undefined)
      return undefined;
    if (options.startDate === undefined || options.endDate === undefined) {
      throw new EconomyError(
        "INVALID_INPUT",
        "Provide both startDate and endDate for a historical range.",
      );
    }
    return { startDate: options.startDate, endDate: options.endDate };
  }

  private withUnit(series: EconomicSeries, unit?: string): SeriesResult {
    return unit ? { ...series, unit } : { ...series };
  }
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(4));
}
