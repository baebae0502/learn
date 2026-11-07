// The arithmetic of tabs-perf.json (M7b spec 12), apart from the app so it is unit-tested.
import type { Limit } from './budget';
import { median } from './percentile';
import { tenth } from './p1-perf-math';

/** M7b spec 12; ms. Linux CI fails beyond twice each (budget.ts); the Mac reports. */
export const TABS_BUDGET_MS = { switchKept: 100, switchUnmounted: 2000, historyJump: 250, coldStartFiveTabs: 1500 } as const;
export type TabsLine = keyof typeof TABS_BUDGET_MS;

const WHAT: Record<TabsLine, string> = {
  switchKept: 'switch to a kept tab (median of 10)',
  switchUnmounted: 'switch to an unmounted tab (median of 5)',
  historyJump: 'one back jump (median of 10)',
  coldStartFiveTabs: 'cold start to app-ready with five saved tabs (median of 5)',
};

/** Each line's median against its budget; the failure rule (twice the budget) is budget.ts's. */
export function tabsLimits(values: Readonly<Record<TabsLine, number>>): Limit[] {
  return (Object.keys(TABS_BUDGET_MS) as TabsLine[]).map((k) => ({ what: WHAT[k], value: values[k], budget: TABS_BUDGET_MS[k] }));
}

/** The lines whose value is over its budget (those beyond twice it also fail on Linux CI). */
export function overBudget(values: Readonly<Record<TabsLine, number>>): TabsLine[] {
  return (Object.keys(TABS_BUDGET_MS) as TabsLine[]).filter((k) => values[k] > TABS_BUDGET_MS[k]);
}

/** A memory reading taken as the median of a few reads (KB, whole numbers); at least one read. */
export function medianKB(reads: readonly number[]): number {
  return Math.round(tenth(median(reads)));
}
