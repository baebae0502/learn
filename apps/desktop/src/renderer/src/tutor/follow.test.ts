import { describe, expect, it } from 'vitest';
import { FOLLOW_SLACK, nearBottom, nextFollow } from './follow';

const at = (fromBottom: number) => ({ scrollTop: 1000 - 300 - fromBottom, scrollHeight: 1000, clientHeight: 300 });

describe('following the bottom while an answer comes', () => {
  it('counts 24 px from the bottom as at the bottom, 25 as not', () => {
    expect(FOLLOW_SLACK).toBe(24);
    expect(nearBottom(at(0))).toBe(true);
    expect(nearBottom(at(24))).toBe(true);
    expect(nearBottom(at(25))).toBe(false);
  });
  it('stops following when the user scrolls up, and an append alone does not bring it back', () => {
    expect(nextFollow(true, 'scrolled-up')).toBe(false);
    expect(nextFollow(false, 'append')).toBe(false);
    expect(nextFollow(true, 'append')).toBe(true);
  });
  it('follows again once the user is back at the bottom or presses 최신으로', () => {
    expect(nextFollow(false, 'pressed-latest')).toBe(true);
    expect(nextFollow(false, 'reached-bottom')).toBe(true);
  });
});
