import { describe, expect, it } from 'vitest';
import { cursorAfter, segments } from './transcriptRows';

describe('cursorAfter (the list box\'s keys)', () => {
  it('moves one row with the arrows and stops at the ends', () => {
    expect(cursorAfter('ArrowDown', 3, 10, 5)).toBe(4);
    expect(cursorAfter('ArrowUp', 3, 10, 5)).toBe(2);
    expect(cursorAfter('ArrowUp', 0, 10, 5)).toBe(0);
    expect(cursorAfter('ArrowDown', 9, 10, 5)).toBe(9);
  });
  it('goes to the ends with Home and End and a page with PageUp and PageDown', () => {
    expect(cursorAfter('Home', 6, 10, 5)).toBe(0);
    expect(cursorAfter('End', 2, 10, 5)).toBe(9);
    expect(cursorAfter('PageDown', 2, 10, 5)).toBe(7);
    expect(cursorAfter('PageDown', 8, 10, 5)).toBe(9);
    expect(cursorAfter('PageUp', 2, 10, 5)).toBe(0);
  });
  it('starts from the first row when there is no cursor yet, and answers nothing for another key', () => {
    expect(cursorAfter('ArrowDown', -1, 10, 5)).toBe(0);
    expect(cursorAfter('ArrowUp', -1, 10, 5)).toBe(0);
    expect(cursorAfter('a', 3, 10, 5)).toBeNull();
    expect(cursorAfter('ArrowDown', 0, 0, 5)).toBeNull();
  });
});

describe('segments (a cue\'s text cut at its matches)', () => {
  it('is the whole text when nothing matches', () => {
    expect(segments('칼슘 펌프', undefined)).toEqual([{ text: '칼슘 펌프', match: false }]);
    expect(segments('칼슘 펌프', [])).toEqual([{ text: '칼슘 펌프', match: false }]);
  });
  it('cuts at each range, in order, keeping the text between', () => {
    expect(segments('가 칼슘 펌프와 칼슘 펌프', [[2, 7], [9, 14]])).toEqual([
      { text: '가 ', match: false },
      { text: '칼슘 펌프', match: true },
      { text: '와 ', match: false },
      { text: '칼슘 펌프', match: true },
    ]);
  });
  it('keeps a match at the start and the end', () => {
    expect(segments('abc', [[0, 3]])).toEqual([{ text: 'abc', match: true }]);
  });
});
