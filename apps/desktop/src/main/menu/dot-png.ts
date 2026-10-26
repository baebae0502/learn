import { crc32, deflateSync } from 'node:zlib';

/** A menu icon is 16 pt square; macOS draws it at 2× from a 32 px image. */
export const DOT_POINTS = 16;
export const DOT_SCALE = 2;
/** The dot itself is 8 pt across, as the chips' (design-spec 6 태그 칩). */
const DIAMETER_POINTS = 8;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A filled anti-aliased circle in `hex` (#rrggbb) on a transparent 32 px square, as a PNG. Hand-encoded (a menu icon is
 * the only image main draws): the same bytes on every platform, where a raw bitmap's channel order is the platform's.
 */
export function dotPng(hex: string): Buffer {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a colour: ${hex}`);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((x) => parseInt(x, 16)) as [number, number, number];
  const size = DOT_POINTS * DOT_SCALE;
  const radius = (DIAMETER_POINTS * DOT_SCALE) / 2;
  const middle = size / 2;
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride); // each row: filter byte 0, then RGBA
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - middle, y + 0.5 - middle);
      const coverage = Math.min(1, Math.max(0, radius - distance + 0.5));
      const at = y * stride + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = Math.round(coverage * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
