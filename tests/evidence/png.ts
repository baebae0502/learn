// Minimal PNG decoder for evidence measurements in Node (no image library): 8-bit greyscale, grey+alpha, RGB or RGBA,
// non-interlaced — what screencapture and Playwright write. Ancillary chunks (colour profiles…) are ignored.
import zlib from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf: Uint8Array): RgbaImage {
  const view = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  for (let at = 8; at < view.length; ) {
    const len = view.readUInt32BE(at);
    const type = view.toString('latin1', at + 4, at + 8);
    const body = view.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8]!;
      colorType = body[9]!;
      if (depth !== 8 || !(colorType in CHANNELS) || body[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colorType}, interlace ${body[12]})`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const bpp = CHANNELS[colorType]!;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]!;
      const a = x >= bpp ? pixels[out + x - bpp]! : 0;
      const b = y > 0 ? pixels[out - stride + x]! : 0;
      const c = x >= bpp && y > 0 ? pixels[out - stride + x - bpp]! : 0;
      let p = v;
      if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else if (filter === 4) {
        const e = a + b - c;
        const pa = Math.abs(e - a), pb = Math.abs(e - b), pc = Math.abs(e - c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      pixels[out + x] = p & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp;
    if (bpp >= 3) {
      data[i * 4] = pixels[s]!;
      data[i * 4 + 1] = pixels[s + 1]!;
      data[i * 4 + 2] = pixels[s + 2]!;
      data[i * 4 + 3] = bpp === 4 ? pixels[s + 3]! : 255;
    } else {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = pixels[s]!;
      data[i * 4 + 3] = bpp === 2 ? pixels[s + 1]! : 255;
    }
  }
  return { width, height, data };
}

export const rgbAt = (img: RgbaImage, x: number, y: number): [number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
};

/** Relative luminance-ish brightness (0–255) for ink detection. */
export const luma = ([r, g, b]: readonly number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
