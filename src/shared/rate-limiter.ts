export type Sleep = (milliseconds: number) => Promise<void>;

export const sleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class MinimumIntervalLimiter {
  private tail: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(
    private readonly intervalMs = 750,
    private readonly now: () => number = Date.now,
    private readonly wait: Sleep = sleep,
  ) {}

  schedule<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.tail.then(async () => {
      const delay = this.intervalMs - (this.now() - this.lastRequestAt);
      if (this.lastRequestAt > 0 && delay > 0) await this.wait(delay);
      this.lastRequestAt = this.now();
      return operation();
    });
    this.tail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }
}
