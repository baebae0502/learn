import { describe, expect, it } from 'vitest';
import { CAPTION_BOX, captionBottom, captionSpot, parkSpot, type Rect } from './demo-geometry';

/** The settings window as settings-window.ts opens it: 600 wide, centred across the main window, 96 below its top. */
const settingsOver = (main: Rect, height = 518): Rect => ({ x: main.x + (main.width - 600) / 2, y: main.y + 96, width: 600, height });
/** The 11b nudge: moved to the main window's right, 24 from its edge. */
const nudged = (main: Rect, s: Rect): Rect => ({ ...s, x: Math.max(main.x, main.x + main.width - s.width - 24) });

describe('where a settings chapter is captioned (concern 4, Mac risk 7)', () => {
  it('1600 × 900 (the display switch worked): always the main window, at full width', () => {
    const main = { x: 80, y: 25, width: 1440, height: 875 };
    const s = settingsOver(main);
    expect(captionSpot(main, s)).toEqual({ target: 'main' });
    expect(captionSpot(main, nudged(main, s))).toEqual({ target: 'main' });
  });

  it('1024 × 743 (the switch failed): the centred window leaves no room (11a: its own overlay); moved aside, a narrower caption in the main window (11b, 11c)', () => {
    const main = { x: 0, y: 25, width: 1024, height: 743 };
    const s = settingsOver(main);
    expect(captionSpot(main, s)).toEqual({ target: 'settings' }); // 212 − 48 = 164 px: too narrow
    expect(captionSpot(main, nudged(main, s))).toEqual({ target: 'main', maxWidth: 352 }); // x 400 − 48
  });

  it('a narrower caption is used only when its taller box stays clear of the settings window', () => {
    const main = { x: 0, y: 25, width: 1024, height: 743 };
    // A settings window reaching down to the bottom, 300 from the left: a 252 px caption fits beside it.
    expect(captionSpot(main, { x: 300, y: 60, width: 600, height: 700 })).toEqual({ target: 'main', maxWidth: 252 });
    // One starting further left than the minimum: its own overlay.
    expect(captionSpot(main, { x: 250, y: 60, width: 600, height: 700 })).toEqual({ target: 'settings' });
  });
});

describe('where the arrow rests while Finder is in front (Mac risk 8)', () => {
  it('on the desktop beside the Learn window: the middle of the wider side margin', async () => {
    const { desktopSpot } = await import('./demo-geometry');
    const display = { x: 0, y: 0, width: 1600, height: 900 };
    const learn = { x: 80, y: 25, width: 1440, height: 875 }; // mac1: 80 points of desktop on each side
    const finder = { x: 728, y: 288, width: 600, height: 380 };
    expect(desktopSpot(display, learn, finder)).toEqual({ x: 1560, y: 450 });
    expect(desktopSpot(display, { ...learn, x: 140 }, finder)).toEqual({ x: 70, y: 450 }); // the left margin is wider
  });
  it("with no margin: under the Finder window, 40 from its edge and from the screen's", async () => {
    const { desktopSpot } = await import('./demo-geometry');
    const display = { x: 0, y: 0, width: 1024, height: 768 };
    const learn = { x: 0, y: 25, width: 1024, height: 743 };
    expect(desktopSpot(display, learn, { x: 404, y: 248, width: 600, height: 380 })).toEqual({ x: 704, y: 668 });
    // No room under it either: beside it, on the left.
    expect(desktopSpot(display, learn, { x: 404, y: 360, width: 600, height: 380 })).toEqual({ x: 364, y: 384 });
  });
});

describe('the caption and the parked pointer clear the sidebar\'s tag selector (round 2 minors 2, 3)', () => {
  it('the caption stays at 108 while the selector is lower, and rises to 16 above it once it reaches higher', () => {
    expect(captionBottom(684, null)).toBe(108);
    expect(captionBottom(684, 620)).toBe(108); // 684 − 620 + 16 = 80: lower than the pill band's top
    expect(captionBottom(684, 540)).toBe(160); // a selector that wrapped to two rows
  });

  it('the pointer rests under the tree\'s last row, or higher when a three-line caption would reach it', () => {
    expect(parkSpot(684, 300, 540)).toEqual({ x: 120, y: 348 });
    expect(parkSpot(684, 500, 540).y).toBe(684 - 160 - 96 - 28);
    const tall = parkSpot(684, 520, 540); // a long tree: above the caption's top, the arrow included
    expect(tall.y + 28).toBeLessThanOrEqual(684 - captionBottom(684, 540) - CAPTION_BOX.lines3);
    expect(parkSpot(684, 640, null)).toEqual({ x: 120, y: 684 - 108 - 96 - 28 }); // no selector: above the caption box
  });

  it('a raised caption is checked against the settings window where it really is', () => {
    const main = { x: 0, y: 25, width: 1440, height: 875 };
    const s = { x: 400, y: 500, width: 600, height: 150 }; // clear of the box at 108, over it at 300
    expect(captionSpot(main, s)).toEqual({ target: 'main' });
    expect(captionSpot(main, s, 300)).toEqual({ target: 'main', maxWidth: 352 }); // narrower, left of it
  });
});
