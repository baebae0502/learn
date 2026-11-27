import { LearnError, SUBTITLE_MIMES, type Cue, type RemovedTrack, type SubtitleTrack } from '@learn/domain';
import type { Db } from './connection';
import type { AssetRow } from './library-repository';
import { removeUnusedAssets, type PurgedAsset } from './trash';

export interface NewSubtitle {
  itemId: string;
  asset: AssetRow;
  assetIsNew: boolean;
  revision: { id: string; createdAt: string } | null;
  language: string | null;
  cues: readonly Cue[];
  createdAt: string;
}

const SUBTITLE_MIME_VALUES: readonly string[] = Object.values(SUBTITLE_MIMES);

interface TrackRow { asset_id: string; language: string | null; position: number; original_name: string; cue_count: number }
const toTrack = (r: TrackRow): SubtitleTrack => ({ assetId: r.asset_id, language: r.language, position: r.position, originalName: r.original_name, cueCount: r.cue_count });

const TRACK_SELECT = `SELECT t.asset_id, t.language, t.position, a.original_name,
                             (SELECT COUNT(*) FROM cue_texts c WHERE c.sha256 = a.sha256) AS cue_count
                      FROM subtitle_tracks t JOIN assets a ON a.id = t.asset_id`;

/** Subtitle tracks of videos: the link, the language and order, and the cue texts that search and the player read. */
export class SubtitlesRepository {
  constructor(private readonly db: Db) {}

  /** One transaction: asset (if new) → item_assets(role subtitle) → revision (if new) → subtitle_tracks(position = max + 1) → cue_texts. */
  attach(rec: NewSubtitle): SubtitleTrack | 'already' {
    if (!SUBTITLE_MIME_VALUES.includes(rec.asset.mime)) throw new LearnError('VALIDATION_FAILED', '자막 파일이 아닙니다.');
    if (rec.assetIsNew && !rec.revision) throw new Error('a new asset requires an initial revision');
    const a = rec.asset;
    return this.db.transaction((): SubtitleTrack | 'already' => {
      const live = this.db.prepare(`SELECT 1 FROM items WHERE id = ? AND type = 'video' AND deleted_at IS NULL`).get(rec.itemId);
      if (!live) throw new LearnError('NOT_FOUND', '동영상을 찾지 못했습니다.');
      if (this.isLinked(rec.itemId, a.sha256)) return 'already';
      if (rec.assetIsNew) {
        this.db
          .prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at, width, height)
                    VALUES (@id, @sha256, @storageMode, @relativePath, @externalPath, @originalName, @mime, @size, @availability, @createdAt, @checkedAt, @width, @height)`)
          .run({ ...a, width: a.width ?? null, height: a.height ?? null });
      }
      // A link with no track (one no v6 code writes) is already there: the track below makes it a subtitle again.
      this.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'subtitle') ON CONFLICT DO NOTHING`).run(rec.itemId, a.id);
      if (rec.revision) {
        this.db
          .prepare(`INSERT INTO source_revisions (id, asset_id, hash, parent_revision_id, renderer_version, created_at) VALUES (?, ?, ?, NULL, NULL, ?)`)
          .run(rec.revision.id, a.id, a.sha256, rec.revision.createdAt);
      }
      const position = (this.db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM subtitle_tracks WHERE item_id = ?').get(rec.itemId) as { p: number }).p;
      this.db
        .prepare(`INSERT INTO subtitle_tracks (item_id, asset_id, role, language, position, created_at) VALUES (?, ?, 'subtitle', ?, ?, ?)`)
        .run(rec.itemId, a.id, rec.language, position, rec.createdAt);
      const insertCue = this.db.prepare(
        `INSERT INTO cue_texts (sha256, cue_index, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?) ON CONFLICT(sha256, cue_index) DO NOTHING`,
      );
      // A sha with cues already (another video uses the same file) keeps its one set.
      if (!this.hasCues(a.sha256)) rec.cues.forEach((c, i) => insertCue.run(a.sha256, i, c.startMs, c.endMs, c.text));
      return this.trackOf(rec.itemId, a.id)!;
    })();
  }

  list(itemId: string): SubtitleTrack[] {
    const rows = this.db.prepare(`${TRACK_SELECT} WHERE t.item_id = ? ORDER BY t.position, t.created_at, t.rowid`).all(itemId) as TrackRow[];
    return rows.map(toTrack);
  }

  cues(itemId: string, assetId: string): Cue[] {
    const row = this.db
      .prepare(`SELECT a.sha256 FROM subtitle_tracks t JOIN assets a ON a.id = t.asset_id WHERE t.item_id = ? AND t.asset_id = ?`)
      .get(itemId, assetId) as { sha256: string } | undefined;
    if (!row) throw new LearnError('NOT_FOUND', '자막을 찾지 못했습니다.');
    const rows = this.db
      .prepare('SELECT start_ms, end_ms, text FROM cue_texts WHERE sha256 = ? ORDER BY cue_index')
      .all(row.sha256) as { start_ms: number; end_ms: number; text: string }[];
    return rows.map((r) => ({ startMs: r.start_ms, endMs: r.end_ms, text: r.text }));
  }

  /** Deletes the item_assets row; the track follows by the foreign key. The asset and cues stay until the sweep. */
  remove(itemId: string, assetId: string): RemovedTrack {
    return this.db.transaction((): RemovedTrack => {
      const t = this.db.prepare('SELECT position, language FROM subtitle_tracks WHERE item_id = ? AND asset_id = ?').get(itemId, assetId) as RemovedTrack | undefined;
      if (!t) throw new LearnError('NOT_FOUND', '자막을 찾지 못했습니다.');
      this.db.prepare(`DELETE FROM item_assets WHERE item_id = ? AND asset_id = ? AND role = 'subtitle'`).run(itemId, assetId);
      return { position: t.position, language: t.language };
    })();
  }

  restore(itemId: string, assetId: string, removed: RemovedTrack, now: string): SubtitleTrack {
    return this.db.transaction((): SubtitleTrack => {
      const existing = this.trackOf(itemId, assetId);
      if (existing) return existing;
      const asset = this.db.prepare('SELECT sha256 FROM assets WHERE id = ?').get(assetId) as { sha256: string } | undefined;
      const item = this.db.prepare(`SELECT 1 FROM items WHERE id = ? AND type = 'video'`).get(itemId);
      if (!asset || !item || !this.hasCues(asset.sha256)) throw new LearnError('NOT_FOUND', '되돌릴 자막이 없습니다.');
      this.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'subtitle')`).run(itemId, assetId);
      this.db
        .prepare(`INSERT INTO subtitle_tracks (item_id, asset_id, role, language, position, created_at) VALUES (?, ?, 'subtitle', ?, ?, ?)`)
        .run(itemId, assetId, removed.language, removed.position, now);
      return this.trackOf(itemId, assetId)!;
    })();
  }

  /** The video has this file as a track. A link with no track counts as none: nothing lists or removes it, so it must not refuse the file. */
  isLinked(itemId: string, sha256: string): boolean {
    return this.db.prepare(`SELECT 1 FROM subtitle_tracks t JOIN assets a ON a.id = t.asset_id WHERE t.item_id = ? AND a.sha256 = ? LIMIT 1`).get(itemId, sha256) !== undefined;
  }

  hasCues(sha256: string): boolean {
    return this.db.prepare('SELECT 1 FROM cue_texts WHERE sha256 = ? LIMIT 1').get(sha256) !== undefined;
  }

  /** Subtitle-MIME assets that no item links to: removed with their rows (and the cues of a sha's last asset), in one transaction. */
  sweepOrphans(): PurgedAsset[] {
    return this.db.transaction(() => {
      const ids = this.db
        .prepare(
          `SELECT a.id FROM assets a WHERE a.mime IN (SELECT value FROM json_each(?))
             AND NOT EXISTS (SELECT 1 FROM item_assets ia WHERE ia.asset_id = a.id)`,
        )
        .pluck()
        .all(JSON.stringify(SUBTITLE_MIME_VALUES)) as string[];
      return removeUnusedAssets(this.db, new Set(ids));
    })();
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM subtitle_tracks').get() as { n: number }).n;
  }

  cueTextCount(by: { itemId: string } | { sha256: string }): number {
    const row =
      'itemId' in by
        ? this.db
            .prepare(`SELECT COUNT(*) AS n FROM cue_texts WHERE sha256 IN (SELECT a.sha256 FROM subtitle_tracks t JOIN assets a ON a.id = t.asset_id WHERE t.item_id = ?)`)
            .get(by.itemId)
        : this.db.prepare('SELECT COUNT(*) AS n FROM cue_texts WHERE sha256 = ?').get(by.sha256);
    return (row as { n: number }).n;
  }

  private trackOf(itemId: string, assetId: string): SubtitleTrack | undefined {
    const r = this.db.prepare(`${TRACK_SELECT} WHERE t.item_id = ? AND t.asset_id = ?`).get(itemId, assetId) as TrackRow | undefined;
    return r && toTrack(r);
  }
}
