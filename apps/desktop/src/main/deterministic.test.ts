import { describe, expect, it } from 'vitest';
import { DETERMINISTIC_SWITCHES, isDeterministic } from './deterministic';

describe('deterministic rendering', () => {
  it('is opt-in through LEARN_DETERMINISTIC=1', () => {
    expect(isDeterministic({ LEARN_DETERMINISTIC: '1' })).toBe(true);
    expect(isDeterministic({ LEARN_DETERMINISTIC: '0' })).toBe(false);
    expect(isDeterministic({})).toBe(false);
  });
  it('pins colour profile, text antialiasing and compositing', () => {
    expect(DETERMINISTIC_SWITCHES.map(([k]) => k)).toEqual(['force-color-profile', 'disable-lcd-text', 'disable-gpu-compositing', 'font-render-hinting']);
  });
});
