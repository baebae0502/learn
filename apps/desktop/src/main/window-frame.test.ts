import { describe, expect, it } from 'vitest';
import { FullScreenFrameKeeper, defaultFrame, frameAfterFullScreen } from './window-frame';

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

describe('FullScreenFrameKeeper: the frame across full screen (polish minors 2 and 4)', () => {
  const work = { x: 0, y: 25, width: 1440, height: 875 };
  const user = { x: 40, y: 65, width: 960, height: 604 };
  const appKit = { x: -416, y: 25, width: 1440, height: 900 }; // what AppKit restored on run 39642950406
  const zoomedFrame = { x: 0, y: 25, width: 1440, height: 875 };

  it('re-applies the frame from before after AppKit restored another one', () => {
    const k = new FullScreenFrameKeeper();
    k.settled({ bounds: user, zoomed: false, fullscreen: false });
    k.enter(appKit);
    k.settled({ bounds: { x: 0, y: 0, width: 1440, height: 900 }, zoomed: false, fullscreen: true }); // ignored
    expect(k.leave(appKit)).toBe(true);
    expect(k.due(appKit, work)).toEqual(user);
  });

  it('nothing to do when AppKit already restored the frame', () => {
    const k = new FullScreenFrameKeeper();
    k.settled({ bounds: user, zoomed: false, fullscreen: false });
    k.enter(user);
    expect(k.leave(user)).toBe(true);
    expect(k.due(user, work)).toBeNull();
  });

  it('a zoomed window is left to AppKit: nothing re-applied, and the zoomed frame is never noted as the windowed one', () => {
    const k = new FullScreenFrameKeeper();
    k.settled({ bounds: user, zoomed: false, fullscreen: false });
    k.settled({ bounds: zoomedFrame, zoomed: true, fullscreen: false });
    k.enter(user);
    expect(k.leave(zoomedFrame)).toBe(false);
    expect(k.target).toBeNull();
    expect(k.due(zoomedFrame, work)).toBeNull();
    // Unzoomed later, then a round trip: back to the user's frame, not the zoomed one.
    k.settled({ bounds: user, zoomed: false, fullscreen: false });
    k.enter(user);
    expect(k.leave(appKit)).toBe(true);
    expect(k.due(appKit, work)).toEqual(user);
  });

  it('a move or resize by the user before the re-apply wins', () => {
    const k = new FullScreenFrameKeeper();
    k.settled({ bounds: user, zoomed: false, fullscreen: false });
    k.enter(user);
    expect(k.leave(appKit)).toBe(true);
    k.moved(appKit); // an event that did not change the frame (AppKit's own, repeated) keeps the re-apply
    expect(k.target).toEqual(user);
    k.moved({ ...appKit, x: 100 }); // the user dragged the window
    expect(k.target).toBeNull();
    expect(k.due({ ...appKit, x: 100 }, work)).toBeNull();
  });

  it('a minimized or full-screen frame is never noted; with nothing noted the fallback is used', () => {
    const k = new FullScreenFrameKeeper();
    k.settled({ bounds: { x: 0, y: 0, width: 10, height: 10 }, zoomed: false, fullscreen: false, minimized: true });
    k.enter(user);
    expect(k.leave(appKit)).toBe(true);
    expect(k.due(appKit, work)).toEqual(user);
  });

  it('leaving without having entered does nothing', () => {
    const k = new FullScreenFrameKeeper();
    expect(k.leave(user)).toBe(false);
    expect(k.due(user, work)).toBeNull();
  });
});
