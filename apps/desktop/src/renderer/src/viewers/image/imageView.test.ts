import { expect, test } from 'vitest';
import { DEFAULT_IMAGE_VIEW, imageLocator, imageViewFrom } from './imageView';

test('the default view is fit, centred, upright, and its locator carries none of it', () => {
  expect(DEFAULT_IMAGE_VIEW).toEqual({ zoom: 'fit', cx: 0.5, cy: 0.5, rotation: 0 });
  expect(imageLocator(DEFAULT_IMAGE_VIEW)).toEqual({ kind: 'image' });
});

test('fit leaves out the centre (the picture is in the middle); the rotation stays', () => {
  expect(imageLocator({ zoom: 'fit', cx: 0.2, cy: 0.9, rotation: 90 })).toEqual({ kind: 'image', rotation: 90 });
});

test('a number zoom carries the centre and the rotation; width carries the centre', () => {
  expect(imageLocator({ zoom: 2, cx: 0.25, cy: 0.75, rotation: 270 })).toEqual({ kind: 'image', zoom: 2, cx: 0.25, cy: 0.75, rotation: 270 });
  expect(imageLocator({ zoom: 'width', cx: 0.5, cy: 0.1, rotation: 0 })).toEqual({ kind: 'image', zoom: 'width', cy: 0.1 });
  // A centre held to the stored precision: a scroll of a fraction of a pixel is not a new place.
  expect(imageLocator({ zoom: 3, cx: 0.123456789, cy: 0.5, rotation: 0 })).toEqual({ kind: 'image', zoom: 3, cx: 0.1235 });
});

test('nothing saved, or a place of another kind, opens at the default', () => {
  expect(imageViewFrom(undefined)).toEqual(DEFAULT_IMAGE_VIEW);
  expect(imageViewFrom({ kind: 'pdf', pageIndex: 3, zoom: 2 })).toEqual(DEFAULT_IMAGE_VIEW);
  expect(imageViewFrom({ kind: 'video', timeMs: 5000 })).toEqual(DEFAULT_IMAGE_VIEW);
  expect(imageViewFrom({ kind: 'image' })).toEqual(DEFAULT_IMAGE_VIEW);
});

test('a view goes to its locator and back', () => {
  for (const v of [
    { zoom: 4, cx: 0.62, cy: 0.43, rotation: 90 },
    { zoom: 'width', cx: 0.5, cy: 0.8, rotation: 180 },
    { zoom: 'fit', cx: 0.5, cy: 0.5, rotation: 270 },
    { zoom: 0.05, cx: 0, cy: 1, rotation: 0 },
  ] as const) {
    expect(imageViewFrom(imageLocator(v))).toEqual(v);
  }
});
