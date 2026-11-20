export type Observation = {
  date: string;
  value: number | null;
};

export type EconomicSeries = {
  seriesId: string;
  title: string;
  observations: Observation[];
  source: "Banxico" | "INEGI";
  unit?: string;
};

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
