import { describe, expect, it } from 'vitest';
import { isDemoOverlay } from './demo';

describe('demo overlay switch', () => {
  it('is on only for LEARN_DEMO_OVERLAY=1 in an unpackaged build', () => {
    expect(isDemoOverlay(false, { LEARN_DEMO_OVERLAY: '1' })).toBe(true);
    expect(isDemoOverlay(false, { LEARN_DEMO_OVERLAY: '0' })).toBe(false);
    expect(isDemoOverlay(false, { LEARN_DEMO_OVERLAY: 'true' })).toBe(false);
    expect(isDemoOverlay(false, {})).toBe(false);
  });
  it('is ignored by a packaged build, whatever the environment says', () => {
    expect(isDemoOverlay(true, { LEARN_DEMO_OVERLAY: '1' })).toBe(false);
    expect(isDemoOverlay(true, {})).toBe(false);
  });
});
