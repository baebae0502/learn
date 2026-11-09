import { describe, expect, it } from 'vitest';
import type { ReadingPosition } from '@learn/domain';
import { readingLine, readingProgressView } from './readingLine';

const now = new Date(2026, 10, 6, 12, 0);
const at = (d: Date): string => d.toISOString();
const base = { itemId: 'i', revisionId: 'r', progress: 0.4, updatedAt: at(new Date(2026, 10, 1, 9, 0)) };
const pdf = (pageIndex: number, pages?: number, extra: Partial<ReadingPosition> = {}): ReadingPosition => ({ ...base, openedAt: at(new Date(2026, 10, 6, 9, 24)), locator: { kind: 'pdf', pageIndex, ...(pages ? { pages } : {}) }, ...extra });
const video = (timeMs: number): ReadingPosition => ({ ...base, openedAt: at(new Date(2026, 10, 5, 20, 40)), locator: { kind: 'video', timeMs } });

const image = (extra: Partial<ReadingPosition> = {}): ReadingPosition => ({ ...base, progress: 1, openedAt: at(new Date(2026, 10, 6, 9, 24)), locator: { kind: 'image' }, ...extra });

describe('readingLine (the item panel 읽기 section)', () => {
  it('gives an image the day it was viewed, today or yesterday, with no place to stop at', () => {
    expect(readingLine(image(), now)).toBe('열어\u00a0봄\u00a0· 오늘 오전 9:24');
    expect(readingLine(image({ openedAt: at(new Date(2026, 10, 5, 20, 40)) }), now)).toBe('열어\u00a0봄\u00a0· 어제 오후 8:40');
    expect(readingLine(image({ openedAt: null }), now)).toBe('열어\u00a0봄\u00a0· 2026.\u00a011.\u00a01.');
  });
  it('names the page out of the total, binding number and unit with U+00A0', () => {
    expect(readingLine(pdf(11, 100), now)).toBe('12 / 100쪽에서 멈춤 · 오늘 오전 9:24');
  });
  it('names the page alone when the total was not saved', () => {
    expect(readingLine(pdf(11), now)).toBe('12쪽에서 멈춤 · 오늘 오전 9:24');
  });
  it('gives a video time as m:ss under an hour and h:mm:ss from one', () => {
    expect(readingLine(video(59_000), now)).toBe('0:59에서 멈춤 · 어제 오후 8:40');
    expect(readingLine(video(3_723_000), now)).toBe('1:02:03에서 멈춤 · 어제 오후 8:40');
  });
  it('dates with the table format: today, yesterday, a date; updatedAt when never opened', () => {
    expect(readingLine(pdf(0, 5, { openedAt: at(new Date(2026, 9, 12, 8, 0)) }), now)).toBe('1 / 5쪽에서 멈춤 · 2026. 10. 12.');
    expect(readingLine(pdf(0, 5, { openedAt: null }), now)).toBe('1 / 5쪽에서 멈춤 · 2026. 11. 1.');
  });
});

describe('readingProgressView', () => {
  it('shows the bar below 100 %, capped at 99', () => {
    expect(readingProgressView(0.4)).toEqual({ kind: 'bar', percent: 40 });
    expect(readingProgressView(0.999)).toEqual({ kind: 'bar', percent: 99 });
  });
  it('shows the finished flag alone at 100 %, as the table does', () => {
    expect(readingProgressView(1)).toEqual({ kind: 'done' });
  });
  it('shows nothing while the total is unknown', () => {
    expect(readingProgressView(null)).toEqual({ kind: 'none' });
  });
});
