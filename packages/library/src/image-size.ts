import { sniffImage } from './sniff';

/** How much of a file is read to find its pixel size. */
export const IMAGE_HEAD_BYTES = 1024 * 1024;
/** The largest side taken as real; more is a broken or hostile header. */
export const IMAGE_SIDE_MAX = 1_000_000;

export interface PixelSize {
  width: number;
  height: number;
}

// Every read goes through these: out of range gives undefined, never an exception, because the head is untrusted.
const u8 = (b: Uint8Array, at: number): number | undefined => (at >= 0 && at < b.length ? b[at] : undefined);
function u16(b: Uint8Array, at: number, little: boolean): number | undefined {
  if (at < 0 || at + 2 > b.length) return undefined;
  return little ? b[at]! | (b[at + 1]! << 8) : (b[at]! << 8) | b[at + 1]!;
}
function u32(b: Uint8Array, at: number, little: boolean): number | undefined {
  if (at < 0 || at + 4 > b.length) return undefined;
  const v = little
    ? b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)
    : (b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
  return v >>> 0;
}
function tag(b: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function size(width: number | undefined, height: number | undefined): PixelSize | null {
  if (width === undefined || height === undefined) return null;
  if (width < 1 || height < 1 || width > IMAGE_SIDE_MAX || height > IMAGE_SIDE_MAX) return null;
  return { width, height };
}

function pngSize(b: Uint8Array): PixelSize | null {
  if (!tag(b, 12, 'IHDR')) return null;
  return size(u32(b, 16, false), u32(b, 20, false));
}

function gifSize(b: Uint8Array): PixelSize | null {
  return size(u16(b, 6, true), u16(b, 8, true));
}

function webpSize(b: Uint8Array): PixelSize | null {
  if (tag(b, 12, 'VP8 ')) {
    if (u8(b, 23) !== 0x9d || u8(b, 24) !== 0x01 || u8(b, 25) !== 0x2a) return null;
    const w = u16(b, 26, true);
    const h = u16(b, 28, true);
    return size(w === undefined ? undefined : w & 0x3fff, h === undefined ? undefined : h & 0x3fff);
  }
  if (tag(b, 12, 'VP8L')) {
    if (u8(b, 20) !== 0x2f) return null;
    const v = u32(b, 21, true);
    return v === undefined ? null : size((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
  }
  if (tag(b, 12, 'VP8X')) {
    const w = b.length >= 27 ? b[24]! | (b[25]! << 8) | (b[26]! << 16) : undefined;
    const h = b.length >= 30 ? b[27]! | (b[28]! << 8) | (b[29]! << 16) : undefined;
    return size(w === undefined ? undefined : w + 1, h === undefined ? undefined : h + 1);
  }
  return null;
}

/** The EXIF orientation (1–8) inside an APP1 body that runs from `start` to `end`, or undefined. */
function exifOrientation(b: Uint8Array, start: number, end: number): number | undefined {
  if (!tag(b, start, 'Exif\0\0') || end > b.length) return undefined;
  const tiff = start + 6;
  const little = tag(b, tiff, 'II');
  if (!little && !tag(b, tiff, 'MM')) return undefined;
  if (u16(b, tiff + 2, little) !== 42) return undefined;
  const ifd = u32(b, tiff + 4, little);
  if (ifd === undefined) return undefined;
  const at = tiff + ifd;
  const count = u16(b, at, little);
  if (count === undefined) return undefined;
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(b, entry, little) === 0x0112) {
      const o = u16(b, entry + 8, little);
      return o !== undefined && o >= 1 && o <= 8 ? o : undefined;
    }
  }
  return undefined;
}

function jpegSize(b: Uint8Array): PixelSize | null {
  let at = 2;
  let orientation: number | undefined;
  for (;;) {
    if (u8(b, at) !== 0xff) return null;
    while (u8(b, at + 1) === 0xff) at++; // fill bytes
    const marker = u8(b, at + 1);
    if (marker === undefined) return null;
    at += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) return null; // the image data begins before any size
    const len = u16(b, at, false);
    if (len === undefined || len < 2 || at + len > b.length) return null;
    const bodyStart = at + 2;
    const bodyEnd = at + len;
    if (marker === 0xe1) orientation ??= exifOrientation(b, bodyStart, bodyEnd);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 8) return null;
      const h = u16(b, bodyStart + 1, false);
      const w = u16(b, bodyStart + 3, false);
      return orientation !== undefined && orientation >= 5 ? size(h, w) : size(w, h);
    }
    at = bodyEnd;
  }
}

interface Box {
  type: string;
  body: number;
  end: number;
}

/** The boxes between `start` and `end`; a size of 0 or 1, under 8, or past the parent ends the walk with null. */
function boxes(b: Uint8Array, start: number, end: number, stopAfter?: string): Box[] | null {
  const out: Box[] = [];
  let at = start;
  while (at < end) {
    const len = u32(b, at, false);
    if (len === undefined || len < 8 || at + len > end) return null;
    out.push({ type: String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!), body: at + 8, end: at + len });
    if (out[out.length - 1]!.type === stopAfter) break;
    at += len;
  }
  return out;
}

function avifSize(b: Uint8Array): PixelSize | null {
  // Stop at meta: the media data after it is usually far longer than the head.
  const top = boxes(b, 0, b.length, 'meta');
  const meta = top?.find((x) => x.type === 'meta');
  if (!meta) return null;
  // meta, pitm and ipma are full boxes (a 4-byte version and flags first); iprp, ipco and irot are plain boxes.
  const kids = boxes(b, meta.body + 4, meta.end);
  const pitm = kids?.find((x) => x.type === 'pitm');
  const iprp = kids?.find((x) => x.type === 'iprp');
  if (!pitm || !iprp) return null;
  const pitmVersion = u8(b, pitm.body);
  if (pitmVersion === undefined || pitmVersion > 1) return null;
  const primary = pitmVersion === 0 ? u16(b, pitm.body + 4, false) : u32(b, pitm.body + 4, false);
  if (primary === undefined) return null;
  const inner = boxes(b, iprp.body, iprp.end);
  const ipco = inner?.find((x) => x.type === 'ipco');
  const ipma = inner?.find((x) => x.type === 'ipma');
  if (!ipco || !ipma) return null;
  const props = boxes(b, ipco.body, ipco.end);
  if (!props) return null;

  const version = u8(b, ipma.body);
  const flags = u32(b, ipma.body, false);
  const entries = u32(b, ipma.body + 4, false);
  if (version === undefined || flags === undefined || entries === undefined || version > 1) return null;
  const wide = (flags & 1) === 1;
  let at = ipma.body + 8;
  let found: number[] | null = null;
  for (let i = 0; i < entries; i++) {
    const id = version === 0 ? u16(b, at, false) : u32(b, at, false);
    at += version === 0 ? 2 : 4;
    const n = u8(b, at);
    at += 1;
    if (id === undefined || n === undefined) return null;
    const list: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = wide ? u16(b, at, false) : u8(b, at);
      at += wide ? 2 : 1;
      if (v === undefined || at > ipma.end) return null;
      list.push(wide ? v & 0x7fff : v & 0x7f);
    }
    if (id === primary) {
      found = list;
      break;
    }
  }
  if (!found) return null;

  let dims: { w: number; h: number } | null = null;
  let swap = false;
  for (const index of found) {
    const p = index >= 1 ? props[index - 1] : undefined;
    if (!p) continue;
    if (p.type === 'ispe' && !dims) {
      const w = u32(b, p.body + 4, false);
      const h = u32(b, p.body + 8, false);
      if (w === undefined || h === undefined) return null;
      dims = { w, h };
    } else if (p.type === 'irot') {
      const angle = u8(b, p.body);
      if (angle === undefined) return null;
      swap = (angle & 3) === 1 || (angle & 3) === 3;
    }
  }
  if (!dims) return null;
  return swap ? size(dims.h, dims.w) : size(dims.w, dims.h);
}

/** The pixel size read from the head of a file of the given MIME; null when it cannot be read safely. */
export function imageSize(head: Uint8Array, mime: string): PixelSize | null {
  try {
    switch (mime) {
      case 'image/png': return pngSize(head);
      case 'image/gif': return gifSize(head);
      case 'image/webp': return webpSize(head);
      case 'image/jpeg': return jpegSize(head);
      case 'image/avif': return sniffImage(head) === 'image/avif' ? avifSize(head) : null;
      default: return null;
    }
  } catch {
    return null;
  }
}
