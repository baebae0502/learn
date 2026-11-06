import { describe, expect, it } from 'vitest';
import type { ReadingPosition } from '@learn/domain';
import { readingLine } from './readingLine';

const now = new Date(2026, 10, 6, 12, 0);
const at = (d: Date): string => d.toISOString();
const base = { itemId: 'i', revisionId: 'r', progress: 0.4, updatedAt: at(new Date(2026, 10, 1, 9, 0)) };
const pdf = (pageIndex: number, pages?: number, extra: Partial<ReadingPosition> = {}): ReadingPosition => ({ ...base, openedAt: at(new Date(2026, 10, 6, 9, 24)), locator: { kind: 'pdf', pageIndex, ...(pages ? { pages } : {}) }, ...extra });
const video = (timeMs: number): ReadingPosition => ({ ...base, openedAt: at(new Date(2026, 10, 5, 20, 40)), locator: { kind: 'video', timeMs } });

describe('readingLine (the item panel 읽기 section)', () => {
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
