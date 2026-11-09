import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, TextRepository, migrate, openDatabase } from '@learn/db';
import { bodyTextPage, seedBodyText } from './seed-body-text';

describe('bodyTextPage', () => {
  it('has exactly the length asked for and is the same text for the same arguments', () => {
    const a = bodyTextPage(42, 0, 0, 4000);
    expect(a).toHaveLength(4000);
    expect(bodyTextPage(42, 0, 0, 4000)).toBe(a);
    expect(bodyTextPage(42, 0, 1, 4000)).not.toBe(a); // positive control: the arguments do change the text
    expect(bodyTextPage(42, 1, 0, 4000)).not.toBe(a);
    expect(bodyTextPage(43, 0, 0, 4000)).not.toBe(a);
  });

  it('one word in five is Korean, and the words zq and xylophone are nowhere', () => {
    let korean = 0;
    let words = 0;
    for (let doc = 0; doc < 5; doc++) {
      for (let page = 0; page < 5; page++) {
        const text = bodyTextPage(42, doc, page, 4000);
        expect(text).not.toContain('zq');
        expect(text).not.toContain('xylophone');
        for (const w of text.split(' ')) {
          words += 1;
          if (/\p{Script=Hangul}/u.test(w)) korean += 1;
        }
      }
    }
    expect(korean / words).toBeGreaterThan(0.15);
    expect(korean / words).toBeLessThan(0.25);
  });
});

describe('the words of the pages', () => {
  const tableWords = [
    'signal', 'transduction', 'protein', 'receptor', 'membrane', 'kinase', 'pathway', 'expression', 'cellular', 'molecular', 'analysis', 'method', 'result',
    'sample', 'structure', 'function', 'binding', 'activity', 'response', 'control', 'model', 'network', 'sequence', 'genome', 'enzyme', 'inhibitor',
    'phosphorylation', 'regulation', 'microscopy', 'fluorescence', 'imaging', 'tissue', 'neuron', 'synapse', 'channel', 'ligand', 'assay', 'culture',
    'antibody', 'dynamics',
  ];
  // The Korean words the search timings ask for (written as escapes: main keeps its Hangul in strings.ts).
  const asked = ['\uD615\uAD11', '\uC138\uD3EC', '\uD604\uBBF8\uACBD', '\uB2E8\uBC31\uC9C8', '\uC2E0\uD638'];

  it('every word of both tables occurs over a few hundred pages, among them each word the search timings ask for', () => {
    const seen = new Set<string>();
    for (let doc = 0; doc < 10; doc++) for (let page = 0; page < 30; page++) for (const w of bodyTextPage(7, doc, page, 4000).split(' ').slice(0, -1)) seen.add(w); // the last word of a page may be cut
    for (const w of tableWords) expect(seen, w).toContain(w);
    const korean = [...seen].filter((w) => /\p{Script=Hangul}/u.test(w));
    expect(korean).toHaveLength(20);
    for (const w of asked) expect(seen, w).toContain(w);
    expect(seen).toContain('transduction');
    expect(seen).toContain('signal');
    expect(seen.size).toBe(60); // positive control: nothing else is in the pages
  });
});

describe('seedBodyText', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('writes the items with finished jobs and their page texts, newest first, findable by the body query', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-seed-body-'));
    dirs.push(root);
    const db = openDatabase(':memory:');
    migrate(db, { dbFile: null });
    try {
      const repo = new LibraryRepository(db);
      const out = seedBodyText({ db, repo, layout: { root } }, { docs: 3, pages: 4, chars: 200, seed: 7 });
      expect(out.itemIds).toHaveLength(3);
      expect(out.sha256).toHaveLength(3);
      const texts = new TextRepository(db);
      expect(texts.pageCount(out.sha256[0]!)).toBe(4);
      expect(texts.stateOf(out.sha256[2]!)).toEqual({ state: 'done', pages: 4, truncated: false });
      expect(texts.jobs().map((j) => [j.state, j.nextPage])).toEqual([['done', 4], ['done', 4], ['done', 4]]);
      const titles = out.itemIds.map((id) => repo.getItem(id)!.title);
      expect(titles).toEqual(['본문 1', '본문 2', '본문 3']);
      expect(repo.getItem(out.itemIds[0]!)!.createdAt > repo.getItem(out.itemIds[2]!)!.createdAt).toBe(true);
      expect(db.prepare('SELECT text FROM page_texts WHERE sha256 = ? AND page_index = 2').pluck().get(out.sha256[1]!)).toBe(bodyTextPage(7, 1, 2, 200));
      // Nothing is left for the scheduler: the backfill finds a job for every file already.
      expect(texts.backfill('2026-11-09T00:00:00.000Z')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('can write jobs that stopped at a limit: a cut index of the pages written', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-seed-body-'));
    dirs.push(root);
    const db = openDatabase(':memory:');
    migrate(db, { dbFile: null });
    try {
      const out = seedBodyText({ db, repo: new LibraryRepository(db), layout: { root } }, { docs: 1, pages: 3, chars: 200, seed: 7, truncated: true });
      expect(new TextRepository(db).stateOf(out.sha256[0]!)).toEqual({ state: 'done', pages: 3, truncated: true });
    } finally {
      db.close();
    }
  });
});
