import fs from 'node:fs/promises';
import path from 'node:path';
import type { ItemType } from '@learn/domain';

export interface SniffResult {
  type: ItemType;
  mime: string;
}

const ISO_BMFF_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime' };

/** Decide the type from magic bytes; the extension only refines the video MIME. */
export async function sniffFile(filePath: string): Promise<SniffResult | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    const head = buf.subarray(0, bytesRead);
    const ext = path.extname(filePath).toLowerCase();
    if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'pdf', mime: 'application/pdf' };
    if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
      return { type: 'video', mime: ISO_BMFF_MIME[ext] ?? 'video/mp4' };
    }
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
      return { type: 'video', mime: ext === '.mkv' ? 'video/x-matroska' : 'video/webm' };
    }
    return null;
  } finally {
    await fh.close();
  }
}
