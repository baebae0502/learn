/** Raw RGBA pixels (straight, not premultiplied), row by row. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface ShotCompare {
  /** Pixels that differ under the rule in force. */
  count: number;
  /** Largest per-channel step among them (composited when `tolerant`). */
  maxDelta: number;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  first: string;
  /** One flag per pixel: 1 where it differs. */
  differs: Uint8Array;
}

/**
 * The per-channel step that two partially transparent renderings of the same pixel may differ by on macOS. Measured
 * on the sidebar's top strip over two real runs: the toggle's and the keycaps' soft edges come out with an alpha
 * that differs by up to 24 and colour channels by up to 2, and the edges of the keycaps' opaque fill by up to 8,
 * which is 8 steps at most once both are laid over the light sidebar colour. A one pixel shift of a glyph or border
 * changes an edge pixel by 60 steps or more, so 12 leaves room for the renderer's noise and none for a moved control.
 */
export const TRANSLUCENT_TOLERANCE = 12;

/** Whether any pixel of the image is not fully opaque (a shot taken over the macOS window material). */
export function isTranslucent(p: Pixels): boolean {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i]! < 255) return true;
  return false;
}

function over(d: Pixels['data'], i: number, k: number, fallback: readonly number[]): number {
  const alpha = d[i + 3]! / 255;
  return d[i + k]! * alpha + fallback[k]! * (1 - alpha);
}

/**
 * Compares two same-sized shots pixel by pixel. Exact (all four channels) unless `fallback` is given and either shot
 * is translucent; then both are laid over `fallback` (the sidebar's opaque colour without vibrancy, as RGB) and each
 * colour channel may differ by `TRANSLUCENT_TOLERANCE`. A pixel whose alpha moves far (a glyph that moved) still
 * fails, because the composite then moves by the glyph's contrast.
 */
export function compareShots(a: Pixels, b: Pixels, fallback: readonly number[] | null): ShotCompare {
  const tolerant = fallback !== null && (isTranslucent(a) || isTranslucent(b));
  const differs = new Uint8Array(a.width * a.height);
  let count = 0;
  let maxDelta = 0;
  let [x0, y0, x1, y1] = [a.width, a.height, -1, -1];
  let first = '';
  for (let i = 0; i < a.data.length; i += 4) {
    let delta = 0;
    if (tolerant) for (let k = 0; k < 3; k++) delta = Math.max(delta, Math.abs(over(a.data, i, k, fallback) - over(b.data, i, k, fallback)));
    else for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(a.data[i + k]! - b.data[i + k]!));
    if (delta === 0 || (tolerant && delta <= TRANSLUCENT_TOLERANCE)) continue;
    const px = (i / 4) % a.width;
    const py = Math.floor(i / 4 / a.width);
    differs[i / 4] = 1;
    count++;
    maxDelta = Math.max(maxDelta, Math.round(delta));
    [x0, y0, x1, y1] = [Math.min(x0, px), Math.min(y0, py), Math.max(x1, px), Math.max(y1, py)];
    if (first === '') first = `first at ${px},${py}: ${Array.from(a.data.slice(i, i + 4))} vs ${Array.from(b.data.slice(i, i + 4))}`;
  }
  return { count, maxDelta, box: count === 0 ? null : { x0, y0, x1, y1 }, first, differs };
}
