import { LearnError, newId, nowIso, type Collection } from '@learn/domain';
import type { Db } from './connection';

interface CollectionDbRow {
  id: string; name: string; parent_id: string | null; created_at: string; updated_at: string | null; item_count: number;
}

/** Every collection column the `Collection` type needs; `item_count` ignores trashed items. Callers add WHERE/ORDER. */
export const COLLECTION_SELECT = `
SELECT c.id, c.name, c.parent_id, c.created_at, c.updated_at,
       (SELECT COUNT(*) FROM collection_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.collection_id = c.id AND i.deleted_at IS NULL) AS item_count
FROM collections c`;

export const toCollection = (r: CollectionDbRow): Collection => ({
  id: r.id, name: r.name, parentId: r.parent_id, itemCount: r.item_count, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** `@id` and every descendant of it (deleted or not). */
const SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT @id UNION SELECT c.id FROM collections c JOIN sub ON c.parent_id = sub.id)`;
/** Live descendants only (a deleted collection hides its subtree). */
const LIVE_SUBTREE = `WITH RECURSIVE sub(id) AS (
  SELECT @id UNION SELECT c.id FROM collections c JOIN sub ON c.parent_id = sub.id WHERE c.deleted_at IS NULL)`;
/**
 * `@parentId` and all of its ancestors. UNION (not UNION ALL) also terminates on a pre-existing cycle.
 * Moving `@id` under `@parentId` would create a cycle iff `@id` is in this set (this includes `@parentId = @id`).
 */
const WOULD_CYCLE = `WITH RECURSIVE anc(id) AS (
  SELECT @parentId UNION SELECT c.parent_id FROM collections c JOIN anc ON c.id = anc.id WHERE c.parent_id IS NOT NULL)
SELECT 1 FROM anc WHERE id = @id`;
/** Strict ancestors of `@id`. */
const ANCESTORS = `WITH RECURSIVE anc(id) AS (
  SELECT parent_id FROM collections WHERE id = @id AND parent_id IS NOT NULL
  UNION SELECT c.parent_id FROM collections c JOIN anc ON c.id = anc.id WHERE c.parent_id IS NOT NULL)`;

const notFound = () => new LearnError('NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
const parentNotFound = () => new LearnError('NOT_FOUND', '상위 컬렉션을 찾을 수 없습니다.');

/** NFC (macOS can hand over decomposed Hangul), then trimmed; the bound counts the normalized name. */
function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
  if (name.length < 1 || name.length > 200) throw new LearnError('VALIDATION_FAILED', '컬렉션 이름은 1–200자여야 합니다.');
  return name;
}

/** Collections tree (soft-deleted with `deleted_at`; membership in `collection_items`). Name sorting is the renderer's job. */
export class CollectionsRepository {
  constructor(private readonly db: Db) {}

  list(): Collection[] {
    return (this.db.prepare(`${COLLECTION_SELECT} WHERE c.deleted_at IS NULL ORDER BY c.created_at, c.rowid`).all() as CollectionDbRow[]).map(toCollection);
  }

  /** Live collection, or undefined (also for a soft-deleted one). */
  get(id: string): Collection | undefined {
    const row = this.db.prepare(`${COLLECTION_SELECT} WHERE c.id = ? AND c.deleted_at IS NULL`).get(id) as CollectionDbRow | undefined;
    return row && toCollection(row);
  }

  create(input: { name: string; parentId?: string | null }): Collection {
    const name = cleanName(input.name);
    const parentId = input.parentId ?? null;
    return this.db.transaction(() => {
      if (parentId !== null && !this.isLive(parentId)) throw parentNotFound();
      const id = newId();
      const now = nowIso();
      this.db.prepare('INSERT INTO collections (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, parentId, now, now);
      return this.get(id)!;
    })();
  }

  rename(id: string, rawName: string): Collection {
    const name = cleanName(rawName);
    const r = this.db.prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(name, nowIso(), id);
    if (r.changes === 0) throw notFound();
    return this.get(id)!;
  }

  /** Re-parents `id` (null = root). Refuses to move a collection into itself or any of its descendants. */
  move(id: string, parentId: string | null): Collection {
    return this.db.transaction(() => {
      if (!this.isLive(id)) throw notFound();
      if (parentId !== null) {
        if (parentId !== id && !this.isLive(parentId)) throw parentNotFound();
        if (this.db.prepare(WOULD_CYCLE).get({ parentId, id })) {
          throw new LearnError('VALIDATION_FAILED', '하위 컬렉션 안으로는 옮길 수 없습니다.');
        }
      }
      this.db.prepare('UPDATE collections SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId, nowIso(), id);
      return this.get(id)!;
    })();
  }

  /** Soft-deletes the collection and its whole subtree; items and memberships are untouched (updated_at too). */
  softDelete(id: string): void {
    this.db.transaction(() => {
      if (!this.isLive(id)) throw notFound();
      // Descendants deleted earlier keep their own deletion time.
      this.db.prepare(`${SUBTREE} UPDATE collections SET deleted_at = @now WHERE id IN (SELECT id FROM sub) AND deleted_at IS NULL`).run({ id, now: nowIso() });
    })();
  }

  /**
   * Restores a soft-deleted collection with the descendants that were deleted together with it (the same `deleted_at`:
   * one `softDelete` stamps its whole subtree with one time) and any deleted ancestors (so it has a live place in the
   * tree). A descendant deleted earlier, on its own, stays deleted. A live collection is returned unchanged.
   */
  restore(id: string): Collection {
    return this.restoreChanged(id).collection;
  }

  /** `restore`, also saying whether anything was restored (false for a collection that was already live). */
  restoreChanged(id: string): { collection: Collection; changed: boolean } {
    return this.db.transaction(() => {
      const root = this.db.prepare('SELECT deleted_at FROM collections WHERE id = ?').get(id) as { deleted_at: string | null } | undefined;
      if (!root) throw notFound();
      if (root.deleted_at === null) return { collection: this.get(id)!, changed: false };
      this.db.prepare(`${SUBTREE} UPDATE collections SET deleted_at = NULL WHERE id IN (SELECT id FROM sub) AND deleted_at = @deletedAt`).run({ id, deletedAt: root.deleted_at });
      this.db.prepare(`${ANCESTORS} UPDATE collections SET deleted_at = NULL WHERE id IN (SELECT id FROM anc) AND deleted_at IS NOT NULL`).run({ id });
      return { collection: this.get(id)!, changed: true };
    })();
  }

  /** Adds non-trashed items (duplicates and unknown ids are skipped). Returns how many memberships were created. */
  addItems(id: string, itemIds: readonly string[]): number {
    return this.addItemsChanged(id, itemIds).length;
  }

  /** `addItems`, returning the ids of the items that were added (each once, in input order). */
  addItemsChanged(id: string, itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      if (!this.isLive(id)) throw notFound();
      const ins = this.db.prepare(`INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at)
                                   SELECT ?, i.id, ? FROM items i WHERE i.id = ? AND i.deleted_at IS NULL`);
      const now = nowIso();
      return itemIds.filter((itemId) => ins.run(id, now, itemId).changes > 0);
    })();
  }

  /** Returns how many memberships were removed. */
  removeItems(id: string, itemIds: readonly string[]): number {
    return this.removeItemsChanged(id, itemIds).length;
  }

  /** `removeItems`, returning the ids of the items that were removed (each once, in input order). */
  removeItemsChanged(id: string, itemIds: readonly string[]): string[] {
    return this.db.transaction(() => {
      if (!this.isLive(id)) throw notFound();
      const del = this.db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?');
      return itemIds.filter((itemId) => del.run(id, itemId).changes > 0);
    })();
  }

  /** Non-trashed items in the collection (optionally also in its live subcollections), newest first, each once. */
  itemIds(id: string, opts: { includeSubcollections: boolean }): string[] {
    if (!this.isLive(id)) throw notFound();
    const scope = opts.includeSubcollections ? `${LIVE_SUBTREE} ` : 'WITH sub(id) AS (SELECT @id) ';
    const rows = this.db
      .prepare(`${scope}SELECT i.id FROM items i
                WHERE i.deleted_at IS NULL
                  AND EXISTS (SELECT 1 FROM collection_items ci WHERE ci.item_id = i.id AND ci.collection_id IN (SELECT id FROM sub))
                ORDER BY i.created_at DESC, i.rowid DESC`)
      .all({ id }) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** Live collections that directly contain the item. */
  membershipsOf(itemId: string): Collection[] {
    return (this.db
      .prepare(`${COLLECTION_SELECT}
                WHERE c.deleted_at IS NULL AND c.id IN (SELECT collection_id FROM collection_items WHERE item_id = ?)
                ORDER BY c.created_at, c.rowid`)
      .all(itemId) as CollectionDbRow[]).map(toCollection);
  }

  private isLive(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM collections WHERE id = ? AND deleted_at IS NULL').get(id) !== undefined;
  }
}
