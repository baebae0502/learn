/** The zoom steps ⌘+ and ⌘− walk and the menu offers (1 is 100 %). */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** A scale this close to a step is that step: pdf.js rounds the scale it reports. */
const EPSILON = 0.005;

export const clampZoom = (scale: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));

/** The next step strictly beyond `current` in the direction, clamped to the ends. */
export function nextZoom(current: number, dir: 1 | -1): number {
  const step = dir === 1 ? ZOOM_STEPS.find((s) => s > current + EPSILON) : ZOOM_STEPS.findLast((s) => s < current - EPSILON);
  return clampZoom(step ?? current);
}

/** '125%': what the field shows. */
export const zoomPercent = (scale: number): string => `${Math.round(scale * 100)}%`;

/** What was typed in the field: a percent with or without the sign, clamped to 25–400 %; anything else is not a zoom. */
export function parseZoomInput(text: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(text.trim());
  if (!m) return null;
  return clampZoom(Number(m[1]!.replace(',', '.')) / 100);
}

/**
 * The factor a trackpad pinch (a wheel event with ctrl) multiplies the scale by, or null when the scale would not move:
 * the result stays within 25–400 %, so a pinch at the end gives no jitter.
 */
export function pinchScaleFactor(current: number, deltaY: number): number | null {
  const factor = clampZoom(current * Math.exp(-deltaY / 100)) / current;
  return Math.abs(factor - 1) < 1e-3 ? null : factor;
}
