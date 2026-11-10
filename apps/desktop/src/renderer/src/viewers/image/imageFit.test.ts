import { describe, expect, test } from 'vitest';
import {
  IMAGE_MARGIN,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  IMAGE_ZOOM_STEPS,
  clampImageZoom,
  fitScale,
  imageLayout,
  imagePinchFactor,
  nextImageZoom,
  parseImageZoomInput,
  placedCentre,
  pointAt,
  rotatedSize,
  scrollFor,
} from './imageFit';

const stage = { width: 1000, height: 700 };

test('fit never enlarges a small image; width does; both keep 24 on every side and follow the rotation', () => {
  expect(fitScale({ width: 4032, height: 3024 }, 0, stage, 'fit')).toBeCloseTo(652 / 3024, 6);
  expect(fitScale({ width: 4032, height: 3024 }, 90, stage, 'fit')).toBeCloseTo(652 / 4032, 6);
  expect(fitScale({ width: 200, height: 100 }, 0, stage, 'fit')).toBe(1);
  expect(fitScale({ width: 200, height: 100 }, 0, stage, 'width')).toBeCloseTo(952 / 200, 6);
  expect(fitScale({ width: 100, height: 100 }, 0, stage, 'width')).toBe(8);
  expect(fitScale({ width: 400_000, height: 10 }, 0, stage, 'fit')).toBe(0.05);
});

test('a smaller picture sits in the middle; a larger one gets 24 around it', () => {
  expect(imageLayout({ width: 200, height: 100 }, 0, stage, 1)).toEqual({ scale: 1, box: { width: 200, height: 100 }, content: stage, offset: { x: 400, y: 300 } });
  expect(imageLayout({ width: 2000, height: 1000 }, 90, stage, 1).content).toEqual({ width: 1048, height: 2048 });
});

test.each([0, 90, 180, 270] as const)('the point under the stage centre survives scrollFor → pointAt at %i°', (r) => {
  const l = imageLayout({ width: 4000, height: 3000 }, r, stage, 0.5);
  const at = { x: 500, y: 350 };
  const p = { x: 0.3, y: 0.6 };
  const back = pointAt(l, r, scrollFor(l, r, stage, p, at), at);
  expect(back.x).toBeCloseTo(0.3, 6);
  expect(back.y).toBeCloseTo(0.6, 6);
});

test('a quarter turn clockwise puts the top-left corner top-right', () => {
  const l = imageLayout({ width: 100, height: 100 }, 90, { width: 148, height: 148 }, 1);
  expect(pointAt(l, 90, { x: 0, y: 0 }, { x: 124 - 1e-9, y: 24 })).toEqual({ x: expect.closeTo(0, 6), y: expect.closeTo(0, 6) });
});

test('steps, pinch and the field stay within 5–800 %', () => {
  expect(nextImageZoom(0.2156, 1)).toBe(0.25);
  expect(nextImageZoom(0.05, -1)).toBe(0.05);
  expect(nextImageZoom(8, 1)).toBe(8);
  expect(imagePinchFactor(8, -50)).toBeNull();
  expect(parseImageZoomInput('1000%')).toBe(8);
  expect(parseImageZoomInput('3')).toBe(0.05);
  expect(parseImageZoomInput('abc')).toBeNull();
});

describe('the rest of the arithmetic', () => {
  test('the constants are the spec’s', () => {
    expect(IMAGE_MARGIN).toBe(24);
    expect([IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX]).toEqual([0.05, 8]);
    expect(IMAGE_ZOOM_STEPS).toEqual([0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8]);
    expect([clampImageZoom(0.01), clampImageZoom(0.4), clampImageZoom(20)]).toEqual([0.05, 0.4, 8]);
  });

  test('a quarter turn swaps the sides; a half turn does not', () => {
    const natural = { width: 40, height: 60 };
    expect(rotatedSize(natural, 0)).toEqual({ width: 40, height: 60 });
    expect(rotatedSize(natural, 90)).toEqual({ width: 60, height: 40 });
    expect(rotatedSize(natural, 180)).toEqual({ width: 40, height: 60 });
    expect(rotatedSize(natural, 270)).toEqual({ width: 60, height: 40 });
  });

  test('a step lands on the next step strictly beyond, both ways', () => {
    expect(nextImageZoom(1, 1)).toBe(1.25);
    expect(nextImageZoom(1, -1)).toBe(0.75);
    expect(nextImageZoom(0.2156, -1)).toBe(0.17);
    expect(nextImageZoom(1.249, 1)).toBe(1.5); // a scale within rounding of a step is that step
  });

  test('a pinch multiplies by exp(−deltaY / 100) and stops at the ends', () => {
    expect(imagePinchFactor(1, -100)).toBeCloseTo(Math.E, 6);
    expect(imagePinchFactor(1, 100)).toBeCloseTo(1 / Math.E, 6);
    expect(imagePinchFactor(6, -100)).toBeCloseTo(8 / 6, 6); // clamped at 800 %
    expect(imagePinchFactor(0.05, 50)).toBeNull();
  });

  test('the field takes a percent with or without the sign, a comma or a point', () => {
    expect(parseImageZoomInput('250')).toBe(2.5);
    expect(parseImageZoomInput(' 12,5 % ')).toBe(0.125);
    expect(parseImageZoomInput('')).toBeNull();
    expect(parseImageZoomInput('-20')).toBeNull();
  });

  test('scrollFor never goes below 0 or past the end', () => {
    const l = imageLayout({ width: 4000, height: 3000 }, 0, stage, 0.5); // content 2048 × 1548
    expect(scrollFor(l, 0, stage, { x: 0, y: 0 }, { x: 500, y: 350 })).toEqual({ x: 0, y: 0 });
    expect(scrollFor(l, 0, stage, { x: 1, y: 1 }, { x: 500, y: 350 })).toEqual({ x: 1048, y: 848 });
    // A picture that fits has nothing to scroll.
    const small = imageLayout({ width: 200, height: 100 }, 0, stage, 1);
    expect(scrollFor(small, 0, stage, { x: 0.9, y: 0.1 }, { x: 500, y: 350 })).toEqual({ x: 0, y: 0 });
  });

  test('pointAt clamps a stage point outside the picture to its edge', () => {
    const small = imageLayout({ width: 200, height: 100 }, 0, stage, 1);
    expect(pointAt(small, 0, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(pointAt(small, 0, { x: 0, y: 0 }, { x: 999, y: 699 })).toEqual({ x: 1, y: 1 });
    expect(pointAt(small, 0, { x: 0, y: 0 }, { x: 500, y: 350 })).toEqual({ x: 0.5, y: 0.5 });
  });

  test('a half turn and a three-quarter turn take the corners round', () => {
    const l180 = imageLayout({ width: 100, height: 100 }, 180, { width: 148, height: 148 }, 1);
    expect(pointAt(l180, 180, { x: 0, y: 0 }, { x: 24, y: 24 })).toEqual({ x: 1, y: 1 }); // the top-left of the stage shows the bottom-right
    const l270 = imageLayout({ width: 100, height: 100 }, 270, { width: 148, height: 148 }, 1);
    expect(pointAt(l270, 270, { x: 0, y: 0 }, { x: 24, y: 24 })).toEqual({ x: 1, y: 0 }); // top-right of the image goes top-left
  });
});

describe('the centre a placement leaves', () => {
  const photo = { width: 4032, height: 3024 };
  const middle = { x: 500, y: 350 };

  test('⌘− from the top-left corner: the scroll is held at 0, so the centre is the point the stage shows, not the one zoomed about', () => {
    const at100 = imageLayout(photo, 0, stage, 1);
    const p = pointAt(at100, 0, { x: 0, y: 0 }, middle);
    expect(p.x).toBeCloseTo(0.118, 3);
    expect(p.y).toBeCloseTo(0.108, 3);
    const at75 = imageLayout(photo, 0, stage, 0.75);
    const applied = scrollFor(at75, 0, stage, p, middle);
    expect(applied).toEqual({ x: 0, y: 0 });
    const c = placedCentre(at75, 0, stage, { p, at: null }, applied);
    expect(c.x).toBeCloseTo(0.157, 3);
    expect(c.y).toBeCloseTo(0.144, 3);
  });

  test('an anchor that landed (within a pixel) is the centre itself, so a restore stores what it read', () => {
    const l = imageLayout(photo, 90, stage, 2);
    const p = { x: 0.4123, y: 0.6789 };
    const exact = scrollFor(l, 90, stage, p, middle);
    expect(placedCentre(l, 90, stage, { p, at: null }, { x: Math.round(exact.x), y: Math.round(exact.y) })).toEqual(p);
  });

  test('width from an off-centre view: no sideways scroll, so the centre is the middle across (no stray cx)', () => {
    const tall = { width: 1000, height: 3000 };
    const l = imageLayout(tall, 0, stage, fitScale(tall, 0, stage, 'width'));
    const p = { x: 0.3, y: 0.4 };
    const c = placedCentre(l, 0, stage, { p, at: null }, scrollFor(l, 0, stage, p, middle));
    expect(c.x).toBeCloseTo(0.5, 9);
    expect(c.y).toBeCloseTo(0.4, 6);
  });

  test('fit puts the picture in the middle whatever it was anchored at', () => {
    const l = imageLayout(photo, 0, stage, fitScale(photo, 0, stage, 'fit'));
    const p = { x: 0.2, y: 0.9 };
    expect(placedCentre(l, 0, stage, { p, at: null }, scrollFor(l, 0, stage, p, middle))).toEqual({ x: expect.closeTo(0.5, 9), y: expect.closeTo(0.5, 9) });
  });

  test('a pinch anchors at the pointer: the centre is read from the stage', () => {
    const l = imageLayout(photo, 0, stage, 2);
    const p = { x: 0.6, y: 0.3 };
    const at = { x: 200, y: 100 };
    const applied = scrollFor(l, 0, stage, p, at);
    expect(placedCentre(l, 0, stage, { p, at }, applied)).toEqual(pointAt(l, 0, applied, middle));
  });
});
