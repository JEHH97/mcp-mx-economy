export type EconomyErrorCode =
  | "TOKEN_MISSING"
  | "UPSTREAM_ERROR"
  | "INVALID_RESPONSE"
  | "INVALID_INPUT"
  | "RATE_LIMITED";

export class EconomyError extends Error {
  constructor(
    readonly code: EconomyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EconomyError";
  }
}

export function errorForTool(error: unknown): string {
  if (error instanceof EconomyError) return `${error.code}: ${error.message}`;
  return "UPSTREAM_ERROR: The data provider could not be reached. Try again shortly.";
}
