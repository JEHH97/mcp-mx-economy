import { EconomyError } from "./errors.js";
import { sleep, type Sleep } from "./rate-limiter.js";

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  wait?: Sleep;
};

export async function withRetry<T>(
  operation: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const wait = options.wait ?? sleep;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt + 1 >= attempts || !shouldRetry(error)) {
        if (error instanceof Error) throw error;
        throw new EconomyError(
          "UPSTREAM_ERROR",
          "The data provider request failed.",
        );
      }
      await wait(baseDelayMs * 2 ** attempt);
    }
  }
  throw new EconomyError("UPSTREAM_ERROR", "The data provider request failed.");
}
