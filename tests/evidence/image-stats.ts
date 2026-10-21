// Small pixel statistics for evidence values (Finder reference colours, glyph ink) on decoded PNGs.
import { luma, rgbAt, type RgbaImage } from './png';
import type { Box } from './menu-rows';

/** The most common colour in `box` (4-bit buckets, then the bucket's mean) — the surface a region sits on. */
export function modeColour(img: RgbaImage, box: Box): [number, number, number] {
  const buckets = new Map<number, { n: number; sum: [number, number, number] }>();
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const c = rgbAt(img, x, y);
      const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4);
      const b = buckets.get(k) ?? { n: 0, sum: [0, 0, 0] as [number, number, number] };
      b.n++;
      b.sum[0] += c[0];
      b.sum[1] += c[1];
      b.sum[2] += c[2];
      buckets.set(k, b);
    }
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0]!;
  return top.sum.map((v) => Math.round(v / top.n)) as [number, number, number];
}

const chroma = ([r, g, b]: readonly number[]) => Math.max(r!, g!, b!) - Math.min(r!, g!, b!);

/**
 * A region's surface, its ink (the pixel farthest in brightness from the surface: title text, glyphs) and its most
 * coloured pixel (an accent-tinted icon, or none when everything is grey).
 */
export function regionStats(img: RgbaImage, box: Box) {
  const surface = modeColour(img, box);
  let ink = surface;
  let inkDistance = 0;
  let colourful = surface;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const c = rgbAt(img, x, y);
      const d = Math.abs(luma(c) - luma(surface));
      if (d > inkDistance) {
        inkDistance = d;
        ink = c;
      }
      if (chroma(c) > chroma(colourful)) colourful = c;
    }
  }
  return { surface, ink, colourful, colourfulChroma: chroma(colourful) };
}

/** Glyph ink of a text sample: the summed brightness difference from its surface (0–1 per pixel). */
export function inkMass(img: RgbaImage): number {
  const box = { x0: 0, y0: 0, x1: img.width, y1: img.height };
  const surface = luma(modeColour(img, box));
  let sum = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) sum += Math.abs(luma(rgbAt(img, x, y)) - surface) / 255;
  return Math.round(sum * 10) / 10;
}
