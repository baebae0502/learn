// M7c body text: the utility-process worker reads a PDF with pdf.js and main takes its batches (spec 5.2–5.4).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, extractFile, launch } from './helpers';

const pdf = (name: string) => path.join(FIXTURES, name);

test("korean.pdf in the utility process: three pages, NFC, page 2's decomposed text stored composed", async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const r = await extractFile(app, { file: pdf('korean.pdf') });
    expect(r.outcome).toMatchObject({ kind: 'done', pages: 3, truncated: false });
    expect(r.opened).toBe(3);
    const texts = r.batches.flatMap((b) => b.texts);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain('주의 메커니즘은 중요합니다.');
    expect(texts[1]).toBe(texts[0]);
    expect(texts[1]).toBe(texts[1]!.normalize('NFC'));
    expect(texts[2]).toContain('왼쪽 단 주의 메커니즘은 중요합니다.');
  } finally {
    await app.close();
  }
});

// korean.pdf embeds its font and carries a ToUnicode map, so pdf.js never reads a cMap for it. This file names a font that is
// not embedded (UniKS-UCS2-H, Adobe-Korea1, no ToUnicode): its text comes out only if the worker really loads the cMap files.
test('korean-cmap.pdf: text of a font that is not embedded needs the cMap files from the app folder', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const r = await extractFile(app, { file: pdf('korean-cmap.pdf') });
    expect(r.outcome).toMatchObject({ kind: 'done', pages: 1 });
    expect(r.batches.flatMap((b) => b.texts)).toEqual(['한글검색시험']);
  } finally {
    await app.close();
  }
});

test('paper-100: a word broken at a line end is one word; batches of at most 20 pages from startPage', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const all = await extractFile(app, { file: pdf('paper-100.pdf') });
    expect(all.outcome).toMatchObject({ kind: 'done', pages: 100 });
    expect(all.batches.map((b) => b.from)).toEqual([0, 20, 40, 60, 80]);
    expect(all.batches.every((b) => b.texts.length <= 20)).toBe(true);
    expect(all.batches[0]!.texts[1]).toContain('sequence transduction models');
    const from60 = await extractFile(app, { file: pdf('paper-100.pdf'), startPage: 60 });
    expect(from60.batches[0]!.from).toBe(60);
    expect(from60.outcome).toMatchObject({ kind: 'done', pages: 100 });
  } finally {
    await app.close();
  }
});

test('locked.pdf is locked; a text file named .pdf is damaged; a file over maxFileBytes is too-large', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect((await extractFile(app, { file: pdf('locked.pdf') })).outcome).toEqual({ kind: 'failed', reason: 'locked' });
    const fake = testInfo.outputPath('not-a-pdf.pdf');
    fs.writeFileSync(fake, 'this is only text\n');
    expect((await extractFile(app, { file: fake })).outcome).toEqual({ kind: 'failed', reason: 'damaged' });
    expect((await extractFile(app, { file: pdf('korean.pdf'), limits: { maxFileBytes: 10 } })).outcome).toEqual({ kind: 'failed', reason: 'too-large' });
    // The worker still reads a good file after three failures (a new one is started each time).
    expect((await extractFile(app, { file: pdf('korean.pdf') })).outcome.kind).toBe('done');
  } finally {
    await app.close();
  }
});

test('limits stop early', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const pages = await extractFile(app, { file: pdf('paper-100.pdf'), limits: { maxPages: 3 } });
    expect(pages.outcome).toEqual({ kind: 'done', pages: 3, truncated: true });
    expect(pages.batches.flatMap((b) => b.texts)).toHaveLength(3);
    const chars = await extractFile(app, { file: pdf('paper-100.pdf'), limits: { maxDocChars: 100 } });
    expect(chars.outcome).toMatchObject({ kind: 'done', truncated: true });
    expect(chars.batches.flatMap((b) => b.texts).join('').length).toBeLessThanOrEqual(100);
  } finally {
    await app.close();
  }
});

test('the worker is a utility process named Learn 본문 색인', async ({}, testInfo) => {
  const { app } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect((await extractFile(app, { file: pdf('korean.pdf') })).outcome.kind).toBe('done');
    // Read right after the job, inside the thirty idle seconds, while the kept worker is alive.
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, serviceName: m.serviceName, name: m.name })));
    expect(metrics).toContainEqual(expect.objectContaining({ type: 'Utility', name: 'Learn 본문 색인' }));
  } finally {
    await app.close();
  }
});
