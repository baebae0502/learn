// V/budget.ts
/** One measured value against its spec budget. */
export interface Limit {
  what: string;
  value: number;
  budget: number;
}

/**
 * The Linux CI rule (spec 1 condition 2, spec 12): a value fails beyond `factor` times its budget. Every failure is
 * returned, not the first, so one run shows which measurements went over.
 */
export function limitFailures(limits: readonly Limit[], factor = 2): string[] {
  return limits
    .filter((l) => l.value > factor * l.budget)
    .map((l) => `${l.what}: ${l.value} ms against the Linux CI limit ${factor * l.budget} ms (budget ${l.budget} ms)`);
}
