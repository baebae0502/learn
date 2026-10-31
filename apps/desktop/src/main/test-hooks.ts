import { createHash } from 'node:crypto';
import { newId, type ImportQueueState, type ImportReport, type LearnEventMap, type StorageMode, type TagColorId } from '@learn/domain';
import { SqliteError, type CollectionsRepository, type Db, type LibraryRepository, type TagsRepository } from '@learn/db';
import type { ImportHooks, Importer } from '@learn/library';
import type { ImportQueue } from './jobs/import-queue';

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
    metadataJson: JSON.stringify({
      creators: r.creators.map((name) => ({ name, role: 'author' })),
      ...(r.year === null ? {} : { date: String(r.year) }),
      ...(r.abstract ? { abstract: r.abstract } : {}),
      ...(r.extra ? { extra: r.extra } : {}),
    }),
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
  };
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
  };
}
