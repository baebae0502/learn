import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ImportQueueState, ImportReport } from '../../packages/domain/src/library';
import { FIXTURES, clickToCloseSheet, expectWindow, launch } from './helpers';

// Subtitle files put in with their videos (spec 5.2): paired by name in main, attached once the video's item is known.
interface Hooks {
  enqueueImport(input: { paths: string[] }): number;
  importQueueState(): ImportQueueState;
  importReports(): ImportReport[];
}
type G = { __learnTest: Hooks };
const enqueue = (app: ElectronApplication, paths: string[]) => app.evaluate((_e, paths) => (globalThis as unknown as G).__learnTest.enqueueImport({ paths }), paths);
const reports = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as G).__learnTest.importReports());
const fixture = (name: string): string => path.join(FIXTURES, name);

async function runEnds(app: ElectronApplication, count: number): Promise<ImportReport> {
  await expect.poll(async () => (await reports(app)).length, { message: `run ${count} reported` }).toBe(count);
  return (await reports(app))[count - 1]!;
}
const tracksOf = (page: Page, itemId: string) =>
  page.evaluate(async (itemId) => {
    const r = await window.learn.subtitles.list({ itemId });
    return r.ok ? r.data.tracks.map((t) => ({ language: t.language, name: t.originalName })) : null;
  }, itemId);
const itemIds = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.learn.library.list();
    return r.ok ? r.data.map((i) => ({ id: i.id, title: i.title })) : [];
  });

test('a video and the subtitle files picked with it come in together; a second put-in of the same files attaches nothing new', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const bundle = [fixture('lecture-60s.mp4'), fixture('lecture-60s.ko.srt'), fixture('lecture-60s.en.vtt')];
    expect(await enqueue(app, bundle)).toBe(1);
    const first = await runEnds(app, 1);
    expect(first).toMatchObject({ imported: 1, requested: 1, failed: [], subtitles: { attached: 2, failed: [] } });
    const items = await itemIds(page);
    expect(items).toHaveLength(1);
    const tracks = await tracksOf(page, items[0]!.id);
    expect(tracks?.map((t) => t.language).sort()).toEqual(['en', 'ko']);

    // The same files again: the video is a duplicate, asked on its sheet; skipping it leaves the tracks as they were.
    const sheet = await expectWindow(app, 'sheet', async () => {
      await enqueue(app, bundle);
    });
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-skip'));
    const second = await runEnds(app, 2);
    expect(second).toMatchObject({ imported: 0, requested: 1, subtitles: { attached: 0, failed: [] } });
    expect(await tracksOf(page, items[0]!.id)).toEqual(tracks);
  } finally {
    await app.close();
  }
});

test('a subtitle file with no video beside it is reported unpaired, and the run asks for no file', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect(await enqueue(app, [fixture('notes.ko.srt')])).toBe(0);
    const r = await runEnds(app, 1);
    expect(r).toMatchObject({ requested: 0, imported: 0, subtitles: { attached: 0, failed: [{ name: 'notes.ko.srt', reason: 'unpaired' }] } });
    expect(await itemIds(page)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the subtitles of a video that did not come in are reported as such', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'empty.mp4'), '');
    fs.copyFileSync(fixture('notes.ko.srt'), path.join(dir, 'empty.srt'));
    await enqueue(app, [path.join(dir, 'empty.mp4'), path.join(dir, 'empty.srt')]);
    const r = await runEnds(app, 1);
    expect(r.imported).toBe(0);
    expect(r.failed.map((f) => f.name)).toEqual(['empty.mp4']);
    expect(r.subtitles).toEqual({ attached: 0, failed: [{ name: 'empty.srt', reason: 'video-failed' }] });
    expect(await itemIds(page)).toEqual([]);
  } finally {
    await app.close();
  }
});
