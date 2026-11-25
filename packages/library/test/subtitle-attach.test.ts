import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryRepository, SubtitlesRepository, migrate, openDatabase, type Db } from '@learn/db';
import { SUBTITLE_LIMITS, type AttachResult } from '@learn/domain';
import { Importer, attachSubtitleFiles, ensureLayout, libraryLayout, resolveAssetPath } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

const STATIC = path.resolve(import.meta.dirname, '../../../fixtures/static/subtitles');
const GENERATED = path.resolve(import.meta.dirname, '../../../fixtures/generated');
const sub = (name: string): string => path.join(STATIC, name);

const dbs: Db[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

async function setup() {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const subtitles = new SubtitlesRepository(db);
  const importer = new Importer({ layout, repo });
  const deps = { repo, subtitles, importer };
  const video = async (seed: string): Promise<string> => {
    const out = await importer.importOne(writeMp4(tempDir('src'), `${seed}.mp4`, seed), { mode: 'managed' });
    if (out.status !== 'imported') throw new Error('video not imported');
    return out.item.id;
  };
  return { layout, db, repo, subtitles, importer, deps, video };
}

describe('attachSubtitleFiles', () => {
  it('adds the ko srt and the en vtt in order with their languages, and reports the broken one', async () => {
    const { deps, video, layout, repo, subtitles } = await setup();
    const itemId = await video('a');
    const r = await attachSubtitleFiles(deps, itemId, [sub('lecture-60s.ko.srt'), sub('lecture-60s.en.vtt'), sub('broken.srt')]);
    expect(r.added.map((t) => [t.language, t.position, t.originalName])).toEqual([['ko', 0, 'lecture-60s.ko.srt'], ['en', 1, 'lecture-60s.en.vtt']]);
    expect(r.already).toEqual([]);
    expect(r.failed).toEqual([{ name: 'broken.srt', reason: 'no-cues' }]);
    expect(subtitles.list(itemId)).toHaveLength(2);
    // The managed copy sits at its hash-addressed path with the file's own hash.
    const asset = repo.getAsset(r.added[0]!.assetId)!;
    const copy = fs.readFileSync(resolveAssetPath(layout, asset));
    expect(createHash('sha256').update(copy).digest('hex')).toBe(asset.sha256);
    expect(asset).toMatchObject({ storageMode: 'managed', mime: 'application/x-subrip', availability: 'available' });
    expect(repo.getAsset(r.added[1]!.assetId)!.mime).toBe('text/vtt');
  });

  it('puts a file that is already attached under already, by name', async () => {
    const { deps, video, subtitles } = await setup();
    const itemId = await video('a');
    await attachSubtitleFiles(deps, itemId, [sub('lecture-60s.ko.srt')]);
    const again = await attachSubtitleFiles(deps, itemId, [sub('lecture-60s.ko.srt')]);
    expect(again).toEqual<AttachResult>({ added: [], already: ['lecture-60s.ko.srt'], failed: [] });
    expect(subtitles.list(itemId)).toHaveLength(1);
  });

  it('refuses a name that is not srt or vtt', async () => {
    const { deps, video } = await setup();
    const txt = path.join(tempDir('src'), 'notes.txt');
    fs.writeFileSync(txt, 'hello');
    const r = await attachSubtitleFiles(deps, await video('a'), [txt]);
    expect(r.failed).toEqual([{ name: 'notes.txt', reason: 'not-subtitle' }]);
  });

  it('says too-large from the size alone, without opening the file', async () => {
    const { deps, video } = await setup();
    const big = path.join(tempDir('src'), 'big.srt');
    fs.writeFileSync(big, Buffer.alloc(SUBTITLE_LIMITS.bytes + 1, 0x20));
    const read = vi.spyOn(fsp, 'readFile');
    const r = await attachSubtitleFiles(deps, await video('a'), [big]);
    expect(r.failed).toEqual([{ name: 'big.srt', reason: 'too-large' }]);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses the whole call for an item that is not a live video', async () => {
    const { deps } = await setup();
    const out = await deps.importer.importOne(writePdf(tempDir('src'), 'p.pdf', 'p'), { mode: 'managed' });
    if (out.status !== 'imported') throw new Error('not imported');
    await expect(attachSubtitleFiles(deps, out.item.id, [sub('lecture-60s.ko.srt')])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(attachSubtitleFiles(deps, '00000000-0000-4000-8000-000000000001', [sub('lecture-60s.ko.srt')])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a file read error is io', async () => {
    const { deps, video } = await setup();
    const r = await attachSubtitleFiles(deps, await video('a'), [path.join(tempDir('src'), 'gone.srt')]);
    expect(r.failed).toEqual([{ name: 'gone.srt', reason: 'io' }]);
  });

  it('gives two videos one asset for the same file', async () => {
    const { deps, video, db, subtitles } = await setup();
    const a = await video('a');
    const b = await video('b');
    const ra = await attachSubtitleFiles(deps, a, [sub('lecture-60s.ko.srt')]);
    const rb = await attachSubtitleFiles(deps, b, [sub('lecture-60s.ko.srt')]);
    expect(rb.added[0]!.assetId).toBe(ra.added[0]!.assetId);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM assets WHERE mime = 'application/x-subrip'`).get()).toEqual({ n: 1 });
    expect(subtitles.list(b)).toHaveLength(1);
  });

  it('puts a missing managed copy back when the asset is reused', async () => {
    const { deps, video, repo, layout } = await setup();
    const a = await video('a');
    const b = await video('b');
    const ra = await attachSubtitleFiles(deps, a, [sub('lecture-60s.ko.srt')]);
    const file = resolveAssetPath(layout, repo.getAsset(ra.added[0]!.assetId)!);
    fs.rmSync(file);
    await attachSubtitleFiles(deps, b, [sub('lecture-60s.ko.srt')]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('attaches a 20,000-cue file stays within three times the one-second ceiling (the full suite runs it 2x slower than alone)', async () => {
    const { deps, video, subtitles } = await setup();
    const source = fs.readFileSync(path.join(GENERATED, 'limit-20000.srt'), 'utf8');
    const dir = tempDir('src');
    const wall: number[] = [];
    const cpu: number[] = [];
    for (let run = 0; run < 3; run++) {
      // Another content each run (a file of a known sha keeps its one set of cues and would skip the work being measured).
      const file = path.join(dir, `limit-20000-${run}.srt`);
      fs.writeFileSync(file, source.replace(/문장 /g, `문장${run} `));
      const itemId = await video(`v${run}`);
      const t0 = performance.now();
      const c0 = process.cpuUsage();
      const r = await attachSubtitleFiles(deps, itemId, [file]);
      const used = process.cpuUsage(c0);
      wall.push(Math.round(performance.now() - t0));
      cpu.push(Math.round((used.user + used.system) / 1000));
      expect(r.added).toHaveLength(1);
      expect(subtitles.list(itemId)[0]!.cueCount).toBe(20_000);
    }
    // Alone it takes about 0.6 s (the cue index's trigger is most of it); beside 40 other test files it is 1.0-1.4 s. The
    // bound only has to catch a change that makes it grow by a factor, like the near-5 MiB parse bounds do.
    const ms = Math.min(...wall);
    console.log('[measure] attach-20000', ms, `(ms, fastest of three; wall ${wall.join(', ')}, cpu ${cpu.join(', ')})`);
    expect(ms).toBeLessThan(3000);
  });
});
