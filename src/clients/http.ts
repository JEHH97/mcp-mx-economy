import type { FetchLike } from "../types.js";
import { EconomyError } from "../shared/errors.js";
import { MinimumIntervalLimiter } from "../shared/rate-limiter.js";
import { withRetry } from "../shared/retry.js";

export class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Upstream request failed with status ${status}.`);
    this.name = "HttpStatusError";
  }
}

export class JsonHttpClient {
  private readonly limiter: MinimumIntervalLimiter;

  constructor(
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
    intervalMs = 750,
  ) {
    this.limiter = new MinimumIntervalLimiter(intervalMs);
  }

  async getJson<T>(url: string, headers: HeadersInit = {}): Promise<T> {
    return withRetry(
      () =>
        this.limiter.schedule(async () => {
          let response: Response;
          try {
            response = await this.fetcher(url, { method: "GET", headers });
          } catch (error) {
            throw new EconomyError(
              "UPSTREAM_ERROR",
              "The data provider could not be reached.",
              { cause: error },
            );
          }
          if (!response.ok) throw new HttpStatusError(response.status);
          try {
            return (await response.json()) as T;
          } catch (error) {
            throw new EconomyError(
              "INVALID_RESPONSE",
              "The data provider returned invalid JSON.",
              { cause: error },
            );
          }
        }),
      (error) =>
        error instanceof HttpStatusError
          ? error.status === 429 || error.status >= 500
          : error instanceof EconomyError && error.code === "UPSTREAM_ERROR",
    );
  }
}
