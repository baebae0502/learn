import { describe, expect, it } from 'vitest';
import { formatDate, formatSize } from './format';

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 21, 15, 0);

describe('format (design-spec 9)', () => {
  it('writes today and yesterday with the time, older dates as Y. M. D.', () => {
    expect(formatDate(at(2026, 10, 21, 9, 24), now)).toBe('오늘 오전 9:24');
    expect(formatDate(at(2026, 10, 20, 20, 40), now)).toBe('어제 오후 8:40');
    expect(formatDate(at(2026, 10, 12, 10, 0), now)).toBe('2026. 10. 12.');
    expect(formatDate(at(2025, 12, 31, 23, 59), new Date(2026, 0, 1, 8, 0))).toBe('어제 오후 11:59');
  });
  it('keeps one decimal below 10 units', () => {
    expect(formatSize(4_404_019)).toBe('4.2 MB');
    expect(formatSize(2_576_980_378)).toBe('2.4 GB');
    expect(formatSize(512)).toBe('512 B');
  });
});
