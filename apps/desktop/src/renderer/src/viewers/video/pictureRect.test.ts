import { describe, expect, it } from 'vitest';
import { pictureRect, type Rect } from './pictureRect';

/** Float arithmetic: the same box to a thousandth of a pixel. */
const near = (a: Rect | null, b: Rect): void => {
  expect(a).not.toBeNull();
  for (const k of ['left', 'top', 'width', 'height'] as const) expect(a![k]).toBeCloseTo(b[k], 3);
};

describe('pictureRect (the drawn picture of object-fit: contain)', () => {
  it('letterboxes a wide picture in a taller box', () => {
    near(pictureRect({ width: 1000, height: 800 }, { width: 1920, height: 1080 }), { left: 0, top: 118.75, width: 1000, height: 562.5 });
  });
  it('pillarboxes a tall picture in a wider box', () => {
    near(pictureRect({ width: 1000, height: 500 }, { width: 720, height: 1280 }), { left: 359.375, top: 0, width: 281.25, height: 500 });
  });
  it('fills a box of the picture\'s own shape, and scales a small picture up as the engine does', () => {
    near(pictureRect({ width: 1600, height: 900 }, { width: 160, height: 90 }), { left: 0, top: 0, width: 1600, height: 900 });
  });
  it('is nothing before the picture has a size or while the box has none (a hidden tab)', () => {
    expect(pictureRect({ width: 1000, height: 800 }, { width: 0, height: 0 })).toBeNull();
    expect(pictureRect({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBeNull();
  });
});
