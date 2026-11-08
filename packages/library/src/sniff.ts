import fs from 'node:fs/promises';
import path from 'node:path';
import type { ItemType } from '@learn/domain';

export interface SniffResult {
  type: ItemType;
  mime: string;
}

const ISO_BMFF_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime' };
/** ISO BMFF brands of the videos the player takes: MP4, QuickTime, iTunes video, Flash video, DASH (spec 10). */
const VIDEO_BRANDS: ReadonlySet<string> = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'qt  ', 'M4V ', 'M4VH', 'M4VP', 'f4v ', 'dash']);
/**
 * Brands of still images (HEIC, HEIF, AVIF) and of audio (m4a, audiobooks, protected music, Flash audio). As the major
 * brand they decide: an m4a also lists mp42 and isom and would otherwise pass for a video.
 */
const NOT_VIDEO_BRANDS: ReadonlySet<string> = new Set(['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'M4A ', 'M4B ', 'M4P ', 'F4A ', 'F4B ']);
/** How much of a file the sniff reads: a real ftyp box and its brands fit many times over. */
const HEAD_BYTES = 512;

/** A video by its ftyp box: a denied major brand says no; otherwise the major or a compatible brand must be a video brand. */
function ftypIsVideo(head: Buffer): boolean {
  const major = head.toString('latin1', 8, 12);
  if (NOT_VIDEO_BRANDS.has(major)) return false;
  if (VIDEO_BRANDS.has(major)) return true;
  // Compatible brands run from byte 16 to the end of the box (or of what was read); a size under 16 has none.
  const end = Math.min(head.readUInt32BE(0), head.length);
  for (let at = 16; at + 4 <= end; at += 4) if (VIDEO_BRANDS.has(head.toString('latin1', at, at + 4))) return true;
  return false;
}

/** Decide the type from magic bytes; the extension only refines the video MIME. */
export async function sniffFile(filePath: string): Promise<SniffResult | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const head = buf.subarray(0, bytesRead);
    const ext = path.extname(filePath).toLowerCase();
    if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'pdf', mime: 'application/pdf' };
    if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
      return ftypIsVideo(head) ? { type: 'video', mime: ISO_BMFF_MIME[ext] ?? 'video/mp4' } : null;
    }
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
      return { type: 'video', mime: ext === '.mkv' ? 'video/x-matroska' : 'video/webm' };
    }
    return null;
  } finally {
    await fh.close();
  }
}

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

/** Brands of HEIC and its relatives: a file that lists one of them is not taken as AVIF even if it also lists avif. */
const HEIC_BRANDS: ReadonlySet<string> = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs']);

function ascii(head: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > head.length) return false;
  for (let i = 0; i < text.length; i++) if (head[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function brandAt(head: Uint8Array, at: number): string {
  return String.fromCharCode(head[at]!, head[at + 1]!, head[at + 2]!, head[at + 3]!);
}

/** AVIF by its ftyp box; any HEIC-family brand, major or compatible, turns it away. */
function ftypIsAvif(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const size = ((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0;
  const end = Math.min(size, head.length);
  const brands = [brandAt(head, 8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(brandAt(head, at));
  if (brands.some((b) => HEIC_BRANDS.has(b))) return false;
  return brands.some((b) => b === 'avif' || b === 'avis');
}

/** The image format by the first bytes (the extension is not looked at); null for anything else. */
export function sniffImage(head: Uint8Array): ImageMime | null {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 'PNG\r\n') && head[6] === 0x1a && head[7] === 0x0a) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')) return 'image/gif';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP') && (ascii(head, 12, 'VP8 ') || ascii(head, 12, 'VP8L') || ascii(head, 12, 'VP8X'))) return 'image/webp';
  if (ascii(head, 4, 'ftyp') && ftypIsAvif(head)) return 'image/avif';
  return null;
}
