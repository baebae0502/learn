import { describe, expect, it } from 'vitest';
import { spreadStart, spreadStep } from './spread';

describe('the first page of the spread a page is in', () => {
  it('odd spreads pair 1·2, 3·4 …', () => {
    expect([1, 2, 3, 4, 5].map((p) => spreadStart(p, 'odd'))).toEqual([1, 1, 3, 3, 5]);
  });
  it('even spreads leave page 1 alone and pair 2·3, 4·5 …', () => {
    expect([1, 2, 3, 4, 5].map((p) => spreadStart(p, 'even'))).toEqual([1, 2, 2, 4, 4]);
  });
  it('no spread is the page itself', () => {
    expect([1, 2, 3].map((p) => spreadStart(p, 'none'))).toEqual([1, 2, 3]);
  });
});

describe('the page a step lands on', () => {
  it('one page without a spread, and none past the ends', () => {
    expect(spreadStep(5, 17, 'none', 'next')).toBe(6);
    expect(spreadStep(5, 17, 'none', 'previous')).toBe(4);
    expect(spreadStep(17, 17, 'none', 'next')).toBeNull();
    expect(spreadStep(1, 17, 'none', 'previous')).toBeNull();
  });
  it('a spread at a time, to the first page of the neighbour spread', () => {
    expect(spreadStep(3, 17, 'odd', 'next')).toBe(5);
    expect(spreadStep(4, 17, 'odd', 'next')).toBe(5);
    expect(spreadStep(5, 17, 'odd', 'previous')).toBe(3);
    expect(spreadStep(4, 17, 'odd', 'previous')).toBe(1);
    expect(spreadStep(1, 17, 'odd', 'previous')).toBeNull();
    expect(spreadStep(1, 17, 'even', 'next')).toBe(2);
    expect(spreadStep(2, 17, 'even', 'next')).toBe(4);
    expect(spreadStep(3, 17, 'even', 'next')).toBe(4);
    expect(spreadStep(4, 17, 'even', 'previous')).toBe(2);
    expect(spreadStep(2, 17, 'even', 'previous')).toBe(1);
  });
  it('none after the last spread', () => {
    expect(spreadStep(15, 16, 'odd', 'next')).toBeNull();
    expect(spreadStep(16, 16, 'odd', 'next')).toBeNull();
    expect(spreadStep(17, 17, 'odd', 'next')).toBeNull();
    expect(spreadStep(16, 17, 'odd', 'next')).toBe(17);
    expect(spreadStep(15, 17, 'odd', 'next')).toBe(17);
    expect(spreadStep(16, 17, 'even', 'next')).toBeNull();
  });
});
