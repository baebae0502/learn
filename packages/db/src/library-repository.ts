import {
  LearnError, clipSearchText, creatorNames, itemMetadataSchema, nowIso, parseItemMetadata, yearOf,
  type Availability, type DuplicateGroup, type ItemDetail, type ItemMetadata, type ItemType, type LibraryItem, type SearchText, type StorageMode,
} from '@learn/domain';
import type { Db } from './connection';
import { CollectionsRepository } from './collections-repository';
import { TagsRepository } from './tags-repository';

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
  sha256: string; external_path: string | null; revision_id: string; progress: number | null; opened_at: string | null;
}

/** Item + original asset + latest revision + reading position. Callers add the deleted_at filter (ITEM_SELECT / TRASH_SELECT). */
const ITEM_FROM = `
SELECT i.id, i.title, i.type, i.created_at, i.updated_at, i.metadata_json,
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
        const rows = this.db.prepare(`${ITEM_SELECT} AND i.id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as ItemDbRow[];
        for (const r of rows) found.set(r.id, toItem(r));
      }
    })();
    return unique.flatMap((id) => {
      const item = found.get(id);
      return item ? [item] : [];
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

  /** Detail pane data for a non-trashed item. */
  getItemDetail(id: string): ItemDetail {
    const row = this.db.prepare(`${ITEM_SELECT} AND i.id = ?`).get(id) as ItemDbRow | undefined;
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
      const now = nowIso();
      return itemIds.filter((id) => stmt.run(now, id).changes > 0);
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

  /** Trashed items, most recently deleted first. */
  listTrash(): LibraryItem[] {
    const rows = this.db.prepare(`${TRASH_SELECT} ORDER BY i.deleted_at DESC, i.rowid DESC`).all() as ItemDbRow[];
    return rows.map((r) => toItem(r));
  }

  /** Non-trashed items whose original files have identical content (same sha256, any storage mode), 2+ per group. */
  duplicateGroups(): DuplicateGroup[] {
    const rows = this.db
      .prepare(`WITH live AS (
                  SELECT i.id, i.created_at, i.rowid AS rid, a.sha256 FROM items i
                  JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
                  JOIN assets a ON a.id = ia.asset_id
                  WHERE i.deleted_at IS NULL)
                SELECT sha256, id FROM live
                WHERE sha256 IN (SELECT sha256 FROM live GROUP BY sha256 HAVING COUNT(DISTINCT id) >= 2)
                ORDER BY sha256, created_at, rid`)
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
    };
  }
}
