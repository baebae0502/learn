import { IMAGE_BACKGROUNDS, type ImageBackground, type ReadingLocator } from '@learn/domain';
import { clampImageZoom, type ImageZoom, type Rotation } from './imageFit';

/** What the image reader remembers (spec 4.4): the zoom, the picture point at the stage's centre (0–1, upright picture) and the turn. */
export interface ImageView {
  zoom: ImageZoom;
  cx: number;
  cy: number;
  rotation: Rotation;
}

export const DEFAULT_IMAGE_VIEW: ImageView = Object.freeze({ zoom: 'fit', cx: 0.5, cy: 0.5, rotation: 0 });

type ImageLocator = Extract<ReadingLocator, { kind: 'image' }>;

/** The view a stored place asks for; nothing stored, or a place of another kind, is the default. */
export function imageViewFrom(locator: ReadingLocator | undefined): ImageView {
  if (locator?.kind !== 'image') return { ...DEFAULT_IMAGE_VIEW };
  return {
    zoom: typeof locator.zoom === 'number' ? clampImageZoom(locator.zoom) : (locator.zoom ?? 'fit'),
    cx: locator.cx ?? 0.5,
    cy: locator.cy ?? 0.5,
    rotation: locator.rotation ?? 0,
  };
}

/** Four places: a ten-thousandth of the picture, so a scroll of a fraction of a pixel is not a new place to save. */
const held = (n: number): number => Math.min(1, Math.max(0, Math.round(n * 1e4) / 1e4));

/**
 * The stored place of a view: what equals the default is left out (fit, the middle, upright), so a picture never moved keeps the
 * `{ kind: 'image' }` its open recorded; fit has no centre to keep (the picture is in the middle).
 */
export function imageLocator(v: ImageView): ImageLocator {
  const fit = v.zoom === 'fit';
  const cx = held(v.cx);
  const cy = held(v.cy);
  return {
    kind: 'image',
    ...(fit ? {} : { zoom: typeof v.zoom === 'number' ? clampImageZoom(v.zoom) : v.zoom }),
    ...(!fit && cx !== 0.5 ? { cx } : {}),
    ...(!fit && cy !== 0.5 ? { cy } : {}),
    ...(v.rotation !== 0 ? { rotation: v.rotation } : {}),
  };
}

/** The stored setting, or nothing for anything unset or unreadable. */
export function parseImageBackground(raw: unknown): ImageBackground | undefined {
  return IMAGE_BACKGROUNDS.find((b) => b === raw);
}

/** The ground a picture is drawn on: the choice made, else the app theme's light or dark. */
export function effectiveBackground(stored: ImageBackground | undefined, theme: 'light' | 'dark'): ImageBackground {
  return stored ?? theme;
}
