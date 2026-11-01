import { nowIso, type KeepOneResult, type KeepOneUndo } from '@learn/domain';
import type { Db } from './connection';
import { nextDeletionStamp } from './deletion-stamp';

/** Each non-trashed item with its original file's sha256, groups of two or more, the one to keep first (created_at, then id). */
const GROUPED = `
WITH live AS (
  SELECT a.sha256 AS sha256, i.id AS id, i.created_at AS created_at FROM items i
  JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
  JOIN assets a ON a.id = ia.asset_id
  WHERE i.deleted_at IS NULL)
SELECT sha256, id FROM live
WHERE sha256 IN (SELECT sha256 FROM live GROUP BY sha256 HAVING COUNT(DISTINCT id) >= 2)
ORDER BY sha256, created_at, id`;

/**
 * 하나만 남기고 휴지통으로 (spec 5), one transaction: in each duplicate group — the groups of `itemIds`, or every group
 * when null — the item imported first stays; it gets every collection and tag the others have (one it has already stays
 * as it was), and the others go to the trash under one stamp. The undo names exactly what was added and trashed.
 */
export function keepOneOf(db: Db, itemIds: readonly string[] | null): KeepOneResult {
  return db.transaction((): KeepOneResult => {
    let wanted: Set<string> | null = null;
    if (itemIds !== null) {
      const shaOf = db.prepare(`SELECT a.sha256 FROM items i
                                JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
                                JOIN assets a ON a.id = ia.asset_id
                                WHERE i.id = ? AND i.deleted_at IS NULL`).pluck();
      wanted = new Set([...new Set(itemIds)].flatMap((id) => shaOf.all(id) as string[]));
    }
    const groups = new Map<string, string[]>();
    for (const [sha, id] of db.prepare(GROUPED).raw().all() as Array<[string, string]>) {
      if (wanted !== null && !wanted.has(sha)) continue;
      const group = groups.get(sha);
      if (group) group.push(id);
      else groups.set(sha, [id]);
    }
    const stamp = nextDeletionStamp(db);
    const now = nowIso();
    const collectionsOf = db.prepare('SELECT collection_id FROM collection_items WHERE item_id = ? ORDER BY rowid').pluck();
    const tagsOf = db.prepare('SELECT tag_id FROM item_tags WHERE item_id = ? ORDER BY rowid').pluck();
    const file = db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at) VALUES (?, ?, ?)');
    const tag = db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)');
    const toTrash = db.prepare('UPDATE items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL');
    const result: KeepOneResult = { kept: [], trashed: [], undo: { trashed: [], stamp, memberships: [], tags: [] } };
    for (const [keep, ...rest] of groups.values()) {
      result.kept.push(keep!);
      for (const other of rest) {
        for (const collectionId of collectionsOf.all(other) as string[]) {
          if (file.run(collectionId, keep, now).changes > 0) result.undo.memberships.push([collectionId, keep!]);
        }
        for (const tagId of tagsOf.all(other) as string[]) {
          if (tag.run(keep, tagId).changes > 0) result.undo.tags.push([tagId, keep!]);
        }
        if (toTrash.run(stamp, other).changes > 0) result.trashed.push(other);
      }
    }
    result.undo.trashed = [...result.trashed];
    return result;
  })();
}

/**
 * The undo of keepOneOf: the items still in the trash under its stamp come back (one restored or trashed again since is
 * left as it is), and the memberships and tags it added go. When none comes back (a second undo; every one restored,
 * trashed again or purged since) nothing changes: the kept item keeps what it was given rather than lose it with them.
 * Returns the items restored.
 */
export function undoKeepOne(db: Db, undo: KeepOneUndo): string[] {
  return db.transaction((): string[] => {
    const back = db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ? AND deleted_at = ?');
    const restored = undo.trashed.filter((id) => back.run(id, undo.stamp).changes > 0);
    if (restored.length === 0) return restored;
    const unfile = db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?');
    for (const [collectionId, itemId] of undo.memberships) unfile.run(collectionId, itemId);
    const untag = db.prepare('DELETE FROM item_tags WHERE tag_id = ? AND item_id = ?');
    for (const [tagId, itemId] of undo.tags) untag.run(tagId, itemId);
    return restored;
  })();
}
