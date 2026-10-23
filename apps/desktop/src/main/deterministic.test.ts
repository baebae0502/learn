import { describe, expect, it } from 'vitest';
import { DETERMINISTIC_SWITCHES, isDeterministic, isE2E } from './deterministic';

describe('deterministic rendering', () => {
  it('is opt-in through LEARN_DETERMINISTIC=1, in an unpackaged build only (final review m3)', () => {
    expect(isDeterministic(false, { LEARN_DETERMINISTIC: '1' })).toBe(true);
    expect(isDeterministic(false, { LEARN_DETERMINISTIC: '0' })).toBe(false);
    expect(isDeterministic(false, {})).toBe(false);
    expect(isDeterministic(true, { LEARN_DETERMINISTIC: '1' })).toBe(false);
  });
  it('LEARN_E2E=1 counts in an unpackaged build only: a packaged build relaunches for real (final review m3)', () => {
    expect(isE2E(false, { LEARN_E2E: '1' })).toBe(true);
    expect(isE2E(false, {})).toBe(false);
    expect(isE2E(true, { LEARN_E2E: '1' })).toBe(false);
  });
  it('pins colour profile, text antialiasing and compositing', () => {
    expect(DETERMINISTIC_SWITCHES.map(([k]) => k)).toEqual(['force-color-profile', 'disable-lcd-text', 'disable-gpu-compositing', 'font-render-hinting']);
  });
});
