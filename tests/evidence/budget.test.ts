// V/budget.test.ts
import { describe, expect, it } from 'vitest';
import { limitFailures } from './budget';

describe('the Linux CI limit is twice the budget', () => {
  it('passes at the limit and fails above it, naming the measurement, its value and both numbers', () => {
    expect(limitFailures([{ what: 'scope switch, median', value: 200, budget: 100 }])).toEqual([]);
    expect(limitFailures([{ what: 'scope switch, median', value: 201, budget: 100 }])).toEqual([
      'scope switch, median: 201 ms against the Linux CI limit 200 ms (budget 100 ms)',
    ]);
  });
  it('reports every measurement beyond its limit at once, and only those', () => {
    const out = limitFailures([
      { what: 'a', value: 10, budget: 50 },
      { what: 'b', value: 101, budget: 50 },
      { what: 'c', value: 301, budget: 150 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^b: 101 ms/);
    expect(out[1]).toMatch(/^c: 301 ms/);
  });
  it('takes another factor', () => {
    expect(limitFailures([{ what: 'x', value: 151, budget: 100 }], 1.5)).toHaveLength(1);
  });
});
