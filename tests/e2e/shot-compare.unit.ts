import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareShots, type Pixels } from './shot-compare';

const FALLBACK = [240, 241, 242] as const;

/** A strip like the sidebar's: clear background, a 4x12 glyph of alpha 255 at `x`, soft edges (alpha 82) beside it. */
function strip(glyphX: number, edgeAlpha = 82): Pixels {
  const width = 40;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 2; y < 14; y++) {
    for (let x = glyphX; x < glyphX + 4; x++) data.set([60, 62, 66, 255], (y * width + x) * 4);
    data.set([84, 87, 93, edgeAlpha], (y * width + glyphX - 1) * 4);
    data.set([84, 87, 93, edgeAlpha], (y * width + glyphX + 4) * 4);
  }
  return { width, height, data };
}

describe('compareShots', () => {
  it('passes the same translucent strip with noisy soft edges (alpha and colour off by a few steps)', () => {
    expect(compareShots(strip(10, 82), strip(10, 100), FALLBACK).count).toBe(0);
  });
  it('fails a glyph shifted by one pixel, translucent or not', () => {
    expect(compareShots(strip(10), strip(11), FALLBACK).count).toBeGreaterThan(0);
    expect(compareShots(strip(10), strip(11), null).count).toBeGreaterThan(0);
  });
  it('keeps the exact compare without a fallback (Linux, opaque shots)', () => {
    expect(compareShots(strip(10, 82), strip(10, 83), null).count).toBeGreaterThan(0);
    const opaque = (v: number): Pixels => ({ width: 2, height: 1, data: new Uint8ClampedArray([v, 0, 0, 255, 0, 0, 0, 255]) });
    expect(compareShots(opaque(100), opaque(101), FALLBACK).count).toBe(1);
  });
  it('passes the two measured macOS pairs when the PNGs are on disk', () => {
    // The pairs were decoded to raw RGBA beforehand (see SHOT_PAIRS); skipped when absent (not in the repository).
    const dir = process.env.SHOT_PAIRS;
    if (!dir) return;
    for (const name of ['inspector.spec.ts-with_the_panel', 'shell.spec.ts-library']) {
      const read = (f: string): Pixels => {
        const raw = readFileSync(`${dir}/${name}-${f}.rgba`);
        return { width: 240, height: 88, data: new Uint8Array(raw) };
      };
      expect(compareShots(read('shot'), read('reference'), [240, 241, 242]).count, name).toBe(0);
      expect(compareShots(read('shot'), read('reference'), null).count, name).toBe(44);
    }
  });
});
