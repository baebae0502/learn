import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_BACKUP_PROGRESS, LearnError, type BackupDoneSheet, type JobProgress } from '@learn/domain';
import { LibraryRepository, SettingsRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, ensureLayout, libraryLayout } from '@learn/library';
import { mainStrings } from '../strings';
import { createBackupJob, type BackupJobDeps, type BackupLibrary } from './backup-job';
import { createJobLane } from './lane';
import { quitQuestion } from './quit-guard';

const made: string[] = [];
const dbs: Db[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) if (db.open) db.close();
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const temp = (name: string): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `learn-bj-${name}-`));
  made.push(d);
  return d;
};
const pdf = (dir: string, name: string): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${name}\n%%EOF\n`);
  return p;
};

/** Two copies and one linked file, in a library of its own. */
async function library(): Promise<BackupLibrary> {
  const layout = libraryLayout(path.join(temp('lib'), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const importer = new Importer({ layout, repo });
  const src = temp('src');
  await importer.importOne(pdf(src, 'a.pdf'), { mode: 'managed' });
  await importer.importOne(pdf(src, 'b.pdf'), { mode: 'managed' });
  await importer.importOne(pdf(src, 'c.pdf'), { mode: 'linked' });
  return { layout, db, repo, settings: new SettingsRepository(db) };
}

type Win = { id: number };
const WHEN = new Date(2026, 9, 30, 21, 41, 5);
function harness(lib: BackupLibrary, over: Partial<BackupJobDeps<Win>> = {}) {
  const lane = createJobLane();
  const parent = temp('dest');
  const notices: JobProgress[] = [];
  const results: Array<{ owner: Win | null; payload: BackupDoneSheet }> = [];
  const picks: Array<{ owner: Win | null; defaultPath: string }> = [];
  const remembered: string[] = [];
  const stored = vi.fn();
  let dir: string | null = null;
  const job = createBackupJob<Win>({
    lane,
    library: () => lib,
    pickFolder: async (owner, opts) => {
      picks.push({ owner, ...opts });
      return parent;
    },
    backupDir: () => dir,
    rememberDir: (d) => {
      dir = d;
      remembered.push(d);
    },
    documentsDir: () => '/home/u/Documents',
    homeDir: () => '/home/u',
    progress: (p) => notices.push(p),
    stored,
    showResult: (owner, payload) => results.push({ owner, payload }),
    now: () => WHEN,
    progressMs: 0,
    ...over,
  });
  const ended = (outcome: JobProgress['outcome']) => vi.waitFor(() => expect(notices.at(-1)?.outcome).toBe(outcome));
  return { job, lane, parent, notices, results, picks, remembered, stored, ended };
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

describe('the backup on the work line (spec 8.1, P-20)', () => {
  it('asks where (the documents folder the first time, then the folder chosen last), names the folder by the minute, and ends with the result sheet', async () => {
    const lib = await library();
    const h = harness(lib);
    const owner = { id: 7 };
    expect(await h.job.start(owner)).toEqual({ started: true });
    await h.ended('done');
    const name = 'Learn 백업 2026-10-30 2141';
    const folder = path.join(h.parent, name);
    expect(h.picks).toEqual([{ owner, defaultPath: '/home/u/Documents' }]);
    expect(h.remembered).toEqual([h.parent]);
    expect(fs.readdirSync(h.parent)).toEqual([name]);
    expect(fs.readdirSync(folder).sort()).toEqual(['assets', 'library.sqlite', 'manifest.json']);
    // Running from the start (nothing ran before it), named, counted; then idle, done.
    expect(h.notices[0]).toEqual({ ...IDLE_BACKUP_PROGRESS, state: 'running' });
    expect(h.notices.some((n) => n.state === 'waiting-job')).toBe(false);
    expect(h.notices.filter((n) => n.state === 'running').at(-1)).toMatchObject({ name, done: 2, total: 2 });
    expect(h.notices.at(-1)).toEqual({ ...IDLE_BACKUP_PROGRESS, outcome: 'done' });
    expect(lib.settings.get('backup.last')).toEqual({ at: WHEN.toISOString(), folder });
    expect(h.stored).toHaveBeenCalledTimes(1);
    const bytes = lib.repo.assetsByMode('managed').reduce((n, a) => n + a.size, 0);
    expect(h.results).toEqual([
      { owner, payload: { kind: 'backupDone', at: WHEN.toISOString(), tookMs: 0, items: 3, trashed: 0, files: 2, bytes, linked: 1, missing: 0, location: folder, homeDir: '/home/u' } },
    ]);

    // The next one opens on that folder, and takes a name of its own in the same minute.
    expect(await h.job.start(owner)).toEqual({ started: true });
    await vi.waitFor(() => expect(h.results).toHaveLength(2));
    expect(h.picks[1]!.defaultPath).toBe(h.parent);
    expect(fs.readdirSync(h.parent).sort()).toEqual([name, `${name} 2`]);
  });

  it('a cancelled panel starts nothing; with a backup on the line a second is refused unasked', async () => {
    const lib = await library();
    const cancelled = harness(lib, { pickFolder: async () => null });
    expect(await cancelled.job.start(null)).toEqual({ started: false });
    expect([cancelled.notices, cancelled.remembered]).toEqual([[], []]);

    const h = harness(lib);
    const first = holdFirst();
    h.job.setHooks(first.hooks);
    expect(await h.job.start(null)).toEqual({ started: true });
    await vi.waitFor(() => expect(first.held()).toBe(true));
    expect(await h.job.start(null)).toEqual({ started: false });
    expect(h.picks).toHaveLength(1);
    first.release();
    await h.ended('done');
  });

  it('refuses a folder inside the library, or one that is gone, before anything runs; with no library it asks nothing', async () => {
    const lib = await library();
    for (const chosen of [lib.layout.root, path.join(lib.layout.root, 'assets')]) {
      const h = harness(lib, { pickFolder: async () => chosen });
      await expect(h.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.backup.inLibrary });
      expect([h.notices, h.remembered]).toEqual([[], []]);
    }
    const gone = harness(lib, { pickFolder: async () => path.join(temp('x'), 'gone') });
    await expect(gone.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.libraryFolder.missing });
    const closed = harness(lib, {
      library: () => {
        throw new LearnError('LIBRARY_UNAVAILABLE', mainStrings.library.unavailable);
      },
    });
    await expect(closed.job.start(null)).rejects.toMatchObject({ code: 'LIBRARY_UNAVAILABLE' });
    expect(closed.picks).toEqual([]);
  });

  it('refuses a folder that only reaches into the library through a link', async () => {
    const lib = await library();
    const link = path.join(temp('links'), 'Shortcut');
    fs.symlinkSync(path.join(lib.layout.root, 'assets'), link, 'dir');
    const h = harness(lib, { pickFolder: async () => link });
    await expect(h.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.backup.inLibrary });
    expect([h.notices, h.remembered]).toEqual([[], []]);
    expect(fs.readdirSync(path.join(lib.layout.root, 'assets')).filter((n) => n.startsWith('Learn'))).toEqual([]);
  });

  it('refuses a folder inside the library whose name only starts with two dots', async () => {
    const lib = await library();
    const dotted = path.join(lib.layout.root, '..hidden');
    fs.mkdirSync(dotted);
    const h = harness(lib, { pickFolder: async () => dotted });
    await expect(h.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.backup.inLibrary });
    expect(fs.readdirSync(dotted)).toEqual([]);
  });

  it('checks the folder against the library that is open when the panel returns, not the one before it', async () => {
    const before = await library();
    const after = await library();
    let open = before;
    const h = harness(before, {
      library: () => open,
      pickFolder: async () => {
        open = after; // restore swapped the library while the panel was up
        return path.join(after.layout.root, 'assets');
      },
    });
    await expect(h.job.start(null)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: mainStrings.backup.inLibrary });
    expect(h.remembered).toEqual([]);
  });

  it('waits behind a running import as waiting-job and runs after it; 취소 while it waits ends it at once, and it never runs', async () => {
    const lib = await library();
    const h = harness(lib);
    let letGo: () => void = () => {};
    void h.lane.run('import', () => new Promise<void>((resolve) => (letGo = resolve)));
    expect(await h.job.start(null)).toEqual({ started: true });
    expect(h.notices).toEqual([{ ...IDLE_BACKUP_PROGRESS, state: 'waiting-job' }]);
    h.job.cancel();
    expect(h.notices.at(-1)).toEqual({ ...IDLE_BACKUP_PROGRESS, outcome: 'cancelled' });
    letGo();
    await h.lane.idle();
    expect(fs.readdirSync(h.parent)).toEqual([]);
    expect(h.notices.filter((n) => n.outcome !== undefined)).toHaveLength(1); // ended once
    expect(h.results).toEqual([]);

    const after = harness(lib);
    let go: () => void = () => {};
    void after.lane.run('import', () => new Promise<void>((resolve) => (go = resolve)));
    await after.job.start(null);
    go();
    await after.ended('done');
    expect(after.notices.slice(0, 2).map((n) => n.state)).toEqual(['waiting-job', 'running']);
  });

  it('취소 while copying, or the line stopped for a quit, leaves no folder and ends cancelled; 마지막 백업 is not touched', async () => {
    const lib = await library();
    const h = harness(lib);
    const first = holdFirst();
    h.job.setHooks(first.hooks);
    await h.job.start(null);
    await vi.waitFor(() => expect(first.held()).toBe(true));
    h.job.cancel();
    first.release();
    await h.ended('cancelled');
    expect(fs.readdirSync(h.parent)).toEqual([]);
    expect(lib.settings.get('backup.last')).toBeUndefined();

    const quit = harness(lib);
    const held = holdFirst();
    quit.job.setHooks(held.hooks);
    await quit.job.start(null);
    await vi.waitFor(() => expect(held.held()).toBe(true));
    quit.lane.cancelAll();
    held.release();
    await quit.ended('cancelled');
    expect(fs.readdirSync(quit.parent)).toEqual([]);
    // What the quit question says meanwhile (spec 3.6; Task 3 asks it).
    expect(quitQuestion('backup', 0)).toMatchObject({ message: '백업을 만드는 중입니다', detail: '끝내면 만들던 백업은 남지 않습니다.' });
  });

  it('a copy that reads back different ends failed with its own sentence and the code alone in the log; no folder, no 마지막 백업, no sheet', async () => {
    const lib = await library();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = harness(lib);
    h.job.setHooks({ afterCopy: (file) => fs.appendFileSync(file, 'changed on the way') });
    await h.job.start(null);
    await h.ended('failed');
    expect(h.notices.at(-1)).toEqual({ ...IDLE_BACKUP_PROGRESS, outcome: 'failed', error: { code: 'HASH_MISMATCH', message: mainStrings.backup.copyMismatch } });
    expect(logged.mock.calls).toEqual([['[backup] failed: HASH_MISMATCH']]);
    expect(fs.readdirSync(h.parent)).toEqual([]);
    expect(lib.settings.get('backup.last')).toBeUndefined();
    expect(h.results).toEqual([]);
  });
});
