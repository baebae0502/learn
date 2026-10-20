import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

export function tempDir(prefix = 'lib'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `learn-${prefix}-`));
  created.push(d);
  return d;
}

export function cleanupTemp(): void {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** Minimal bytes that sniff as PDF; content differs per `text` so hashes differ. */
export function writePdf(dir: string, name: string, text: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${text}\n%%EOF\n`);
  return p;
}

/** Minimal bytes that sniff as an ISO-BMFF (MP4) file. */
export function writeMp4(dir: string, name: string, seed: string): string {
  const p = path.join(dir, name);
  const box = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
  fs.writeFileSync(p, Buffer.concat([box, Buffer.from(seed)]));
  return p;
}
