// M7c body search, the background half: the scheduler reads each PDF's text once the window is idle, resumes after a kill,
// stops for the trash, and tells the screen how far it is. (The search itself has its own spec.)
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, hardKill, importPaths, launch, pageTextCount, textExtraction, textHeld, textHold, textIdle, textJobs, trashItems } from './helpers';

const pdf = (name: string) => path.join(FIXTURES, name);
const detailOf = async (page: import('@playwright/test').Page, itemId: string) => {
  const r = await page.evaluate((id) => window.learn.library.detail({ itemId: id }), itemId);
  if (!r.ok) throw new Error(`library.detail failed: ${r.code}`);
  return r.data;
};

test('E2E starts paused; resumed, korean.pdf is indexed and its detail says done', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [korean, video, image] = await importPaths(page, [pdf('korean.pdf'), pdf('sample-h264-aac.mp4'), pdf('transparent.png')]);
    // The positive control comes first: the job is there and waits, only the PDF has one.
    const jobs = await textJobs(app);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: 'queued', attempts: 0 });
    expect((await detailOf(page, korean!.id)).text).toEqual({ state: 'pending' });
    await textExtraction(app, 'now');
    await textIdle(app);
    expect(await pageTextCount(app, { itemId: korean!.id })).toBe(3);
    expect((await detailOf(page, korean!.id)).text).toEqual({ state: 'done', pages: 3, truncated: false });
    expect((await detailOf(page, video!.id)).text).toBeNull();
    expect((await detailOf(page, image!.id)).text).toBeNull();
  } finally {
    await app.close();
  }
});

test('locked.pdf fails as locked, no-text.pdf is empty', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [locked, empty] = await importPaths(page, [pdf('locked.pdf'), pdf('no-text.pdf')]);
    await textExtraction(app, 'now');
    await textIdle(app);
    expect((await detailOf(page, locked!.id)).text).toEqual({ state: 'failed', reason: 'locked' });
    expect((await detailOf(page, empty!.id)).text).toEqual({ state: 'empty', pages: 2 });
  } finally {
    await app.close();
  }
});

test('a SIGKILL mid-extraction resumes on relaunch with exact page counts', async ({}, testInfo) => {
  const library = testInfo.outputPath('library');
  const userData = testInfo.outputPath('userdata');
  const first = await launch(library, userData);
  let sha256: string;
  try {
    const [paper] = await importPaths(first.page, [pdf('paper-100.pdf')]);
    sha256 = (await detailOf(first.page, paper!.id)).file.sha256;
    await textHold(first.app, 40);
    await textExtraction(first.app, 'now');
    await expect.poll(() => textHeld(first.app), { message: 'the job wrote 40 pages and is held' }).toBe(true);
    expect(await pageTextCount(first.app, { sha256 })).toBe(40);
  } catch (e) {
    await first.app.close().catch(() => {});
    throw e;
  }
  await hardKill(first.app);

  const second = await launch(library, userData);
  try {
    // The startup check marks the job interrupted; the first wake queues it again and it goes on from page 40.
    await textExtraction(second.app, 'now');
    await textIdle(second.app);
    expect(await pageTextCount(second.app, { sha256 })).toBe(100);
    const job = (await textJobs(second.app)).find((j) => j.sha256 === sha256);
    expect(job).toMatchObject({ state: 'done', attempts: 2, nextPage: 100 });
  } finally {
    await second.app.close();
  }
});

test('trash stops the running job and restore resumes it; purge removes the page text', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [paper] = await importPaths(page, [pdf('paper-100.pdf')]);
    const sha256 = (await detailOf(page, paper!.id)).file.sha256;
    await textHold(app, 40);
    await textExtraction(app, 'now');
    await expect.poll(() => textHeld(app)).toBe(true);
    expect(await trashItems(page, [paper!.id])).toBe(1);
    await expect.poll(async () => (await textJobs(app)).find((j) => j.sha256 === sha256)?.state, { message: 'the stopped job is back in the queue' }).toBe('queued');
    expect((await detailOf(page, paper!.id)).text).toEqual({ state: 'pending' });
    await textHold(app, null); // lets go and forgets: left as it was, the restored job would be held again at page 60
    expect(await page.evaluate((id) => window.learn.library.restore({ itemIds: [id] }), paper!.id)).toMatchObject({ ok: true, data: 1 });
    await textIdle(app);
    expect((await detailOf(page, paper!.id)).text).toEqual({ state: 'done', pages: 100, truncated: false });
    expect(await pageTextCount(app, { sha256 })).toBe(100);
    expect(await trashItems(page, [paper!.id])).toBe(1);
    expect(await page.evaluate((id) => window.learn.library.purge({ itemIds: [id], collectionIds: [] }), paper!.id)).toMatchObject({ ok: true });
    expect(await pageTextCount(app, { sha256 })).toBe(0);
  } finally {
    await app.close();
  }
});

test('progress notices: done never passes total, and the last one has them equal', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [pdf('korean.pdf'), pdf('sample.pdf'), pdf('search-30.pdf')]);
    await page.evaluate(() => {
      const seen: Array<{ done: number; total: number }> = [];
      (window as unknown as { __searchProgress: typeof seen }).__searchProgress = seen;
      window.learn.on('search:progress', (p) => void seen.push(p));
    });
    await textExtraction(app, 'now');
    await textIdle(app);
    // The last notice is sent when the queue empties, which is when textIdle resolves; it may still be on its way to the page.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __searchProgress: Array<{ done: number; total: number }> }).__searchProgress.at(-1)))
      .toEqual({ done: 3, total: 3 });
    const seen = await page.evaluate(() => (window as unknown as { __searchProgress: Array<{ done: number; total: number }> }).__searchProgress);
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.done).toBeLessThanOrEqual(p.total);
      expect(p.total).toBe(3);
    }
  } finally {
    await app.close();
  }
});
