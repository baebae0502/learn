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
