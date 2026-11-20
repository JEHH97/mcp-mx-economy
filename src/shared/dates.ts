import { EconomyError } from "./errors.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateRange(startDate: string, endDate: string): void {
  if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
    throw new EconomyError(
      "INVALID_INPUT",
      "Dates must use YYYY-MM-DD format.",
    );
  }
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
    throw new EconomyError(
      "INVALID_INPUT",
      "The supplied date is not a valid calendar date.",
    );
  }
  if (startDate > endDate) {
    throw new EconomyError(
      "INVALID_INPUT",
      "startDate must be on or before endDate.",
    );
  }
}

function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function monthsBefore(date: Date, count: number): string {
  const result = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - count, 1),
  );
  return result.toISOString().slice(0, 10);
}
