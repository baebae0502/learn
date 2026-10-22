import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { READ_TITLE, writeDemoMedia } from './demo-media';

const pdfsIn = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('the demo material when Chromium cannot print (re-review Important 1)', () => {
  it('falls back to distinct fixture copies under the demo names, says so once, and stops trying to print', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-media-'));
    try {
      const notes: string[] = [];
      const printed = Buffer.from('%PDF-1.7\n% printed\n');
      const printPdf = vi.fn().mockResolvedValueOnce(printed).mockRejectedValue(new Error('printing took over 20 s'));
      const media = await writeDemoMedia(dir, printPdf, (text) => notes.push(text));
      const pdfs = pdfsIn(dir);
      expect(pdfs.length).toBe(7);
      expect(printPdf).toHaveBeenCalledTimes(2); // the first printed, the second failed, the rest not tried
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/printing the demo PDFs failed .*20 s.*fixture/);
      // Every file is a PDF, and no two are the same bytes (the import would take them for duplicates).
      for (const f of pdfs) expect(fs.readFileSync(path.join(dir, f)).subarray(0, 5).toString()).toBe('%PDF-');
      expect(new Set(pdfs.map((f) => hash(path.join(dir, f)))).size).toBe(7);
      expect(path.basename(media.read)).toBe(`${READ_TITLE}.pdf`);
      expect(fs.existsSync(media.read)).toBe(true);
      expect(fs.existsSync(path.join(dir, '.pages'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
