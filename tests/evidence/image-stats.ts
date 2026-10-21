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

const contrastOf = (a: readonly number[], b: readonly number[]) => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: readonly number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
};

/**
 * One element on a fixed layout (Task 8 R3-3): its surface (mode), its ink (the pixel farthest in brightness), the
 * WCAG ratio between them, and whether the ink is a solid colour — at least 20 pixels within 2 levels of it — rather
 * than one anti-aliased edge.
 */
export function elementStats(img: RgbaImage, box: Box) {
  const clipped = { x0: Math.max(0, box.x0), y0: Math.max(0, box.y0), x1: Math.min(img.width, box.x1), y1: Math.min(img.height, box.y1) };
  const { surface, ink } = regionStats(img, clipped);
  let atExtreme = 0;
  for (let y = clipped.y0; y < clipped.y1; y++) {
    for (let x = clipped.x0; x < clipped.x1; x++) {
      const c = rgbAt(img, x, y);
      if (Math.max(...c.map((v, i) => Math.abs(v - ink[i]!))) <= 2) atExtreme++;
    }
  }
  return { box: clipped, surface, ink, ratio: contrastOf(ink, surface), atExtreme, solid: atExtreme >= 20 };
}

/** The selected row in a sidebar column: the band of rows whose fill differs from the column's surface. */
export function selectionBand(img: RgbaImage, box: Box) {
  const surface = modeColour(img, box);
  let band: { y0: number; y1: number } | null = null;
  for (let y = box.y0; y < box.y1; y++) {
    const fill = modeColour(img, { x0: box.x0, y0: y, x1: box.x1, y1: y + 1 });
    const differs = Math.max(...fill.map((v, i) => Math.abs(v - surface[i]!))) > 8;
    if (differs) {
      if (band && band.y1 === y) band.y1 = y + 1;
      else if (!band || band.y1 - band.y0 < 12) band = { y0: y, y1: y + 1 };
    }
  }
  if (!band || band.y1 - band.y0 < 12) return null;
  const row = { x0: box.x0, y0: band.y0, x1: box.x1, y1: band.y1 };
  return { band, ...elementStats(img, row) };
}
