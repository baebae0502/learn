import { LearnError, nowIso, readingLocatorSchema, type ReadingLocator, type ReadingPosition } from '@learn/domain';
import type { Db } from './connection';

export interface SaveReadingPosition {
  itemId: string;
  revisionId: string;
  locator: ReadingLocator;
  progress: number | null;
}

interface ReadingDbRow {
  item_id: string; revision_id: string; locator_json: string; progress: number | null; opened_at: string | null; updated_at: string;
}

const toPosition = (r: ReadingDbRow): ReadingPosition | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(r.locator_json);
  } catch {
    raw = undefined;
  }
  const locator = readingLocatorSchema.safeParse(raw);
  if (!locator.success) {
    console.warn('READING_LOCATOR_INVALID');
    return undefined;
  }
  return { itemId: r.item_id, revisionId: r.revision_id, locator: locator.data, progress: r.progress, openedAt: r.opened_at, updatedAt: r.updated_at };
};

const itemMissing = () => new LearnError('NOT_FOUND', '항목을 찾을 수 없습니다.');

/** Where a never-read item starts (the same place the viewers open it without a saved position). */
function startLocator(type: string): ReadingLocator | null {
  if (type === 'pdf') return { kind: 'pdf', pageIndex: 0 };
  if (type === 'video') return { kind: 'video', timeMs: 0 };
  return null;
}

/** Per-item reading position (one row per item, `reading_positions`). */
export class ReadingRepository {
  constructor(private readonly db: Db) {}

  /** `undefined` when nothing was saved yet (or the stored locator is unreadable). */
  get(itemId: string): ReadingPosition | undefined {
    const row = this.db.prepare('SELECT * FROM reading_positions WHERE item_id = ?').get(itemId) as ReadingDbRow | undefined;
    return row && toPosition(row);
  }

  /** Upsert. `openedAt` comes from `markOpened` (or the first save if it is still empty); saves never change it. */
  save(input: SaveReadingPosition): ReadingPosition {
    const locator = readingLocatorSchema.safeParse(input.locator);
    if (!locator.success) throw new LearnError('VALIDATION_FAILED', '읽기 위치가 올바르지 않습니다.');
    const { progress } = input;
    if (progress !== null && !(Number.isFinite(progress) && progress >= 0 && progress <= 1)) {
      throw new LearnError('VALIDATION_FAILED', '진행률은 0에서 1 사이여야 합니다.');
    }
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM items WHERE id = ?').get(input.itemId)) throw itemMissing();
      const revisionOfItem = this.db
        .prepare(`SELECT 1 FROM source_revisions r JOIN item_assets ia ON ia.asset_id = r.asset_id WHERE ia.item_id = ? AND r.id = ?`)
        .get(input.itemId, input.revisionId);
      if (!revisionOfItem) throw new LearnError('NOT_FOUND', '이 항목의 원본 버전을 찾을 수 없습니다.');
      const now = nowIso();
      this.db
        .prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, opened_at, updated_at)
                  VALUES (@itemId, @revisionId, @locator, @progress, @now, @now)
                  ON CONFLICT(item_id) DO UPDATE SET
                    revision_id = excluded.revision_id, locator_json = excluded.locator_json, progress = excluded.progress,
                    opened_at = COALESCE(reading_positions.opened_at, excluded.opened_at), updated_at = excluded.updated_at`)
        .run({ itemId: input.itemId, revisionId: input.revisionId, locator: JSON.stringify(locator.data), progress, now });
      return this.get(input.itemId)!;
    })();
  }

  /**
   * Records that the item was opened now (`reader.open`). An item without a row gets one at its type's start
   * (`{kind:'pdf',pageIndex:0}` / `{kind:'video',timeMs:0}`), its latest revision and no progress; an existing
   * row only gets `opened_at`. Throws NOT_FOUND for an unknown item, VALIDATION_FAILED for a type without a locator.
   */
  markOpened(itemId: string): void {
    this.db.transaction(() => {
      const item = this.db.prepare('SELECT type FROM items WHERE id = ?').get(itemId) as { type: string } | undefined;
      if (!item) throw itemMissing();
      const now = nowIso();
      if (this.db.prepare('UPDATE reading_positions SET opened_at = ? WHERE item_id = ?').run(now, itemId).changes > 0) return;
      const locator = startLocator(item.type);
      if (!locator) throw new LearnError('VALIDATION_FAILED', '이 자료 종류는 읽기 위치를 지원하지 않습니다.');
      const revision = this.db
        .prepare(`SELECT r.id FROM source_revisions r JOIN item_assets ia ON ia.asset_id = r.asset_id AND ia.role = 'original'
                  WHERE ia.item_id = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`)
        .get(itemId) as { id: string } | undefined;
      if (!revision) throw new LearnError('NOT_FOUND', '이 항목의 원본 버전을 찾을 수 없습니다.');
      this.db
        .prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, opened_at, updated_at)
                  VALUES (?, ?, ?, NULL, ?, ?)`)
        .run(itemId, revision.id, JSON.stringify(locator), now, now);
    })();
  }
}
