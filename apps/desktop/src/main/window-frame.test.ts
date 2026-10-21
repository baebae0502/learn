import { describe, expect, it } from 'vitest';
import { defaultFrame, frameAfterFullScreen } from './window-frame';

describe('main window frame (design-spec 2.1, Task 8 R3-1)', () => {
  it('a work area larger than 1440 × 900: the default size, centred', () => {
    expect(defaultFrame({ x: 0, y: 25, width: 1920, height: 1055 })).toEqual({ x: 240, y: 103, width: 1440, height: 900 });
  });
  it('a smaller work area (the 1024-pt runner): shrunk to it', () => {
    expect(defaultFrame({ x: 0, y: 25, width: 1024, height: 684 })).toEqual({ x: 0, y: 25, width: 1024, height: 684 });
    expect(defaultFrame({ x: 1440, y: 0, width: 1280, height: 775 })).toEqual({ x: 1440, y: 0, width: 1280, height: 775 });
  });
  it('a work area smaller than the minimum: the minimum wins', () => {
    expect(defaultFrame({ x: 0, y: 25, width: 900, height: 560 })).toEqual({ x: -30, y: 5, width: 960, height: 600 });
  });
  it('after full screen: puts back the frame from before when the restored one differs, kept inside the work area', () => {
    const area = { x: 0, y: 25, width: 1024, height: 684 };
    const before = { x: 0, y: 25, width: 1024, height: 684 };
    expect(frameAfterFullScreen(before, before, area)).toBeNull();
    expect(frameAfterFullScreen(before, { x: -416, y: 25, width: 1440, height: 684 }, area)).toEqual(before);
    expect(frameAfterFullScreen({ x: 40, y: 65, width: 960, height: 604 }, { x: 0, y: 25, width: 1440, height: 900 }, area)).toEqual({ x: 40, y: 65, width: 960, height: 604 });
    expect(frameAfterFullScreen(null, before, area)).toBeNull();
    // A frame from before that no longer fits (the display changed) is pulled back onto it.
    expect(frameAfterFullScreen({ x: 600, y: 25, width: 1000, height: 640 }, before, area)).toEqual({ x: 24, y: 25, width: 1000, height: 640 });
  });
});
