import { describe, expect, it } from 'vitest';
import { formatClock, spokenClock } from './videoTime';

describe('formatClock (design-spec 6.2: m:ss, h:mm:ss from an hour)', () => {
  it('shows minutes without a leading zero for a video under an hour', () => {
    expect(formatClock(1_100_000, 3_130_000)).toBe('18:20');
    expect(formatClock(18_000, 60_000)).toBe('0:18');
  });
  it('shows hours for a video of an hour or more, and keeps the same shape for the whole video', () => {
    expect(formatClock(3_723_000, 4_000_000)).toBe('1:02:03');
    expect(formatClock(5_000, 4_000_000)).toBe('0:00:05');
    expect(formatClock(3_600_000, 3_600_000)).toBe('1:00:00');
  });
  it('rounds down to the second and clamps what is not a time', () => {
    expect(formatClock(18_999, 60_000)).toBe('0:18');
    expect(formatClock(-5, 60_000)).toBe('0:00');
    expect(formatClock(Number.NaN, 60_000)).toBe('0:00');
    expect(formatClock(1_000, Number.NaN)).toBe('0:01');
  });
});

describe('spokenClock (aria-valuetext)', () => {
  it('names hours, minutes and seconds, leaving out the larger zero ones', () => {
    expect(spokenClock(1_100_000)).toBe('18분 20초');
    expect(spokenClock(3_723_000)).toBe('1시간 2분 3초');
    expect(spokenClock(0)).toBe('0초');
  });
  it('leaves out a zero second after a minute, and keeps a zero minute between an hour and seconds', () => {
    expect(spokenClock(60_000)).toBe('1분');
    expect(spokenClock(3_605_000)).toBe('1시간 0분 5초');
    expect(spokenClock(3_600_000)).toBe('1시간');
  });
});
