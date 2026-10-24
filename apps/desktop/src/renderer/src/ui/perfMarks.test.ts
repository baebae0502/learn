import { afterEach, describe, expect, it } from 'vitest';
import { perfMark, perfMarkLatest, timed } from './perfMarks';

afterEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

describe('the perf marks the evidence reads (spec 9 budgets, spec 8 drop stall)', () => {
  it('keeps one mark per repeating name, the newest, so a long session never piles them up', () => {
    perfMarkLatest('table:painted');
    const first = performance.getEntriesByName('learn:table:painted')[0]!.startTime;
    perfMarkLatest('table:painted');
    const marks = performance.getEntriesByName('learn:table:painted');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.startTime).toBeGreaterThanOrEqual(first);
  });

  it('leaves the once-per-drop marks as they were: they pile up until clearImportMarks', () => {
    perfMark('drop');
    perfMark('drop');
    expect(performance.getEntriesByName('learn:drop')).toHaveLength(2);
  });

  it('times a call as one learn: measure, hands back its value, and keeps only the newest', () => {
    expect(timed('search', () => 42)).toBe(42);
    expect(timed('search', () => 'x')).toBe('x');
    const measures = performance.getEntriesByName('learn:search', 'measure');
    expect(measures).toHaveLength(1);
    expect(measures[0]!.duration).toBeGreaterThanOrEqual(0);
  });

  it('records the measure also when the call throws, and throws on', () => {
    expect(() =>
      timed('search:index', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(performance.getEntriesByName('learn:search:index', 'measure')).toHaveLength(1);
  });
});
