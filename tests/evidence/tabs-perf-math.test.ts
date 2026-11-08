import { describe, expect, it } from 'vitest';
import { limitFailures } from './budget';
import { TABS_BUDGET_MS, medianKB, overBudget, tabsLimits } from './tabs-perf-math';

describe('tabs-perf arithmetic (M7b spec 12)', () => {
  it('the budgets are the spec values', () => {
    expect(TABS_BUDGET_MS).toEqual({ switchKept: 100, switchUnmounted: 2000, historyJump: 250, coldStartFiveTabs: 1500 });
  });
  it('a value within twice its budget passes; beyond it fails and names the line', () => {
    const ok = { switchKept: 200, switchUnmounted: 4000, historyJump: 500, coldStartFiveTabs: 3000 };
    expect(limitFailures(tabsLimits(ok))).toEqual([]);
    const bad = limitFailures(tabsLimits({ ...ok, switchKept: 200.1, coldStartFiveTabs: 3001 }));
    expect(bad).toHaveLength(2);
    expect(bad.join('\n')).toContain('kept tab');
    expect(bad.join('\n')).toContain('five saved tabs');
  });
  it('overBudget lists every line past its budget, within the limit or not', () => {
    expect(overBudget({ switchKept: 100, switchUnmounted: 2000, historyJump: 250, coldStartFiveTabs: 1500 })).toEqual([]);
    expect(overBudget({ switchKept: 101, switchUnmounted: 1, historyJump: 900, coldStartFiveTabs: 1 })).toEqual(['switchKept', 'historyJump']);
  });
  it('the memory read is the median of the reads', () => {
    expect(medianKB([300, 100, 200])).toBe(200);
    expect(medianKB([5])).toBe(5);
  });
});
