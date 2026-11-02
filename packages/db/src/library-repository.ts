import {
  LearnError, clipSearchText, creatorNames, itemMetadataSchema, nowIso, parseItemMetadata, yearOf,
  type Availability, type DuplicateGroup, type ItemDetail, type ItemMetadata, type ItemType, type KeepOneResult, type KeepOneUndo, type LibraryItem,
  type SearchText, type StorageMode, type TrashView,
} from '@learn/domain';
import type { Db } from './connection';
import { nextDeletionStamp } from './deletion-stamp';
import { keepOneOf, undoKeepOne } from './duplicates';
import { CollectionsRepository } from './collections-repository';
import { TagsRepository } from './tags-repository';
import { emptyTrash, purgeTrash, trashedCollections, trashPlaces, type PurgeResult } from './trash';

export interface AssetRow {
  id: string;
  sha256: string;
  storageMode: StorageMode;
  relativePath: string | null;
  externalPath: string | null;
  originalName: string;
  mime: string;
  size: number;
  availability: Availability;
  createdAt: string;
  checkedAt: string | null;
}

export interface NewImportRecord {
  item: { id: string; type: ItemType; title: string; createdAt: string };
  asset: AssetRow;
  /** false when the item reuses an existing asset (then `revision` must be null). */
  assetIsNew: boolean;
  revision: { id: string; createdAt: string } | null;
  job: { id: string; kind: string; dedupeKey: string; payload: Record<string, unknown> } | null;
  /** File the new item into this collection in the same transaction; skipped when it is gone by then. */
  collectionId?: string | null;
}

export interface LibraryCounts {
  items: number;
  assets: number;
  revisions: number;
  collections: number;
  collectionItems: number;
  tags: number;
  itemTags: number;
  readingPositions: number;
  /** In the trash (spec 8.3: items with and without it) — the live counts above leave them out. */
  trashedItems: number;
  trashedCollections: number;
}

/** An item whose original file is a given asset (a restore names the items its problems touch, spec 9.3). */
export interface AssetItem {
  assetId: string;
  itemId: string;
  title: string;
  /** In the trash: listed after the live ones. */
  trashed: boolean;
}

export interface MetadataUpdate {
  title?: string;
  metadata?: ItemMetadata;
}

interface AssetDbRow {
  id: string; sha256: string; storage_mode: StorageMode; relative_path: string | null; external_path: string | null;
  original_name: string; mime: string; size: number; availability: Availability; created_at: string; checked_at: string | null;
}
interface ItemDbRow {
  id: string; title: string; type: ItemType; created_at: string; updated_at: string; metadata_json: string;
  asset_id: string; mime: string; size: number; storage_mode: StorageMode; availability: Availability; original_name: string;
  sha256: string; external_path: string | null; revision_id: string; progress: number | null; opened_at: string | null; deleted_at: string | null;
}

/** Item + original asset + latest revision + reading position. Callers add the deleted_at filter (ITEM_SELECT / TRASH_SELECT). */
const ITEM_FROM = `
SELECT i.id, i.title, i.type, i.created_at, i.updated_at, i.metadata_json, i.deleted_at,
       a.id AS asset_id, a.mime, a.size, a.storage_mode, a.availability, a.original_name, a.sha256, a.external_path,
       (SELECT r.id FROM source_revisions r WHERE r.asset_id = a.id
         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS revision_id,
       rp.progress, rp.opened_at
FROM items i
JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
JOIN assets a ON a.id = ia.asset_id
LEFT JOIN reading_positions rp ON rp.item_id = i.id`;
const ITEM_SELECT = `${ITEM_FROM} WHERE i.deleted_at IS NULL`;
const TRASH_SELECT = `${ITEM_FROM} WHERE i.deleted_at IS NOT NULL`;

/** SQLite caps the variables of one statement; ids are asked in chunks of this size (getItems). */
const GET_ITEMS_CHUNK = 500;

const toAsset = (r: AssetDbRow): AssetRow => ({
  id: r.id, sha256: r.sha256, storageMode: r.storage_mode, relativePath: r.relative_path, externalPath: r.external_path,
  originalName: r.original_name, mime: r.mime, size: r.size, availability: r.availability, createdAt: r.created_at, checkedAt: r.checked_at,
});

const toItem = (r: ItemDbRow, meta: ItemMetadata = parseItemMetadata(r.metadata_json)): LibraryItem => ({
  id: r.id, title: r.title, type: r.type, mime: r.mime, size: r.size, storageMode: r.storage_mode,
  availability: r.availability, assetId: r.asset_id, revisionId: r.revision_id, originalName: r.original_name, createdAt: r.created_at,
  updatedAt: r.updated_at, creators: creatorNames(meta), year: yearOf(meta), publisher: meta.publisher || null, progress: r.progress, openedAt: r.opened_at,
});

const itemNotFound = () => new LearnError('NOT_FOUND', '항목을 찾을 수 없습니다.');

export class LibraryRepository {
  constructor(private readonly db: Db) {}

  findAssetsBySha(sha256: string): AssetRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM assets WHERE sha256 = ? ORDER BY storage_mode = 'managed' DESC, created_at, rowid`)
      .all(sha256) as AssetDbRow[];
    return rows.map(toAsset);
  }

  getAsset(id: string): AssetRow | undefined {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetDbRow | undefined;
    return row && toAsset(row);
  }

  allAssets(): AssetRow[] {
    return (this.db.prepare('SELECT * FROM assets ORDER BY created_at, rowid').all() as AssetDbRow[]).map(toAsset);
  }

  /** How many items, the trash too, have each asset as their original: a backup counts its linked and lost files by item (spec 8.2). */
  itemCountsByAsset(): Map<string, number> {
    const rows = this.db.prepare(`SELECT asset_id AS id, COUNT(*) AS n FROM item_assets WHERE role = 'original' GROUP BY asset_id`).all() as Array<{ id: string; n: number }>;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /**
   * The items, the trash's too, whose original file is one of `assetIds`: live ones first, then the trash's, each in the
   * order it came in; an item once.
   */
  originalItemsOf(assetIds: readonly string[]): AssetItem[] {
    const ids = [...new Set(assetIds)];
    const rows: Array<{ assetId: string; itemId: string; title: string; trashed: number; createdAt: string; seq: number }> = [];
    for (let start = 0; start < ids.length; start += GET_ITEMS_CHUNK) {
      const chunk = ids.slice(start, start + GET_ITEMS_CHUNK);
      rows.push(
        ...(this.db
          .prepare(
            `SELECT ia.asset_id AS assetId, i.id AS itemId, i.title AS title, (i.deleted_at IS NOT NULL) AS trashed, i.created_at AS createdAt, i.rowid AS seq
             FROM item_assets ia JOIN items i ON i.id = ia.item_id
             WHERE ia.role = 'original' AND ia.asset_id IN (${chunk.map(() => '?').join(', ')})`,
          )
          .all(...chunk) as typeof rows),
      );
    }
    rows.sort((a, b) => a.trashed - b.trashed || a.createdAt.localeCompare(b.createdAt) || a.seq - b.seq);
    return rows.map((r) => ({ assetId: r.assetId, itemId: r.itemId, title: r.title, trashed: r.trashed === 1 }));
  }

  assetsByMode(mode: StorageMode): AssetRow[] {
    return (this.db.prepare('SELECT * FROM assets WHERE storage_mode = ? ORDER BY created_at, rowid').all(mode) as AssetDbRow[]).map(toAsset);
  }

  itemIdsForAsset(assetId: string): string[] {
    const rows = this.db
      .prepare(`SELECT i.id FROM items i JOIN item_assets ia ON ia.item_id = i.id
                WHERE ia.asset_id = ? AND i.deleted_at IS NULL ORDER BY i.created_at, i.rowid`)
      .all(assetId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * item + (new asset + first revision) + item_asset + extract job (+ the collection membership), all-or-nothing.
   * Returns whether the item was filed into `rec.collectionId`: false when none was asked for, and also when the
   * collection is deleted or unknown by now (the import itself still succeeds).
   */
  insertImported(rec: NewImportRecord): boolean {
    if (rec.assetIsNew && !rec.revision) throw new Error('a new asset requires an initial revision');
    const a = rec.asset;
    return this.db.transaction(() => {
      if (rec.assetIsNew) {
        this.db
          .prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
                    VALUES (@id, @sha256, @storageMode, @relativePath, @externalPath, @originalName, @mime, @size, @availability, @createdAt, @checkedAt)`)
          .run(a);
      }
      this.db
        .prepare(`INSERT INTO items (id, type, title, metadata_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)`)
        .run(rec.item.id, rec.item.type, rec.item.title, rec.item.createdAt, rec.item.createdAt);
      this.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'original')`).run(rec.item.id, a.id);
      if (rec.revision) {
        this.db
          .prepare(`INSERT INTO source_revisions (id, asset_id, hash, parent_revision_id, renderer_version, created_at) VALUES (?, ?, ?, NULL, NULL, ?)`)
          .run(rec.revision.id, a.id, a.sha256, rec.revision.createdAt);
      }
      if (rec.job) {
        this.db
          .prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, attempts, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)
                    ON CONFLICT(dedupe_key) DO NOTHING`)
          .run(rec.job.id, rec.job.kind, rec.job.dedupeKey, JSON.stringify(rec.job.payload), rec.item.createdAt, rec.item.createdAt);
      }
      if (!rec.collectionId) return false;
      // Selecting from collections (not inserting the id blind) is what skips a collection deleted after the import began.
      return (
        this.db
          .prepare(`INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at)
                    SELECT c.id, ?, ? FROM collections c WHERE c.id = ? AND c.deleted_at IS NULL`)
          .run(rec.item.id, rec.item.createdAt, rec.collectionId).changes > 0
      );
    })();
  }

  /**
   * E2E seeding only (main's test hook under LEARN_E2E): items that share one existing asset and its revision, all in
   * one transaction. Imports never come here (insertImported). Each row's revision must belong to its asset, and its
   * metadata must be schema v1, as updateMetadata would store it.
   */
  insertItemsForAsset(
    rows: ReadonlyArray<{ id: string; type: ItemType; title: string; createdAt: string; metadataJson: string; assetId: string; revisionId: string }>,
  ): void {
    this.db.transaction(() => {
      const insertItem = this.db.prepare(`INSERT INTO items (id, type, title, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);
      const link = this.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'original')`);
      const revisionOf = this.db.prepare('SELECT 1 FROM source_revisions WHERE id = ? AND asset_id = ?');
      const checked = new Set<string>();
      for (const r of rows) {
        const pair = `${r.revisionId}/${r.assetId}`;
        if (!checked.has(pair)) {
          if (!revisionOf.get(r.revisionId, r.assetId)) throw new Error(`insertItemsForAsset: revision ${r.revisionId} is not a revision of asset ${r.assetId}`);
          checked.add(pair);
        }
        const meta = itemMetadataSchema.safeParse(JSON.parse(r.metadataJson));
        if (!meta.success) throw new Error('insertItemsForAsset: metadata is not schema v1');
        insertItem.run(r.id, r.type, r.title, JSON.stringify(meta.data), r.createdAt, r.createdAt);
        link.run(r.id, r.assetId);
      }
    })();
  }

  /** Non-trashed items, newest first. */
  listItems(): LibraryItem[] {
    const rows = this.db.prepare(`${ITEM_SELECT} ORDER BY i.created_at DESC, i.rowid DESC`).all() as ItemDbRow[];
    return rows.map((r) => toItem(r));
  }

  /**
   * The non-trashed items among `ids`, each once, in the order the ids first appear; unknown and trashed ids are
   * skipped. One transaction, 500 ids per statement.
   */
  getItems(ids: readonly string[]): LibraryItem[] {
    const unique = [...new Set(ids)];
    const found = new Map<string, LibraryItem>();
    this.db.transaction(() => {
      for (let start = 0; start < unique.length; start += GET_ITEMS_CHUNK) {
        const chunk = unique.slice(start, start + GET_ITEMS_CHUNK);
        // `+` keeps the planner on the ids: with the deleted_at index it scans every live item once per chunk (10,000 ids: 190 ms instead of 80).
        const rows = this.db.prepare(`${ITEM_FROM} WHERE +i.deleted_at IS NULL AND i.id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as ItemDbRow[];
        for (const r of rows) found.set(r.id, toItem(r));
      }
    })();
    return unique.flatMap((id) => {
      const item = found.get(id);
      return item ? [item] : [];
    });
  }

  /**
   * What a command's availability needs of each item (storage mode and availability) for the live ids, once each, in the
   * order asked. getItems without the metadata, revision and reading position: a context menu over every row of a large
   * library only needs these two facts per item.
   */
  targetFacts(ids: readonly string[]): Array<{ id: string; storageMode: StorageMode; availability: Availability }> {
    const unique = [...new Set(ids)];
    const found = new Map<string, { id: string; storageMode: StorageMode; availability: Availability }>();
    this.db.transaction(() => {
      for (let start = 0; start < unique.length; start += GET_ITEMS_CHUNK) {
        const chunk = unique.slice(start, start + GET_ITEMS_CHUNK);
        const rows = this.db
          .prepare(
            `SELECT i.id, a.storage_mode, a.availability FROM items i
             JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
             JOIN assets a ON a.id = ia.asset_id
             WHERE +i.deleted_at IS NULL AND i.id IN (${chunk.map(() => '?').join(',')})`,
          )
          .all(...chunk) as Array<{ id: string; storage_mode: StorageMode; availability: Availability }>;
        for (const r of rows) found.set(r.id, { id: r.id, storageMode: r.storage_mode, availability: r.availability });
      }
    })();
    return unique.flatMap((id) => {
      const f = found.get(id);
      return f ? [f] : [];
    });
  }

  /**
   * Quick search's long fields (spec 4.2): abstract and memo of the live items that have either. SQLite drops the rest
   * first; `json_valid` comes first in a CASE because json_extract throws on malformed JSON. The schema still decides
   * (a stored value that no longer parses reads as empty, as everywhere else). Each field is cut at SEARCH_TEXT_FIELD_MAX
   * characters: 10,000 items of 10,000-character abstracts would not fit the first query's time.
   */
  searchTexts(): SearchText[] {
    const rows = this.db
      .prepare(
        `SELECT id, metadata_json FROM items
         WHERE deleted_at IS NULL
           AND CASE WHEN json_valid(metadata_json)
                    THEN coalesce(json_extract(metadata_json, '$.abstract'), '') || coalesce(json_extract(metadata_json, '$.extra'), '')
                    ELSE '' END <> ''`,
      )
      .all() as Array<{ id: string; metadata_json: string }>;
    return rows.flatMap((r) => {
      const meta = parseItemMetadata(r.metadata_json);
      const abstract = meta.abstract ? clipSearchText(meta.abstract) : null;
      const extra = meta.extra ? clipSearchText(meta.extra) : null;
      return abstract || extra ? [{ id: r.id, abstract, extra }] : [];
    });
  }

  /** Non-trashed item, or undefined. */
  getItem(id: string): LibraryItem | undefined {
    const row = this.db.prepare(`${ITEM_SELECT} AND i.id = ?`).get(id) as ItemDbRow | undefined;
    return row && toItem(row);
  }

  /** Detail pane data for an item, also one in the trash (its panel is read-only: Task 6, Q-6b). */
  getItemDetail(id: string): ItemDetail {
    const row = this.db.prepare(`${ITEM_FROM} WHERE i.id = ?`).get(id) as ItemDbRow | undefined;
    if (!row) throw itemNotFound();
    const metadata = parseItemMetadata(row.metadata_json);
    return {
      item: toItem(row, metadata),
      metadata,
      file: {
        originalName: row.original_name, mime: row.mime, size: row.size, storageMode: row.storage_mode,
        externalPath: row.external_path, sha256: row.sha256, availability: row.availability,
      },
      tags: new TagsRepository(this.db).tagsOf(id),
      collections: new CollectionsRepository(this.db).membershipsOf(id),
    };
  }

  /**
   * Updates title (trimmed, 1–500) and/or metadata (schema v1) of a non-trashed item and bumps updated_at.
   * With neither field given nothing is written (updated_at stays); the item must still exist.
   */
  updateMetadata(id: string, update: MetadataUpdate): LibraryItem {
    if (update.title === undefined && update.metadata === undefined) {
      const item = this.getItem(id);
      if (!item) throw itemNotFound();
      return item;
    }
    let title: string | null = null;
    if (update.title !== undefined) {
      title = typeof update.title === 'string' ? update.title.trim() : '';
      if (title.length < 1 || title.length > 500) throw new LearnError('VALIDATION_FAILED', '제목은 1–500자여야 합니다.');
    }
    let metadataJson: string | null = null;
    if (update.metadata !== undefined) {
      const parsed = itemMetadataSchema.safeParse(update.metadata);
      if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '메타데이터가 올바르지 않습니다.');
      metadataJson = JSON.stringify(parsed.data);
    }
    const r = this.db
      .prepare(`UPDATE items SET title = COALESCE(?, title), metadata_json = COALESCE(?, metadata_json), updated_at = ?
                WHERE id = ? AND deleted_at IS NULL`)
      .run(title, metadataJson, nowIso(), id);
    if (r.changes === 0) throw itemNotFound();
    return this.getItem(id)!;
  }

  /** Moves items to the trash. Already-trashed and unknown ids are skipped; returns how many were trashed. */
  trash(itemIds: readonly string[]): number {
    return this.trashChanged(itemIds).length;
  }

  /** `trash`, returning the ids that were trashed (each once, in input order). */
  trashChanged(itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
      const stamp = nextDeletionStamp(this.db);
      return itemIds.filter((id) => stmt.run(stamp, id).changes > 0);
    })();
  }

  /** Restores trashed items. Live and unknown ids are skipped; returns how many were restored. */
  restore(itemIds: readonly string[]): number {
    return this.restoreChanged(itemIds).length;
  }

  /** `restore`, returning the ids that were restored (each once, in input order). */
  restoreChanged(itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
      return itemIds.filter((id) => stmt.run(id).changes > 0);
    })();
  }

  /** The trash view (spec 4.3): its collection rows and the trashed items, most recently trashed first, in one read. */
  trashView(): TrashView {
    return this.db.transaction((): TrashView => {
      const rows = this.db.prepare(`${TRASH_SELECT} ORDER BY i.deleted_at DESC, i.rowid DESC`).all() as ItemDbRow[];
      return { collections: trashedCollections(this.db), items: rows.map((r) => ({ ...toItem(r), deletedAt: r.deleted_at! })), ...trashPlaces(this.db) };
    })();
  }

  /** 영구 삭제 of trashed items and collection rows (live and unknown ids are skipped): trash.ts. The files are the caller's, after this returns. */
  purge(asked: { itemIds: readonly string[]; collectionIds: readonly string[] }): PurgeResult {
    return purgeTrash(this.db, asked);
  }

  /** 휴지통 비우기: trash.ts. */
  emptyTrash(): PurgeResult {
    return emptyTrash(this.db);
  }

  /** 하나만 남기고 휴지통으로 for the duplicate groups of these items (duplicates.ts). */
  keepOneOfDuplicates(itemIds: readonly string[]): KeepOneResult {
    return keepOneOf(this.db, itemIds);
  }

  /** 중복 N묶음 모두 정리: every duplicate group (duplicates.ts). */
  keepOneOfAllDuplicates(): KeepOneResult {
    return keepOneOf(this.db, null);
  }

  /** The undo of either; returns the items restored (duplicates.ts). */
  undoKeepOne(undo: KeepOneUndo): string[] {
    return undoKeepOne(this.db, undo);
  }

  /**
   * Whether an asset row holds this managed path now. Asked again right before a purged copy goes: an import may have
   * placed the same file since the purge committed. Imports write `assets/<xx>/<sha256>`, found through the sha index.
   */
  managedPathInUse(relativePath: string): boolean {
    const sha = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    const row = /^[0-9a-f]{64}$/.test(sha)
      ? this.db.prepare('SELECT 1 FROM assets WHERE sha256 = ? AND relative_path = ?').get(sha, relativePath)
      : this.db.prepare('SELECT 1 FROM assets WHERE relative_path = ?').get(relativePath);
    return row !== undefined;
  }

  /** Non-trashed items whose original files have identical content (same sha256, any storage mode), 2+ per group. */
  duplicateGroups(): DuplicateGroup[] {
    const rows = this.db
      .prepare(`WITH live AS (
                  SELECT a.sha256 AS sha256, ia.item_id AS id FROM item_assets ia
                  JOIN assets a ON a.id = ia.asset_id
                  WHERE ia.role = 'original' AND ia.item_id NOT IN (SELECT id FROM items WHERE deleted_at IS NOT NULL))
                SELECT live.sha256, live.id FROM live
                JOIN items i ON i.id = live.id
                WHERE live.sha256 IN (SELECT sha256 FROM live GROUP BY sha256 HAVING COUNT(DISTINCT id) >= 2)
                ORDER BY live.sha256, i.created_at, i.rowid`)
      .all() as { sha256: string; id: string }[];
    const groups: DuplicateGroup[] = [];
    for (const r of rows) {
      const last = groups.at(-1);
      if (last?.sha256 === r.sha256) last.itemIds.push(r.id);
      else groups.push({ sha256: r.sha256, itemIds: [r.id] });
    }
    return groups;
  }

  setAvailability(assetId: string, availability: Availability, checkedAt: string): void {
    const result = this.db.prepare('UPDATE assets SET availability = ?, checked_at = ? WHERE id = ?').run(availability, checkedAt, assetId);
    if (result.changes === 0) throw new Error(`setAvailability: no asset ${assetId}`);
  }

  setExternalPath(assetId: string, externalPath: string, checkedAt: string): void {
    const result = this.db
      .prepare(`UPDATE assets SET external_path = ?, availability = 'available', checked_at = ? WHERE id = ? AND storage_mode = 'linked'`)
      .run(externalPath, checkedAt, assetId);
    if (result.changes === 0) throw new Error(`setExternalPath: no linked asset ${assetId}`);
  }

  markRunningJobsInterrupted(now: string): number {
    return this.db.prepare(`UPDATE jobs SET state = 'interrupted', updated_at = ? WHERE state = 'running'`).run(now).changes;
  }

  counts(): LibraryCounts {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      items: n('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL'),
      assets: n('SELECT COUNT(*) AS n FROM assets'),
      revisions: n('SELECT COUNT(*) AS n FROM source_revisions'),
      collections: n('SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NULL'),
      collectionItems: n('SELECT COUNT(*) AS n FROM collection_items'),
      tags: n('SELECT COUNT(*) AS n FROM tags'),
      itemTags: n('SELECT COUNT(*) AS n FROM item_tags'),
      readingPositions: n('SELECT COUNT(*) AS n FROM reading_positions'),
      trashedItems: n('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NOT NULL'),
      trashedCollections: n('SELECT COUNT(*) AS n FROM collections WHERE deleted_at IS NOT NULL'),
    };
  }
}
