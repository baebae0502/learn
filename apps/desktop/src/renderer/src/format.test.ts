import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatSize, homeRelative, msUntilMidnight } from './format';

const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 9, 21, 15, 0);

describe('format (design-spec 9)', () => {
  it('writes today and yesterday with the time, older dates as Y. M. D.', () => {
    expect(formatDate(at(2026, 10, 21, 9, 24), now)).toBe('오늘 오전 9:24');
    expect(formatDate(at(2026, 10, 20, 20, 40), now)).toBe('어제 오후 8:40');
    expect(formatDate(at(2026, 10, 12, 10, 0), now)).toBe('2026. 10. 12.');
    expect(formatDate(at(2025, 12, 31, 23, 59), new Date(2026, 0, 1, 8, 0))).toBe('어제 오후 11:59');
  });
  it('keeps the whole calendar day: 00:00 and 23:59 are today, a later day is a plain date', () => {
    expect(formatDate(at(2026, 10, 21, 0, 0), now)).toBe('오늘 오전 12:00');
    expect(formatDate(at(2026, 10, 21, 23, 59), now)).toBe('오늘 오후 11:59');
    expect(formatDate(at(2026, 10, 20, 0, 0), now)).toBe('어제 오전 12:00');
    expect(formatDate(at(2026, 10, 19, 23, 59), now)).toBe('2026. 10. 19.');
    expect(formatDate(at(2026, 10, 22, 0, 0), now)).toBe('2026. 10. 22.'); // a future date (clock change) is never 오늘/어제
  });
  it('shows a dash, not "Invalid Date", for a value that is not a date', () => {
    expect(formatDate('', now)).toBe('—');
    expect(formatDate('not a date', now)).toBe('—');
  });
  it('the next local midnight', () => {
    expect(msUntilMidnight(new Date(2026, 9, 21, 23, 59, 59, 0))).toBe(1000);
    expect(msUntilMidnight(new Date(2026, 9, 21, 0, 0, 0, 0))).toBe(24 * 3600 * 1000);
    expect(msUntilMidnight(new Date(2026, 11, 31, 12, 0))).toBe(12 * 3600 * 1000);
  });
  it('decimal units as Finder shows them, one decimal below 10 (critic T14-n8)', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(999)).toBe('999 B');
    expect(formatSize(1000)).toBe('1.0 KB');
    expect(formatSize(1761)).toBe('1.8 KB'); // the fixture PDF
    expect(formatSize(204_293)).toBe('204 KB'); // Finder says 204 KB (binary units said 200 KB)
    expect(formatSize(4_404_019)).toBe('4.4 MB');
    expect(formatSize(2_576_980_378)).toBe('2.6 GB');
    expect(formatSize(9_960)).toBe('10 KB'); // rounds to 10: whole, not "10.0"
    expect(formatSize(999_600)).toBe('1.0 MB'); // never "1000 KB"
    expect(formatSize(1_000_000_000_000)).toBe('1.0 TB');
  });
});

describe('homeRelative (paths on screen show the home folder as ~)', () => {
  it('abbreviates the exact home folder prefix only', () => {
    expect(homeRelative('/Users/a/Downloads/x.pdf', '/Users/a')).toBe('~/Downloads/x.pdf');
    expect(homeRelative('/Users/a', '/Users/a')).toBe('~');
    expect(homeRelative('/Users/ab/x.pdf', '/Users/a')).toBe('/Users/ab/x.pdf'); // a sibling folder that shares the prefix
    expect(homeRelative('/Volumes/disk/x.pdf', '/Users/a')).toBe('/Volumes/disk/x.pdf');
    expect(homeRelative('/Users/a/x.pdf', '/Users/a/')).toBe('~/x.pdf'); // a trailing separator on home
  });
  it('handles Windows backslashes', () => {
    expect(homeRelative('C:\\Users\\a\\Documents\\x.pdf', 'C:\\Users\\a')).toBe('~\\Documents\\x.pdf');
    expect(homeRelative('C:\\Users\\ab\\x.pdf', 'C:\\Users\\a')).toBe('C:\\Users\\ab\\x.pdf');
  });
  it('leaves the path alone without a usable home', () => {
    expect(homeRelative('/Users/a/x.pdf', null)).toBe('/Users/a/x.pdf');
    expect(homeRelative('/Users/a/x.pdf', '')).toBe('/Users/a/x.pdf');
    expect(homeRelative('/x.pdf', '/')).toBe('/x.pdf'); // a root "home" would abbreviate everything
  });
  it('writes a duration as a player does: m:ss under an hour, h:mm:ss from one, whole seconds (design-spec 9 "18:20")', () => {
    expect(formatDuration(10_030)).toBe('0:10');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(1_100_000)).toBe('18:20');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-5)).toBe('0:00');
  });
});
