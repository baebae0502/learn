import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DOT_POINTS, DOT_SCALE, dotPng } from './dot-png';

/** The chunks of a PNG, with whether each CRC holds. */
function chunks(png: Buffer): Array<{ type: string; data: Buffer; crcOk: boolean }> {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const out: Array<{ type: string; data: Buffer; crcOk: boolean }> = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const data = png.subarray(at + 8, at + 8 + length);
    out.push({ type: png.toString('ascii', at + 4, at + 8), data, crcOk: png.readUInt32BE(at + 8 + length) === crc32(png.subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  return out;
}
/** RGBA of every pixel, from a PNG of filter-0 rows. */
function pixels(png: Buffer): { size: number; at(x: number, y: number): number[] } {
  const parts = chunks(png);
  const size = parts[0]!.data.readUInt32BE(0);
  const raw = inflateSync(Buffer.concat(parts.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = 1 + size * 4;
  return { size, at: (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)] };
}

describe('a menu colour dot', () => {
  const png = dotPng('#5fb236');
  const px = pixels(png);
  it('is a valid 32 px RGBA PNG (16 pt at 2×): IHDR, IDAT, IEND with true checksums', () => {
    const parts = chunks(png);
    expect(parts.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(parts.every((c) => c.crcOk)).toBe(true);
    expect(DOT_POINTS * DOT_SCALE).toBe(32);
    expect([parts[0]!.data.readUInt32BE(0), parts[0]!.data.readUInt32BE(4), parts[0]!.data[8], parts[0]!.data[9]]).toEqual([32, 32, 8, 6]);
  });
  it('is a filled circle 8 pt across in the colour: opaque in the middle, clear at the corners, soft at the rim', () => {
    expect(px.at(16, 16)).toEqual([0x5f, 0xb2, 0x36, 255]);
    expect(px.at(0, 0)[3]).toBe(0);
    expect(px.at(31, 31)[3]).toBe(0);
    let area = 0;
    let soft = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const a = px.at(x, y)[3]!;
        area += a / 255;
        if (a > 0 && a < 255) soft++;
        expect(a, `mirrored at ${x},${y}`).toBe(px.at(31 - x, y)[3]); // the same left and right
      }
    }
    expect(soft).toBeGreaterThan(0); // anti-aliased
    expect(Math.abs(area - Math.PI * 8 * 8)).toBeLessThan(6); // radius 8 px
  });
  it('has the 0.5 pt inner border (design-spec 4): the outer pixel is darker than the middle, a light colour keeps its outline', () => {
    const edge = px.at(23, 16);
    const middle = px.at(16, 16);
    for (let i = 0; i < 3; i++) expect(edge[i]!, `channel ${i}`).toBeLessThan(middle[i]!);
    expect(edge[3]!).toBeGreaterThan(240); // darkened, not thinned
    expect(px.at(20, 16)).toEqual(middle); // inside the 1 px rim nothing changes
  });
  it('refuses anything but #rrggbb', () => {
    for (const bad of ['red', '#fff', '5fb236', '#5fb23g']) expect(() => dotPng(bad), bad).toThrow();
  });
});
