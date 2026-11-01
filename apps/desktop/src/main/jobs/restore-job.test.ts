import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_RESTORE_PROGRESS, LearnError, RESTORE_COPY, type JobProgress, type RestoreDoneSheet, type SheetResult } from '@learn/domain';
import { CollectionsRepository, LibraryRepository, TagsRepository, migrate, openDatabase, type Db, type LibraryCounts } from '@learn/db';
import { Importer, createBackup, ensureLayout, libraryLayout, type LibraryLayout, type RestoreResult } from '@learn/library';
import { mainStrings } from '../strings';
import { createJobLane } from './lane';
import { quitQuestion } from './quit-guard';
import { RESTORE_ISSUE_NAMES, createRestoreJob, restoreSheet, type RestoreJobDeps } from './restore-job';

const made: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) if (db.open) db.close();
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const temp = (name: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `learn-rj-${name}-`));
  made.push(d);
  return d;
};
const pdf = (dir: string, name: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${name}\n%%EOF\n`);
  return p;
};

interface Backed {
  layout: LibraryLayout;
  repo: LibraryRepository;
  backup: string;
  /** Item titles by asset id, and the trashed item's title. */
  titleOf: Record<string, string>;
  trashedTitle: string;
}
/** A library of three copies (one in the trash) and a linked file, a collection and a tag — and a backup of it. */
async function backedUp(): Promise<Backed> {
  const layout = libraryLayout(path.join(temp('lib'), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const importer = new Importer({ layout, repo });
  const src = temp('src');
  for (const n of ['a', 'b', 'c']) await importer.importOne(pdf(src, `${n}.pdf`), { mode: 'managed' });
  await importer.importOne(pdf(src, 'd.pdf'), { mode: 'linked' });
  const items = repo.listItems();
  const byTitle = (t: string) => items.find((i) => i.title === t)!;
  const cols = new CollectionsRepository(db);
  cols.addItems(cols.create({ name: '분자생물학' }).id, [byTitle('a').id]);
  const tags = new TagsRepository(db);
  tags.assign(tags.create('시험 범위').id, [byTitle('b').id]);
  repo.trash([byTitle('c').id]);
  const backup = path.join(temp('bk'), 'Learn 백업 2026-10-30 2141');
  await createBackup({ layout, db, repo, destDir: backup, includeAssets: true });
  return { layout, repo, backup, titleOf: Object.fromEntries(items.map((i) => [i.assetId, i.title])), trashedTitle: 'c' };
}
const manifestOf = (backup: string) =>
  JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8')) as { createdAt: string; assets: Array<{ assetId: string; included: boolean; relativePath: string | null; storageMode: string }> };

type Win = { id: number };
const WHEN = new Date(2026, 9, 31, 21, 41, 5);
function harness(lib: Pick<Backed, 'layout' | 'backup'>, over: Partial<RestoreJobDeps<Win>> = {}) {
  const lane = createJobLane();
  const parent = temp('restores');
  const notices: JobProgress[] = [];
  const sheets: Array<{ owner: Win | null; payload: RestoreDoneSheet }> = [];
  const picks: Array<{ which: 'backup' | 'parent'; owner: Win | null; defaultPath: string }> = [];
  const switched: string[] = [];
  const failures: Array<{ owner: Win | null; error: { code: string; message: string } }> = [];
  let answer: SheetResult | null = { kind: 'restoreDone', switch: false };
  const job = createRestoreJob<Win>({
    lane,
    libraryRoot: () => lib.layout.root,
    pickBackup: async (owner, opts) => {
      picks.push({ which: 'backup', owner, ...opts });
      return lib.backup;
    },
    pickParent: async (owner, opts) => {
      picks.push({ which: 'parent', owner, ...opts });
      return parent;
    },
    backupDir: () => path.dirname(lib.backup),
    documentsDir: () => '/home/u/Documents',
    homeDir: () => '/home/u',
    progress: (p) => notices.push(p),
    showResult: async (owner, payload) => {
      sheets.push({ owner, payload });
      return answer;
    },
    switchTo: (root) => void switched.push(root),
    switchFailed: (owner, error) => void failures.push({ owner, error }),
    now: () => WHEN,
    progressMs: 0,
    ...over,
  });
  const ended = (outcome: JobProgress['outcome']) => vi.waitFor(() => expect(notices.at(-1)?.outcome).toBe(outcome));
  const answerWith = (next: SheetResult | null) => {
    answer = next;
  };
  return { job, lane, parent, notices, sheets, picks, switched, failures, ended, answerWith };
}
/** A hook that holds the first copy written until `release` (the copies after it pass). */
function holdFirst() {
  let release: () => void = () => {};
  let held = false;
  const hooks = {
    afterCopy: (): Promise<void> | undefined => {
      if (held) return undefined;
      held = true;
      return new Promise<void>((resolve) => (release = resolve));
    },
  };
  return { hooks, held: () => held, release: () => release() };
}
const NAME = 'Learn 복원 2026-10-31 2141';

describe('the restore on the work line (spec 9.1, P-20)', () => {
  it('asks for the backup where backups were made and checks it, then where (beside the library), names the folder by the minute, ends with the result sheet', async () => {
    const lib = await backedUp();
    const h = harness(lib);
    const owner = { id: 7 };
    expect(await h.job.start(owner)).toEqual({ started: true });
    await h.ended('done');
    const target = path.join(h.parent, NAME);
    expect(h.picks).toEqual([
      { which: 'backup', owner, defaultPath: path.dirname(lib.backup) },
      { which: 'parent', owner, defaultPath: path.dirname(lib.layout.root) },
    ]);
    expect(fs.readdirSync(h.parent)).toEqual([NAME]);
    expect(fs.readdirSync(target).sort()).toEqual(['assets', 'derived', 'exports', 'library.sqlite', 'staging']);
    // Running from the start (nothing ran before it), named, counted; then idle, done.
    expect(h.notices[0]).toEqual({ ...IDLE_RESTORE_PROGRESS, state: 'running' });
    expect(h.notices.some((n) => n.state === 'waiting-job')).toBe(false);
    expect(h.notices.filter((n) => n.state === 'running').at(-1)).toMatchObject({ name: NAME, done: 3, total: 3 });
    expect(h.notices.at(-1)).toEqual({ ...IDLE_RESTORE_PROGRESS, outcome: 'done' });
    await vi.waitFor(() => expect(h.sheets).toHaveLength(1));
    expect(h.sheets[0]).toEqual({
      owner,
      payload: {
        kind: 'restoreDone', backupAt: manifestOf(lib.backup).createdAt, items: 3, trashed: 1, collections: 1, tags: 1, files: 3, verified: 3,
        missing: null, damaged: null, records: null, countsMatch: true, location: target, homeDir: '/home/u',
      },
    });
    expect(h.switched).toEqual([]); // 나중에
  });

  it('이 라이브러리로 전환하고 다시 시작 switches to the folder it made; 나중에 and a sheet closed unanswered do not; a switch that fails is said over the window, its code alone in the log', async () => {
    const lib = await backedUp();
    const owner = { id: 3 };
    const h = harness(lib);
    h.answerWith({ kind: 'restoreDone', switch: true });
    await h.job.start(owner);
    await vi.waitFor(() => expect(h.switched).toEqual([path.join(h.parent, NAME)]));

    h.answerWith(null);
    await h.job.start(owner);
    await vi.waitFor(() => expect(h.sheets).toHaveLength(2));
    expect(h.sheets[1]!.payload.location).toBe(path.join(h.parent, `${NAME} 2`)); // the same minute: a name of its own
    expect(h.switched).toHaveLength(1);

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = harness(lib, {
      switchTo: () => {
        throw new LearnError('PREFS_UNAVAILABLE', mainStrings.prefs.readOnly);
      },
    });
    failing.answerWith({ kind: 'restoreDone', switch: true });
    await failing.job.start(owner);
    await vi.waitFor(() => expect(failing.failures).toEqual([{ owner, error: { code: 'PREFS_UNAVAILABLE', message: mainStrings.prefs.readOnly } }]));
    expect(logged.mock.calls).toEqual([['[restore] switch failed: PREFS_UNAVAILABLE']]);
  });

  it('a cancelled panel starts nothing; a folder that is not a backup, or one from a newer app, is refused before the second panel', async () => {
    const lib = await backedUp();
    const none = harness(lib, { pickBackup: async () => null });
    expect(await none.job.start(null)).toEqual({ started: false });
    const notBackup = temp('not-a-backup');
    const wrong = harness(lib, { pickBackup: async () => notBackup });
    await expect(wrong.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: RESTORE_COPY.unknownFormat });
    expect(wrong.picks).toEqual([]);
    const newer = path.join(temp('bk'), 'newer');
    fs.cpSync(lib.backup, newer, { recursive: true });
    fs.writeFileSync(path.join(newer, 'manifest.json'), JSON.stringify({ ...manifestOf(lib.backup), schemaVersion: 99 }));
    const future = harness(lib, { pickBackup: async () => newer });
    await expect(future.job.start(null)).rejects.toMatchObject({ message: RESTORE_COPY.newerVersion });
    const later = harness(lib, { pickParent: async () => null });
    expect(await later.job.start(null)).toEqual({ started: false });
    for (const h of [none, wrong, future, later]) expect([h.notices, fs.readdirSync(h.parent)]).toEqual([[], []]);
  });

  it('refuses a place inside the library, inside the backup, or one that is gone, before anything runs; a second restore while one is on the line is refused unasked', async () => {
    const lib = await backedUp();
    const refusals: Array<[string, string]> = [
      [lib.layout.root, mainStrings.restore.inLibrary],
      [path.join(lib.layout.root, 'assets'), mainStrings.restore.inLibrary],
      [lib.backup, mainStrings.restore.inBackup],
      [path.join(temp('x'), 'gone'), mainStrings.libraryFolder.missing],
    ];
    for (const [chosen, message] of refusals) {
      const h = harness(lib, { pickParent: async () => chosen });
      await expect(h.job.start(null), chosen).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message });
      expect(h.notices).toEqual([]);
    }
    const h = harness(lib);
    const first = holdFirst();
    h.job.setHooks(first.hooks);
    expect(await h.job.start(null)).toEqual({ started: true });
    await vi.waitFor(() => expect(first.held()).toBe(true));
    expect(await h.job.start(null)).toEqual({ started: false });
    expect(h.picks).toHaveLength(2); // the first restore's two panels only
    first.release();
    await h.ended('done');
  });

  it('waits behind a running import as waiting-job and runs after it; 취소 while it waits ends it at once, and it never runs', async () => {
    const lib = await backedUp();
    const h = harness(lib);
    let letGo: () => void = () => {};
    void h.lane.run('import', () => new Promise<void>((resolve) => (letGo = resolve)));
    expect(await h.job.start(null)).toEqual({ started: true });
    expect(h.notices).toEqual([{ ...IDLE_RESTORE_PROGRESS, state: 'waiting-job' }]);
    h.job.cancel();
    expect(h.notices.at(-1)).toEqual({ ...IDLE_RESTORE_PROGRESS, outcome: 'cancelled' });
    letGo();
    await h.lane.idle();
    expect(fs.readdirSync(h.parent)).toEqual([]);
    expect(h.notices.filter((n) => n.outcome !== undefined)).toHaveLength(1);
    expect(h.sheets).toEqual([]);

    const after = harness(lib);
    let go: () => void = () => {};
    void after.lane.run('import', () => new Promise<void>((resolve) => (go = resolve)));
    await after.job.start(null);
    go();
    await after.ended('done');
    expect(after.notices.slice(0, 2).map((n) => n.state)).toEqual(['waiting-job', 'running']);
  });

  it('취소 while copying, or the line stopped for a quit, leaves no folder and ends cancelled; no sheet', async () => {
    const lib = await backedUp();
    const h = harness(lib);
    const first = holdFirst();
    h.job.setHooks(first.hooks);
    await h.job.start(null);
    await vi.waitFor(() => expect(first.held()).toBe(true));
    h.job.cancel();
    first.release();
    await h.ended('cancelled');
    expect(fs.readdirSync(h.parent)).toEqual([]);

    const quit = harness(lib);
    const held = holdFirst();
    quit.job.setHooks(held.hooks);
    await quit.job.start(null);
    await vi.waitFor(() => expect(held.held()).toBe(true));
    quit.lane.cancelAll();
    held.release();
    await quit.ended('cancelled');
    expect(fs.readdirSync(quit.parent)).toEqual([]);
    expect([h.sheets, quit.sheets]).toEqual([[], []]);
    // What the quit question says meanwhile (spec 3.6; Task 3 asks it).
    expect(quitQuestion('restore', 0)).toMatchObject({ message: '복원하는 중입니다', detail: '끝내면 만들던 라이브러리는 남지 않습니다.' });
  });

  it('a backup that lost a file and changed another still restores: the sheet names both, with their items; the damaged copy waits in staging', async () => {
    const lib = await backedUp();
    const copies = manifestOf(lib.backup).assets.filter((a) => a.included);
    const [lost, changed] = copies;
    fs.rmSync(path.join(lib.backup, ...lost!.relativePath!.split('/')));
    fs.appendFileSync(path.join(lib.backup, ...changed!.relativePath!.split('/')), 'changed on the way');
    const h = harness(lib);
    await h.job.start(null);
    await vi.waitFor(() => expect(h.sheets).toHaveLength(1));
    expect(h.sheets[0]!.payload).toMatchObject({
      files: 3, verified: 1,
      missing: { count: 1, titles: [lib.titleOf[lost!.assetId]], more: 0 },
      damaged: { count: 1, titles: [lib.titleOf[changed!.assetId]], more: 0 },
      records: null, countsMatch: true,
    });
    expect(fs.readdirSync(path.join(h.parent, NAME, 'staging'))).toHaveLength(1);
  });

  it('a backup whose database is broken ends failed with its own sentence and the code alone in the log: no folder, no sheet', async () => {
    const lib = await backedUp();
    fs.writeFileSync(path.join(lib.backup, 'library.sqlite'), 'not a database, '.repeat(64));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(lib);
    await h.job.start(null);
    await h.ended('failed');
    expect(h.notices.at(-1)).toEqual({ ...IDLE_RESTORE_PROGRESS, outcome: 'failed', error: { code: 'VALIDATION_FAILED', message: RESTORE_COPY.damagedDatabase } });
    expect(logged.mock.calls).toEqual([['[restore] failed: VALIDATION_FAILED']]);
    expect(fs.readdirSync(h.parent)).toEqual([]);
    expect(h.sheets).toEqual([]);
  });
});

describe('restoreSheet: the result sheet\'s facts (spec 9.3)', () => {
  const counts = (over: Partial<LibraryCounts> = {}): LibraryCounts => ({
    items: 128, assets: 140, revisions: 140, collections: 9, collectionItems: 30, tags: 14, itemTags: 40, readingPositions: 12, trashedItems: 7, trashedCollections: 2, ...over,
  });
  const result = (over: Partial<RestoreResult> = {}): RestoreResult => ({
    verifiedAssets: 128, missingAssets: [], hashMismatches: [], recordMismatches: [], counts: counts(), countsMatch: true,
    backupCreatedAt: '2026-10-30T12:41:00.000Z', managedFiles: 128, problemItems: [], ...over,
  });
  const item = (assetId: string, title: string, trashed = false) => ({ assetId, itemId: `${assetId}-${title}`, title, trashed });

  it('what came back: the live items and the trash\'s, live collections, tags, the copies listed and those read back as recorded', () => {
    expect(restoreSheet(result(), '/home/u/Learn 복원 2026-10-31 2141', '/home/u')).toEqual({
      kind: 'restoreDone', backupAt: '2026-10-30T12:41:00.000Z', items: 128, trashed: 7, collections: 9, tags: 14, files: 128, verified: 128,
      missing: null, damaged: null, records: null, countsMatch: true, location: '/home/u/Learn 복원 2026-10-31 2141', homeDir: '/home/u',
    });
  });

  it('a line per kind of problem: how many files, the first two items (live first, in the order given), then 외 N개; a record already said as missing or damaged is not said again', () => {
    const r = result({
      verifiedAssets: 125,
      missingAssets: ['m1', 'm2'],
      hashMismatches: ['d1'],
      recordMismatches: ['d1', 'r1'],
      countsMatch: false,
      problemItems: [item('m1', '분자생물학 5장 · 막 수송'), item('m2', '실험 2 · 단백질 정량'), item('d1', 'Second Messengers'), item('r1', 'r-live'), item('m2', '실험 2 사본', true)],
    });
    const sheet = restoreSheet(r, '/x', '/home/u');
    expect(RESTORE_ISSUE_NAMES).toBe(2);
    expect(sheet.missing).toEqual({ count: 2, titles: ['분자생물학 5장 · 막 수송', '실험 2 · 단백질 정량'], more: 1 });
    expect(sheet.damaged).toEqual({ count: 1, titles: ['Second Messengers'], more: 0 });
    expect(sheet.records).toEqual({ count: 1, titles: ['r-live'], more: 0 });
    expect(sheet).toMatchObject({ files: 128, verified: 125, countsMatch: false });
  });
});
