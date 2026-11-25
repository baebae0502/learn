// Subtitles through the real app, before any screen draws them (M8a, spec 5, 11): attaching files in main through the
// page's window.learn.subtitles, the cue texts they leave, the change notice, remove and restore across a restart (the
// startup sweep of unlinked copies), and the cues going with the video's last link. No screen: the API and the test hooks.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AttachResult, Cue, RemovedTrack, SubtitleTrack } from '../../packages/domain/src/subtitles';
import { FIXTURES, cueTextCount, importPaths, launch, subtitleAssets, trashItems, stubOpenDialog } from './helpers';

const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;
const fixture = (name: string): string => path.join(FIXTURES, name);
const FIRST = '세포막은 물질의 출입을 조절합니다.';

test.beforeAll(() => {
  for (const name of ['lecture-60s.mp4', 'lecture-60s.ko.srt', 'lecture-60s.en.vtt', 'broken.srt', 'utf8-bom.srt', 'utf16le.srt', 'utf16be.srt', 'cp949.srt']) {
    if (!fs.existsSync(fixture(name))) throw new Error(`fixture missing: ${name} — run \`pnpm fixtures\``);
  }
});

/** One call of the page's subtitles API that must succeed. */
async function sub<T>(page: Page, call: (input: unknown) => Promise<{ ok: true; data: T } | { ok: false; code: string }>, input?: unknown): Promise<T> {
  const r = await page.evaluate(call, input);
  if (!r.ok) throw new Error(`call failed: ${r.code}`);
  return r.data;
}
const attach = (page: Page, itemId: string, paths: string[]) => sub<AttachResult>(page, (i) => window.learn.subtitles.attach(i as { itemId: string; paths: string[] }), { itemId, paths });
const list = (page: Page, itemId: string) => sub<{ tracks: SubtitleTrack[] }>(page, (i) => window.learn.subtitles.list(i as { itemId: string }), { itemId }).then((r) => r.tracks);
const cues = (page: Page, itemId: string, assetId: string) =>
  sub<{ cues: Cue[] }>(page, (i) => window.learn.subtitles.cues(i as { itemId: string; assetId: string }), { itemId, assetId }).then((r) => r.cues);
/** A video of lecture-60s.mp4 each: the same file imported again as a new item. */
async function videos(page: Page, count: number): Promise<string[]> {
  const items = await importPaths(page, Array.from({ length: count }, () => fixture('lecture-60s.mp4')), { allowDuplicate: true });
  expect(items.map((i) => i.type)).toEqual(Array.from({ length: count }, () => 'video'));
  return items.map((i) => i.id);
}

test('attach ko and en: the list has both in order, the cues read back, a broken file is a failure, and the page hears the change', async ({}, testInfo) => {
  const s = await launch(...dirs(testInfo));
  try {
    const [video] = (await videos(s.page, 1)) as [string];
    await s.page.evaluate(() => {
      const heard: string[] = [];
      (window as unknown as { __heard: string[] }).__heard = heard;
      window.learn.on('subtitles:changed', (p) => void heard.push(p.itemId));
    });
    const r = await attach(s.page, video, [fixture('lecture-60s.ko.srt'), fixture('lecture-60s.en.vtt'), fixture('broken.srt')]);
    expect(r.added.map((t) => [t.language, t.position])).toEqual([['ko', 0], ['en', 1]]);
    expect(r.failed).toEqual([{ name: 'broken.srt', reason: 'no-cues' }]);
    expect(r.already).toEqual([]);
    const tracks = await list(s.page, video);
    expect(tracks.map((t) => [t.language, t.originalName])).toEqual([['ko', 'lecture-60s.ko.srt'], ['en', 'lecture-60s.en.vtt']]);
    expect((await cues(s.page, video, tracks[0]!.assetId))[0]).toMatchObject({ startMs: 0, text: FIRST });
    await expect.poll(() => s.page.evaluate(() => (window as unknown as { __heard: string[] }).__heard)).toEqual([video]);
    expect(await cueTextCount(s.app, { itemId: video })).toBe(tracks[0]!.cueCount + tracks[1]!.cueCount);

    const again = await attach(s.page, video, [fixture('lecture-60s.ko.srt')]);
    expect(again).toEqual({ added: [], already: ['lecture-60s.ko.srt'], failed: [] });
  } finally {
    await s.app.close();
  }
});

test('the BOM, UTF-16 and CP949 files read to the same first sentence, each on a new video', async ({}, testInfo) => {
  const s = await launch(...dirs(testInfo));
  try {
    const names = ['utf8-bom.srt', 'utf16le.srt', 'utf16be.srt', 'cp949.srt'];
    const ids = await videos(s.page, names.length);
    for (const [i, name] of names.entries()) {
      const r = await attach(s.page, ids[i]!, [fixture(name)]);
      expect(r.failed, name).toEqual([]);
      expect(r.added, name).toHaveLength(1);
      expect((await cues(s.page, ids[i]!, r.added[0]!.assetId))[0]!.text, name).toBe(FIRST);
    }
  } finally {
    await s.app.close();
  }
});

test('pick attaches what the panel returns; a cancelled panel adds nothing', async ({}, testInfo) => {
  const s = await launch(...dirs(testInfo));
  try {
    const [video] = (await videos(s.page, 1)) as [string];
    await stubOpenDialog(s.app, [], { once: true });
    expect(await sub<AttachResult>(s.page, (i) => window.learn.subtitles.pick(i as { itemId: string }), { itemId: video })).toEqual({ added: [], already: [], failed: [] });
    await stubOpenDialog(s.app, [fixture('lecture-60s.en.vtt')]);
    const r = await sub<AttachResult>(s.page, (i) => window.learn.subtitles.pick(i as { itemId: string }), { itemId: video });
    expect(r.added.map((t) => t.language)).toEqual(['en']);
    expect(await list(s.page, video)).toHaveLength(1);
  } finally {
    await s.app.close();
  }
});

test('remove keeps the copy until the next start sweeps it; a restored track stays through the restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  let video = '';
  let ko!: SubtitleTrack;
  let en!: SubtitleTrack;
  let koSha = '';
  try {
    [video] = (await videos(s.page, 1)) as [string];
    const r = await attach(s.page, video, [fixture('lecture-60s.ko.srt'), fixture('lecture-60s.en.vtt')]);
    [ko, en] = r.added as [SubtitleTrack, SubtitleTrack];
    const removeTrack = (assetId: string) => sub<RemovedTrack>(s.page, (i) => window.learn.subtitles.remove(i as { itemId: string; assetId: string }), { itemId: video, assetId });
    const removedKo = await removeTrack(ko.assetId);
    const removedEn = await removeTrack(en.assetId);
    expect(removedKo).toEqual({ position: 0, language: 'ko' });
    // Nothing is deleted yet: the toast's 실행 취소 must be able to bring it back.
    const kept = await subtitleAssets(s.app);
    expect(kept.map((a) => [a.id, a.links, a.file]).sort()).toEqual([[ko.assetId, 0, true], [en.assetId, 0, true]].sort());
    koSha = kept.find((a) => a.id === ko.assetId)!.sha256;
    const back = await sub<SubtitleTrack>(s.page, (i) => window.learn.subtitles.restore(i as { itemId: string; assetId: string; position: number; language: string | null }), { itemId: video, assetId: en.assetId, ...removedEn });
    expect(back).toMatchObject({ assetId: en.assetId, language: 'en', position: removedEn.position });
  } finally {
    await s.app.close();
  }

  s = await launch(lib, ud);
  try {
    const assets = await subtitleAssets(s.app);
    expect(assets.map((a) => a.id)).toEqual([en.assetId]);
    expect(assets[0]).toMatchObject({ links: 1, file: true });
    expect(await list(s.page, video)).toMatchObject([{ assetId: en.assetId, language: 'en' }]);
    expect(await cueTextCount(s.app, { sha256: koSha })).toBe(0);
    // The file goes after the sweep's commit, off the start's critical path.
    await expect.poll(() => fs.existsSync(path.join(lib, 'assets', koSha.slice(0, 2), koSha))).toBe(false);
  } finally {
    await s.app.close();
  }
});

test('purging the video takes its cue texts and its subtitle copy', async ({}, testInfo) => {
  const s = await launch(...dirs(testInfo));
  try {
    const [video] = (await videos(s.page, 1)) as [string];
    const r = await attach(s.page, video, [fixture('lecture-60s.ko.srt')]);
    const [asset] = await subtitleAssets(s.app);
    expect(asset).toMatchObject({ id: r.added[0]!.assetId, links: 1, file: true });
    expect(await cueTextCount(s.app, { sha256: asset!.sha256 })).toBeGreaterThan(0);
    await trashItems(s.page, [video]);
    const purged = await s.page.evaluate((itemIds) => window.learn.library.purge({ itemIds, collectionIds: [] }), [video]);
    expect(purged.ok).toBe(true);
    expect(await cueTextCount(s.app, { sha256: asset!.sha256 })).toBe(0);
    await expect.poll(async () => (await subtitleAssets(s.app)).length).toBe(0);
  } finally {
    await s.app.close();
  }
});
