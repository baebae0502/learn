import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { matchKorean } from '../../apps/desktop/src/renderer/src/palette/hangul';
import { itemMetadataSchema } from '../../packages/domain/src/metadata';
import { DEMO_METADATA, DEMO_ORGANIZE, EXTRA_TITLES, PALETTE_TITLE, READ_TITLE, VIDEOS, writeDemoMedia } from './demo-media';

const pdfsIn = (dir: string) => fs.readdirSync(dir).filter((f) => f.endsWith('.pdf'));
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('the demo material when Chromium cannot print (re-review Important 1)', () => {
  it('falls back to distinct fixture copies under the demo names, says so once, and stops trying to print', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-media-'));
    // Stand-ins for fixtures/generated, which `pnpm test` runs without (CI generates it later).
    const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-fixtures-'));
    fs.writeFileSync(path.join(fixtures, 'sample.pdf'), '%PDF-1.7\n% three pages\n%%EOF\n');
    for (const [from] of VIDEOS) fs.writeFileSync(path.join(fixtures, from), 'video');
    try {
      const notes: string[] = [];
      const printed = Buffer.from('%PDF-1.7\n% printed\n');
      const printPdf = vi.fn().mockResolvedValueOnce(printed).mockRejectedValue(new Error('printing took over 20 s'));
      const media = await writeDemoMedia(dir, printPdf, (text) => notes.push(text), fixtures);
      const pdfs = pdfsIn(dir);
      expect(pdfs.length).toBe(9);
      expect(printPdf).toHaveBeenCalledTimes(2); // the first printed, the second failed, the rest not tried
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/printing the demo PDFs failed .*20 s.*fixture/);
      // Every file is a PDF, and no two are the same bytes (the import would take them for duplicates).
      for (const f of pdfs) expect(fs.readFileSync(path.join(dir, f)).subarray(0, 5).toString()).toBe('%PDF-');
      expect(new Set(pdfs.map((f) => hash(path.join(dir, f)))).size).toBe(9);
      expect(path.basename(media.read)).toBe(`${READ_TITLE}.pdf`);
      expect(fs.existsSync(media.read)).toBe(true);
      expect(fs.existsSync(path.join(dir, '.pages'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(fixtures, { recursive: true, force: true });
    }
  });
});

describe('the demo table metadata (M4)', () => {
  it('gives every demo title creators and a date the app accepts; 초성 ㅅㅍ finds the opened PDF only, "bayes" the palette one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-media-'));
    const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-fixtures-'));
    fs.writeFileSync(path.join(fixtures, 'sample.pdf'), '%PDF-1.7\n% three pages\n%%EOF\n');
    for (const [from] of VIDEOS) fs.writeFileSync(path.join(fixtures, from), 'video');
    try {
      const media = await writeDemoMedia(dir, () => Promise.reject(new Error('no printing in a unit test')), () => {}, fixtures);
      const titles = [media.read, ...media.drop, ...media.extra].map((f) => path.basename(f, path.extname(f))).sort();
      expect(Object.keys(DEMO_METADATA).sort()).toEqual(titles);
      for (const meta of Object.values(DEMO_METADATA)) expect(itemMetadataSchema.parse(meta)).toEqual(meta);
      // The quick search's short fields: title, creators, publisher; the original file name is the title + extension.
      const shortFields = (title: string) => [title, ...DEMO_METADATA[title]!.creators.map((c) => c.name), DEMO_METADATA[title]!.publisher ?? ''];
      expect(titles.filter((title) => shortFields(title).some((field) => matchKorean('ㅅㅍ', field) !== null))).toEqual([READ_TITLE]);
      expect(titles.filter((title) => shortFields(title).some((field) => field.toLowerCase().includes('bayes')))).toEqual([PALETTE_TITLE]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(fixtures, { recursive: true, force: true });
    }
  });
});

describe('the demo material of the organise chapters (M5)', () => {
  it('keeps two notes out of the first import, and names the collections and tags the chapters make', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-media-'));
    const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-fixtures-'));
    fs.writeFileSync(path.join(fixtures, 'sample.pdf'), '%PDF-1.7\n% three pages\n%%EOF\n');
    for (const [from] of VIDEOS) fs.writeFileSync(path.join(fixtures, from), 'video');
    try {
      const media = await writeDemoMedia(dir, () => Promise.reject(new Error('no printing in a unit test')), () => {}, fixtures);
      // The first import is the same nine files as before; the two extra notes are separate files with the titles the chapters expect.
      expect([media.read, ...media.drop]).toHaveLength(9);
      expect(media.extra.map((f) => path.basename(f, '.pdf'))).toEqual([...EXTRA_TITLES]);
      for (const f of media.extra) {
        expect(fs.existsSync(f)).toBe(true);
        expect(media.drop).not.toContain(f);
      }
      const hashes = [media.read, ...media.drop, ...media.extra].filter((f) => f.endsWith('.pdf')).map(hash);
      expect(new Set(hashes).size).toBe(hashes.length); // no two are the same bytes: the import never takes one for a duplicate
      // The tags are put on titles the first import has (a title that is not there would be a silent no-op on camera).
      const firstImport = new Set([media.read, ...media.drop].map((f) => path.basename(f, path.extname(f))));
      for (const tag of DEMO_ORGANIZE.tags) for (const title of tag.titles) expect(firstImport.has(title), `${tag.name}: ${title}`).toBe(true);
      const names = [DEMO_ORGANIZE.parent, DEMO_ORGANIZE.child];
      expect(new Set(names).size).toBe(2);
      expect(new Set([...DEMO_ORGANIZE.tags.map((t) => t.name), DEMO_ORGANIZE.typedTag]).size).toBe(DEMO_ORGANIZE.tags.length + 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(fixtures, { recursive: true, force: true });
    }
  });
});
