import type { Availability, ItemType, LibraryItem, StorageMode } from '@learn/domain';
import type { Db } from './connection';

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
}

export interface LibraryCounts {
  items: number;
  assets: number;
  revisions: number;
  collections?: number;
  collectionItems?: number;
  tags?: number;
  itemTags?: number;
  readingPositions?: number;
}

interface AssetDbRow {
  id: string; sha256: string; storage_mode: StorageMode; relative_path: string | null; external_path: string | null;
  original_name: string; mime: string; size: number; availability: Availability; created_at: string; checked_at: string | null;
}
interface ItemDbRow {
  id: string; title: string; type: ItemType; created_at: string; updated_at: string; asset_id: string; mime: string; size: number;
  storage_mode: StorageMode; availability: Availability; original_name: string; revision_id: string;
}

const ITEM_SELECT = `
SELECT i.id, i.title, i.type, i.created_at, i.updated_at,
       a.id AS asset_id, a.mime, a.size, a.storage_mode, a.availability, a.original_name,
       (SELECT r.id FROM source_revisions r WHERE r.asset_id = a.id
         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS revision_id
FROM items i
JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
JOIN assets a ON a.id = ia.asset_id
WHERE i.deleted_at IS NULL`;

const toAsset = (r: AssetDbRow): AssetRow => ({
  id: r.id, sha256: r.sha256, storageMode: r.storage_mode, relativePath: r.relative_path, externalPath: r.external_path,
  originalName: r.original_name, mime: r.mime, size: r.size, availability: r.availability, createdAt: r.created_at, checkedAt: r.checked_at,
});

const toItem = (r: ItemDbRow): LibraryItem => ({
  id: r.id, title: r.title, type: r.type, mime: r.mime, size: r.size, storageMode: r.storage_mode,
  availability: r.availability, assetId: r.asset_id, revisionId: r.revision_id, originalName: r.original_name, createdAt: r.created_at,
  updatedAt: r.updated_at, creators: [], year: null, tagIds: [], progress: null, openedAt: null,
});

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

  /** item + (new asset + first revision) + item_asset + extract job, all-or-nothing. */
  insertImported(rec: NewImportRecord): void {
    if (rec.assetIsNew && !rec.revision) throw new Error('a new asset requires an initial revision');
    const a = rec.asset;
    this.db.transaction(() => {
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
    })();
  }

  listItems(): LibraryItem[] {
    return (this.db.prepare(`${ITEM_SELECT} ORDER BY i.created_at DESC, i.rowid DESC`).all() as ItemDbRow[]).map(toItem);
  }

  getItem(id: string): LibraryItem | undefined {
    const row = this.db.prepare(`${ITEM_SELECT} AND i.id = ?`).get(id) as ItemDbRow | undefined;
    return row && toItem(row);
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
