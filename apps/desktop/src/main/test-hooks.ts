import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { newId, nowIso, type ImportQueueState, type JobProgress, type LibraryCheck, type ImportReport, type LearnEventMap, type StorageMode, type TagColorId } from '@learn/domain';
import { SqliteError, type CollectionsRepository, type Db, type LibraryRepository, type TagsRepository } from '@learn/db';
import { fsyncDir, fsyncFile, managedRelativePath, type ImportHooks, type Importer, type LibraryLayout } from '@learn/library';
import type { BackupJob } from './jobs/backup-job';
import type { RestoreJob } from './jobs/restore-job';
import type { ImportQueue } from './jobs/import-queue';
import type { JobKind, JobLane } from './jobs/lane';
import type { AutoOutcome } from './library-check';
import type { FakeMode } from './translation/fake';

/** One seeded item's facts, as E2E sends them (tests/e2e/helpers.ts seedRows): main keeps no sample data itself. */
export interface SeedRow {
  title: string;
  creators: string[];
  year: number | null;
  createdAt: string;
  abstract?: string;
  extra?: string;
}
export interface SeedItemsInput {
  fromItemId: string;
  rows: SeedRow[];
}
export type SeedRepo = Pick<LibraryRepository, 'getItem' | 'insertItemsForAsset'>;

/** A seeded row's metadata as updateMetadata would store it (schema v1). */
const seedMetadataJson = (r: SeedRow): string =>
  JSON.stringify({
    creators: r.creators.map((name) => ({ name, role: 'author' })),
    ...(r.year === null ? {} : { date: String(r.year) }),
    ...(r.abstract ? { abstract: r.abstract } : {}),
    ...(r.extra ? { extra: r.extra } : {}),
  });

/**
 * Items for `rows` that share the file of the managed item `fromItemId` — its asset and revision — written in one
 * transaction (LibraryRepository.insertItemsForAsset). A large library in seconds, without copying a file per item.
 */
export function seedItems(repo: SeedRepo, input: SeedItemsInput, makeId: () => string = newId): string[] {
  const from = repo.getItem(input.fromItemId);
  if (!from) throw new Error('seedItems: unknown source item');
  if (from.storageMode !== 'managed') throw new Error('seedItems: the source item must be a managed copy');
  const rows = input.rows.map((r) => ({
    id: makeId(),
    type: from.type,
    title: r.title,
    createdAt: r.createdAt,
    metadataJson: seedMetadataJson(r),
    assetId: from.assetId,
    revisionId: from.revisionId,
  }));
  repo.insertItemsForAsset(rows);
  return rows.map((r) => r.id);
}

export interface SeedOrganizeInput {
  /** Ids of the items to organise, in the order every index below counts them by. */
  items: string[];
  /** `parent` is the index of an earlier entry, or null for a top-level collection. */
  collections: Array<{ name: string; parent: number | null }>;
  /** [collection index, item index] */
  memberships: Array<[number, number]>;
  /** A coloured tag has both `color` and `position` (1–8); an uncoloured one has neither. */
  tags: Array<{ name: string; color: TagColorId | null; position: number | null }>;
  /** [tag index, item index] */
  assignments: Array<[number, number]>;
  /**
   * Item-index groups that share one file. Given, every other item gets a file of its own, so these groups are the
   * library's only duplicates; left out, the items keep the one file seedItems gave them all.
   */
  duplicates?: number[][];
}
export interface SeedOrganizeResult {
  collectionIds: string[];
  tagIds: string[];
}
export interface OrganizeSeedDeps {
  db: Db;
  collections: CollectionsRepository;
  tags: TagsRepository;
}

interface FileRow {
  storage_mode: string;
  relative_path: string | null;
  external_path: string | null;
  original_name: string;
  mime: string;
  size: number;
  availability: string;
  created_at: string;
  checked_at: string | null;
}

/**
 * Items that share one file are one duplicate group for the snapshot (same sha256), and seedItems makes every item share
 * one. Each group gets one asset row of its own and every other item another, all pointing at the original's stored
 * file with a made-up hash (and the revision row an asset must have), so the groups are exactly the duplicates.
 */
function giveFiles(db: Db, itemIds: readonly string[], groups: readonly number[][]): void {
  const groupOf = new Map<number, number>();
  groups.forEach((g, k) =>
    g.forEach((i) => {
      if (groupOf.has(i)) throw new Error(`seedOrganize: item ${i} is in two duplicate groups`);
      groupOf.set(i, k);
    }),
  );
  const read = db.prepare(
    `SELECT a.storage_mode, a.relative_path, a.external_path, a.original_name, a.mime, a.size, a.availability, a.created_at, a.checked_at
       FROM item_assets ia JOIN assets a ON a.id = ia.asset_id WHERE ia.item_id = ? AND ia.role = 'original'`,
  );
  const insertAsset = db.prepare(
    `INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
     VALUES (@id, @sha256, @storage_mode, @relative_path, @external_path, @original_name, @mime, @size, @availability, @created_at, @checked_at)`,
  );
  const insertRevision = db.prepare('INSERT INTO source_revisions (id, asset_id, hash, created_at) VALUES (?, ?, ?, ?)');
  const repoint = db.prepare(`UPDATE item_assets SET asset_id = ? WHERE item_id = ? AND role = 'original'`);
  const groupAsset = new Map<number, string>();
  itemIds.forEach((itemId, i) => {
    const g = groupOf.get(i);
    let assetId = g === undefined ? undefined : groupAsset.get(g);
    if (assetId === undefined) {
      const file = read.get(itemId) as FileRow | undefined;
      if (!file) throw new Error(`seedOrganize: item ${i} has no original file`);
      assetId = newId();
      const sha256 = createHash('sha256').update(g === undefined ? `seed-file:item-${i}` : `seed-file:group-${g}`).digest('hex');
      insertAsset.run({ id: assetId, sha256, ...file });
      insertRevision.run(newId(), assetId, sha256, file.created_at);
      if (g !== undefined) groupAsset.set(g, assetId);
    }
    repoint.run(assetId, itemId);
  });
}

/**
 * The organise fixture (collections, memberships, tags, assignments, duplicate groups) in one transaction through the
 * repositories, so every rule they enforce (names, positions, live items only) holds for the seed too. Seed-only: ids
 * are fresh each time; what is deterministic is the structure the indexes describe.
 */
export function seedOrganize(deps: OrganizeSeedDeps, input: SeedOrganizeInput): SeedOrganizeResult {
  const item = (i: number, what: string): string => {
    const id = input.items[i];
    if (id === undefined) throw new Error(`seedOrganize: ${what} points at item ${i}, and there are ${input.items.length}`);
    return id;
  };
  return deps.db.transaction(() => {
    const collectionIds: string[] = [];
    input.collections.forEach((c, i) => {
      if (c.parent !== null && !(c.parent >= 0 && c.parent < i)) throw new Error(`seedOrganize: collection ${i} has parent ${c.parent}, which is not an earlier entry`);
      collectionIds.push(deps.collections.create({ name: c.name, parentId: c.parent === null ? null : collectionIds[c.parent]! }).id);
    });
    const members = new Map<number, string[]>();
    for (const [c, i] of input.memberships) {
      if (collectionIds[c] === undefined) throw new Error(`seedOrganize: a membership points at collection ${c}`);
      const list = members.get(c) ?? [];
      list.push(item(i, 'a membership'));
      members.set(c, list);
    }
    for (const [c, ids] of members) {
      const added = deps.collections.addItemsChanged(collectionIds[c]!, ids);
      if (added.length !== ids.length) throw new Error(`seedOrganize: collection ${c} took ${added.length} of ${ids.length} memberships (a repeated pair?)`);
    }
    const tagIds = input.tags.map((t) => {
      if ((t.color === null) !== (t.position === null)) throw new Error(`seedOrganize: tag ${t.name} needs both colour and position, or neither`);
      const made = deps.tags.create(t.name);
      return t.color === null ? made.id : deps.tags.setColor(made.id, t.color, t.position).id;
    });
    const tagged = new Map<number, string[]>();
    for (const [t, i] of input.assignments) {
      if (tagIds[t] === undefined) throw new Error(`seedOrganize: an assignment points at tag ${t}`);
      const list = tagged.get(t) ?? [];
      list.push(item(i, 'an assignment'));
      tagged.set(t, list);
    }
    for (const [t, ids] of tagged) {
      const added = deps.tags.assignChanged(tagIds[t]!, ids);
      if (added.length !== ids.length) throw new Error(`seedOrganize: tag ${t} took ${added.length} of ${ids.length} assignments (a repeated pair?)`);
    }
    if (input.duplicates) {
      input.duplicates.forEach((g) => g.forEach((i) => item(i, 'a duplicate group')));
      giveFiles(deps.db, input.items, input.duplicates);
    }
    return { collectionIds, tagIds };
  })();
}

/** The import-commit failures an E2E can stage, with the sentence SQLite gives each (sqlite3_errstr). */
const STAGED_SQLITE_ERRORS = { SQLITE_FULL: 'database or disk is full', SQLITE_READONLY: 'attempt to write a readonly database' } as const;
export type StagedSqliteError = keyof typeof STAGED_SQLITE_ERRORS;

/**
 * Wraps the repository's import commit so that, while a code is set, it throws what SQLite throws on a full disk or a
 * read-only library: the importer, toLearnError and the failure toast then run as for the real thing (no small insert
 * fills a real database on cue). Returns the setter; null lets commits through again.
 */
export function stageCommitFailures(repo: Pick<LibraryRepository, 'insertImported'>): (code: StagedSqliteError | null) => void {
  let failing: StagedSqliteError | null = null;
  const commit = repo.insertImported.bind(repo);
  repo.insertImported = (rec) => {
    if (failing !== null) throw new SqliteError(STAGED_SQLITE_ERRORS[failing], failing);
    return commit(rec);
  };
  return (code) => {
    failing = code;
  };
}

export type ImportPausePoint = 'afterStage' | 'afterPlace' | 'beforeCommit';

export interface ImportPause {
  hooks: ImportHooks;
  /** The next file to reach `at` waits there until resume() — one file: the ones after it run on. null calls it off. */
  pause(at: ImportPausePoint | null): void;
  resume(): void;
  /** Where a file waits now, or null. */
  waiting(): ImportPausePoint | null;
}

/**
 * E2E only: the importer's fault points as places a file can be held (afterStage: its verified copy is in staging/;
 * afterPlace: its copy is in assets/, no row yet; beforeCommit). A test holds a file there, then kills the app.
 */
export function createImportPause(): ImportPause {
  let armed: ImportPausePoint | null = null;
  let waitingAt: ImportPausePoint | null = null;
  let release: (() => void) | null = null;
  const point = (at: ImportPausePoint) => async (): Promise<void> => {
    if (armed !== at) return;
    armed = null;
    waitingAt = at;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    waitingAt = null;
  };
  return {
    hooks: { afterStage: point('afterStage'), afterPlace: point('afterPlace'), beforeCommit: point('beforeCommit') },
    pause(at) {
      armed = at;
    },
    resume() {
      const go = release;
      release = null;
      go?.();
    },
    waiting: () => waitingAt,
  };
}

export interface SeedAssetsInput {
  /** One item each, in this order (seedRows: newest first). */
  rows: SeedRow[];
  /** Rows from this index on are linked to a file of their own in `linkedDir`; the rows before it are managed copies. Default: none linked. */
  linkedFrom?: number;
  /** Absolute; made when missing. */
  linkedDir?: string;
}
export interface SeedAssetsResult {
  /** In the rows' order. */
  itemIds: string[];
  /** Each item's file hash, in the rows' order. */
  sha256: string[];
}
export interface SeedAssetsDeps {
  db: Db;
  repo: Pick<LibraryRepository, 'insertItemsForAsset'>;
  layout: Pick<LibraryLayout, 'root'>;
}

/**
 * Items that each have a file of their own — what a library of many imports is to the library check, a purge and a
 * backup — without importing them one by one: a small PDF per row (bytes unique to this call), written where an import
 * puts it (assets/<xx>/<sha256>, or `linkedDir` for a linked row), then every row in one transaction. E2E only.
 */
export function seedAssets(deps: SeedAssetsDeps, input: SeedAssetsInput, makeId: () => string = newId): SeedAssetsResult {
  const linkedFrom = input.linkedFrom ?? input.rows.length;
  if (!Number.isInteger(linkedFrom) || linkedFrom < 0) throw new Error('seedAssets: linkedFrom must be a row index');
  const linkedDir = input.linkedDir;
  if (linkedFrom < input.rows.length && (linkedDir === undefined || !path.isAbsolute(linkedDir))) throw new Error('seedAssets: linked rows need an absolute linkedDir');
  const batch = makeId();
  const now = nowIso();
  const files = input.rows.map((row, i) => {
    const bytes = Buffer.from(`%PDF-1.4\n% learn seed ${batch} ${i + 1}\n%%EOF\n`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const linked = i >= linkedFrom;
    const relativePath = linked ? null : managedRelativePath(sha256);
    const target = relativePath === null ? path.join(linkedDir!, `seed-${i + 1}.pdf`) : path.join(deps.layout.root, ...relativePath.split('/'));
    return { row, i, bytes, sha256, linked, relativePath, target, assetId: makeId(), revisionId: makeId(), itemId: makeId() };
  });
  // The files first: a row is written only for a file that is there.
  const folders = new Set<string>();
  for (const f of files) {
    const folder = path.dirname(f.target);
    if (!folders.has(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      folders.add(folder);
    }
    fs.writeFileSync(f.target, f.bytes);
  }
  const insertAsset = deps.db.prepare(
    `INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, 'available', ?, ?)`,
  );
  const insertRevision = deps.db.prepare('INSERT INTO source_revisions (id, asset_id, hash, created_at) VALUES (?, ?, ?, ?)');
  deps.db.transaction(() => {
    for (const f of files) {
      insertAsset.run(f.assetId, f.sha256, f.linked ? 'linked' : 'managed', f.relativePath, f.linked ? f.target : null, `seed-${f.i + 1}.pdf`, f.bytes.length, f.row.createdAt, now);
      insertRevision.run(f.revisionId, f.assetId, f.sha256, f.row.createdAt);
    }
    deps.repo.insertItemsForAsset(
      files.map((f) => ({ id: f.itemId, type: 'pdf' as const, title: f.row.title, createdAt: f.row.createdAt, metadataJson: seedMetadataJson(f.row), assetId: f.assetId, revisionId: f.revisionId })),
    );
  })();
  return { itemIds: files.map((f) => f.itemId), sha256: files.map((f) => f.sha256) };
}

export interface FsyncProbeInput {
  /** Absolute, and new: the probe makes staging/ and assets/<xx>/ in it. */
  dir: string;
  /** 1–256: one new shard each. */
  files: number;
  bytes: number;
}
export interface FsyncProbeResult {
  /** fsyncDir of assets/ after a new shard was made in it. */
  parentMs: number[];
  /** fsyncFile of the staging copy before its rename. */
  fileMs: number[];
  /** fsyncDir of the shard after the rename. */
  shardMs: number[];
  /** This process's libuv (macOS: F_FULLFSYNC since 1.25.0, Q-2c). */
  uv: string;
}
export interface FsyncIo {
  fsyncFile(file: string): Promise<void>;
  fsyncDir(dir: string): Promise<void>;
}

/**
 * One import's flushes as Importer.place makes them on a new shard — its parent, the staging copy before the rename,
 * the shard after it — `files` times on random files of `bytes` in `dir` (the test's folder, on the library's disk), with
 * the importer's own fsyncFile and fsyncDir: a Mac run measures F_FULLFSYNC as the app pays it. E2E evidence only.
 */
export async function fsyncProbe(input: FsyncProbeInput, io: FsyncIo = { fsyncFile, fsyncDir }): Promise<FsyncProbeResult> {
  if (!path.isAbsolute(input.dir)) throw new Error('fsyncProbe: dir must be absolute');
  if (!Number.isInteger(input.files) || input.files < 1 || input.files > 256) throw new Error('fsyncProbe: 1 to 256 files (one new shard each)');
  if (!Number.isInteger(input.bytes) || input.bytes < 1) throw new Error('fsyncProbe: bytes must be a positive integer');
  const staging = path.join(input.dir, 'staging');
  const assets = path.join(input.dir, 'assets');
  await fsp.mkdir(staging, { recursive: true });
  await fsp.mkdir(assets, { recursive: true });
  const out: FsyncProbeResult = { parentMs: [], fileMs: [], shardMs: [], uv: process.versions.uv };
  const timed = async (list: number[], run: () => Promise<void>): Promise<void> => {
    const start = performance.now();
    await run();
    list.push(performance.now() - start);
  };
  for (let i = 0; i < input.files; i++) {
    const name = i.toString(16).padStart(2, '0');
    const staged = path.join(staging, `${name}.part`);
    await fsp.writeFile(staged, randomBytes(input.bytes));
    const shard = path.join(assets, name);
    await fsp.mkdir(shard);
    await timed(out.parentMs, () => io.fsyncDir(assets));
    await timed(out.fileMs, () => io.fsyncFile(staged));
    await fsp.rename(staged, path.join(shard, name));
    await timed(out.shardMs, () => io.fsyncDir(shard));
  }
  return out;
}

export interface LearnTestHooks {
  /** Returns how many items were added. */
  seedItems(input: SeedItemsInput): number;
  /** Seed-only: the organise fixture over items that exist (E2E, one transaction). */
  seedOrganize(input: SeedOrganizeInput): SeedOrganizeResult;
  /** Calls of these IPC channels wait `ms` before they run from now on (ipc/register.ts heldBack); 0 runs them at once again. */
  holdReplies(input: { channels: string[]; ms: number }): void;
  /** From now on every import commit fails as SQLite fails on a full disk or a read-only library; null ends it (stageCommitFailures). */
  failImportCommits(input: { code: StagedSqliteError | null }): void;
  /** Holds the next file of an import at that point (createImportPause); null calls it off. */
  importPause(input: { at: ImportPausePoint | null }): void;
  importResume(): void;
  importWaiting(): ImportPausePoint | null;
  /** Puts files in the import queue as the main window's import does, before any page can. */
  enqueueImport(input: { paths: string[]; mode?: StorageMode; collectionId?: string | null }): number;
  importQueueState(): ImportQueueState;
  /** Every import run's report since launch, oldest first. */
  importReports(): ImportReport[];
  /**
   * Holds the work line with a job of this kind until releaseJob, so an import put in meanwhile waits behind it (its
   * toast says 앞의 작업을 기다리는 중) before backups and restores exist. Quitting stops it like theirs.
   */
  holdJob(input: { kind: Exclude<JobKind, 'import'> }): void;
  releaseJob(): void;
  /**
   * The next backup holds its first copy once it is written, before it is read back (spec 8.1), until backupResume — so a
   * test sees its toast, presses its 취소, or changes the copy under it. `null` lifts it.
   */
  backupPause(input: { at: 'afterCopy' | null }): void;
  backupResume(): void;
  /** The held copy's path inside the backup being made, or null. */
  backupWaiting(): string | null;
  backupState(): JobProgress;
  /**
   * The next restore holds its first copy once written, before it is read back (spec 9.2), until restoreResume — so a
   * test sees its toast, presses its 취소, or quits while it runs. `null` lifts it.
   */
  restorePause(input: { at: 'afterCopy' | null }): void;
  restoreResume(): void;
  /** The held copy's path inside the library being made, or null. */
  restoreWaiting(): string | null;
  restoreState(): JobProgress;
  /** Items with a file each (seedAssets): copies in the library, the rows from `linkedFrom` on linked to files in `linkedDir`. */
  seedAssets(input: SeedAssetsInput): SeedAssetsResult;
  /** One import's flushes, `files` times, with the importer's own fsyncFile and fsyncDir (Q-2c's cost line). */
  fsyncProbe(input: FsyncProbeInput): Promise<FsyncProbeResult>;
  /** The newest library check and what the startup check did about the automatic sheet ('pending' until it decided). */
  libraryCheck(): { check: LibraryCheck | null; auto: AutoOutcome | 'pending' };
  /** A fresh check, then recovery:show to the main window: the automatic sheet again (the tour, after it sized the window). */
  requestLibraryCheck(): Promise<void>;
  /** Sets how the fake translation engine answers (E2E always runs on it). */
  translationFake(mode: FakeMode): void;
  /** How many requests the fake translation engine has taken since launch (a cache hit or a refusal takes none). */
  translationCalls(): number;
}

/**
 * E2E only (index.ts installs it when isE2E): `globalThis.__learnTest`, which tests call through app.evaluate. One
 * libraryChanged{import} for the whole batch, without ids: the renderer reads the list once.
 */
export function installTestHooks(deps: {
  repo(): SeedRepo;
  /** The repository whose import commit failImportCommits wraps (the live library's). */
  importCommits(): Pick<LibraryRepository, 'insertImported'>;
  /** The import queue and the importer it runs (unit tests that do not need them leave this out). */
  imports?: {
    importer(): Pick<Importer, 'setHooks'>;
    queue: Pick<ImportQueue, 'enqueue' | 'state' | 'onFinished'>;
    /** The main window's webContents id, the owner of what a test puts in; null while it is not open. */
    mainWindowId(): number | null;
    /** The work line holdJob takes (unit tests that do not hold it leave it out). */
    lane?: Pick<JobLane, 'run'>;
  };
  /** The backup job (backupPause and its kin; tests that do not use them leave it out). */
  backup?: Pick<BackupJob<unknown>, 'setHooks' | 'state'>;
  /** The restore job (restorePause and its kin; tests that do not use them leave it out). */
  restore?: Pick<RestoreJob<unknown>, 'setHooks' | 'state'>;
  /** The open library seedAssets writes into (index.ts); absent in tests that do not seed files. */
  seedFiles?: () => SeedAssetsDeps;
  /** The library check (index.ts); absent in tests that do not use it. */
  check?: { state(): { check: LibraryCheck | null; auto: AutoOutcome | 'pending' }; request(): Promise<void> };
  /** The fake translation engine (index.ts, E2E only). */
  translation?: { setMode(mode: FakeMode): void; calls(): number };
  organize(): OrganizeSeedDeps;
  broadcast(name: 'libraryChanged', payload: LearnEventMap['libraryChanged']): void;
}): void {
  // The IPC call counter (ipc/register.ts countCall): a test reads which channels a change called.
  (globalThis as { __learnIpcCalls?: Record<string, number> }).__learnIpcCalls = {};
  // How long each channel's calls are held back (ipc/register.ts heldBack): a test makes main slow.
  const delays: Record<string, number> = {};
  (globalThis as { __learnIpcDelays?: Record<string, number> }).__learnIpcDelays = delays;
  let stage: ((code: StagedSqliteError | null) => void) | null = null;
  const pause = createImportPause();
  const reports: ImportReport[] = [];
  const imports = deps.imports;
  if (imports) {
    try {
      imports.importer().setHooks(pause.hooks);
    } catch {
      // No library is open (the fatal screen): there is no import to hold.
    }
    imports.queue.onFinished((report) => reports.push(report));
  }
  const queue = () => {
    if (!imports) throw new Error('installTestHooks: no import queue');
    return imports;
  };
  let heldJob: (() => void) | null = null;
  let backupHeld: { file: string; go: () => void } | null = null;
  const backupJob = (): NonNullable<typeof deps.backup> => {
    if (!deps.backup) throw new Error('backup hooks: no backup job');
    return deps.backup;
  };
  let restoreHeld: { file: string; go: () => void } | null = null;
  const restoreJob = (): NonNullable<typeof deps.restore> => {
    if (!deps.restore) throw new Error('restore hooks: no restore job');
    return deps.restore;
  };
  (globalThis as { __learnTest?: LearnTestHooks }).__learnTest = {
    seedItems(input) {
      const ids = seedItems(deps.repo(), input);
      deps.broadcast('libraryChanged', { reason: 'import' });
      return ids.length;
    },
    seedOrganize(input) {
      const out = seedOrganize(deps.organize(), input);
      deps.broadcast('libraryChanged', { reason: 'import' });
      return out;
    },
    holdReplies({ channels, ms }) {
      for (const channel of channels) {
        if (ms > 0) delays[channel] = ms;
        else delete delays[channel];
      }
    },
    failImportCommits({ code }) {
      stage ??= stageCommitFailures(deps.importCommits());
      stage(code);
    },
    importPause: ({ at }) => pause.pause(at),
    importResume: () => pause.resume(),
    importWaiting: () => pause.waiting(),
    enqueueImport({ paths, mode = 'managed', collectionId = null }) {
      const q = queue();
      const owner = q.mainWindowId();
      if (owner === null) throw new Error('enqueueImport: no main window');
      return q.queue.enqueue({ paths, mode, collectionId, owner });
    },
    importQueueState: () => queue().queue.state(),
    importReports: () => [...reports],
    holdJob({ kind }) {
      const lane = queue().lane;
      if (!lane) throw new Error('holdJob: no work line');
      if (heldJob) throw new Error('holdJob: a job is held already');
      let release = (): void => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldJob = release;
      void lane
        .run(kind, (signal) => {
          signal.addEventListener('abort', () => release(), { once: true });
          return held;
        })
        .catch(() => {})
        .finally(() => {
          if (heldJob === release) heldJob = null;
        });
    },
    releaseJob() {
      const go = heldJob;
      heldJob = null;
      go?.();
    },
    backupPause({ at }) {
      if (at === null) {
        backupJob().setHooks(undefined);
        return;
      }
      let armed = true;
      backupJob().setHooks({
        afterCopy: (file) => {
          if (!armed) return undefined;
          armed = false; // once: the copies after it pass
          return new Promise<void>((resolve) => {
            backupHeld = { file, go: resolve };
          });
        },
      });
    },
    backupResume() {
      const held = backupHeld;
      backupHeld = null;
      held?.go();
    },
    backupWaiting: () => backupHeld?.file ?? null,
    backupState: () => backupJob().state(),
    restorePause({ at }) {
      if (at === null) {
        restoreJob().setHooks(undefined);
        return;
      }
      let armed = true;
      restoreJob().setHooks({
        afterCopy: (file) => {
          if (!armed) return undefined;
          armed = false; // once: the copies after it pass
          return new Promise<void>((resolve) => {
            restoreHeld = { file, go: resolve };
          });
        },
      });
    },
    restoreResume() {
      const held = restoreHeld;
      restoreHeld = null;
      held?.go();
    },
    restoreWaiting: () => restoreHeld?.file ?? null,
    restoreState: () => restoreJob().state(),
    seedAssets(input) {
      if (!deps.seedFiles) throw new Error('seedAssets: no library to seed');
      const out = seedAssets(deps.seedFiles(), input);
      deps.broadcast('libraryChanged', { reason: 'import' });
      return out;
    },
    fsyncProbe: (input) => fsyncProbe(input),
    libraryCheck() {
      if (!deps.check) throw new Error('libraryCheck: no library check');
      return deps.check.state();
    },
    translationFake(mode) {
      if (!deps.translation) throw new Error('translationFake: no fake engine');
      deps.translation.setMode(mode);
    },
    translationCalls() {
      if (!deps.translation) throw new Error('translationCalls: no fake engine');
      return deps.translation.calls();
    },
    async requestLibraryCheck() {
      if (!deps.check) throw new Error('requestLibraryCheck: no library check');
      await deps.check.request();
    },
  };
}
