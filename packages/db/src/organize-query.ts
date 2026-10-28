import type { OrganizeCollection, OrganizeSnapshot, OrganizeTag } from '@learn/domain';
import type { Db } from './connection';
import { LibraryRepository } from './library-repository';
import { TAG_ORDER, isTagColor } from './tags-repository';

interface CollectionRow { id: string; name: string; parent_id: string | null; created_at: string }
interface TagRow { id: string; name: string; color: string | null; position: number | null }

/*
 * The two pair queries exclude the few trashed rows with NOT IN over a small set rather than joining every pair to its
 * item and collection: a join lets SQLite start from the items and sort 30,000 pairs into stored order, which took
 * four times as long at 10,000 items. Foreign keys guarantee each pair's item and collection exist.
 */

/** Rows of (owner, item) in their stored order → owner → items; an owner with no row has no key. */
function groupItems(rows: ReadonlyArray<readonly [string, string]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [owner, item] of rows) (out[owner] ??= []).push(item);
  return out;
}

/**
 * The sidebar's data in one read: live collections, every tag, the direct memberships and the tag assignments of
 * non-trashed items, and the groups of non-trashed items that share a file. One transaction, so the five parts
 * describe the same moment even while main writes between two statements of a lazier version.
 */
export function readOrganizeSnapshot(db: Db): OrganizeSnapshot {
  return db.transaction((): OrganizeSnapshot => {
    const collections: OrganizeCollection[] = (
      db.prepare('SELECT id, name, parent_id, created_at FROM collections WHERE deleted_at IS NULL ORDER BY created_at, rowid').all() as CollectionRow[]
    ).map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, createdAt: r.created_at }));

    const tags: OrganizeTag[] = (db.prepare(`SELECT t.id, t.name, t.color, t.position FROM tags t ${TAG_ORDER}`).all() as TagRow[]).map((r) => ({
      id: r.id, name: r.name, color: isTagColor(r.color) ? r.color : null, position: r.position,
    }));

    const members = groupItems(
      db
        .prepare(`SELECT ci.collection_id, ci.item_id
                  FROM collection_items ci
                  WHERE ci.collection_id NOT IN (SELECT id FROM collections WHERE deleted_at IS NOT NULL)
                    AND ci.item_id NOT IN (SELECT id FROM items WHERE deleted_at IS NOT NULL)
                  ORDER BY ci.rowid`)
        .raw()
        .all() as Array<[string, string]>,
    );

    const tagged = groupItems(
      db
        .prepare(`SELECT it.tag_id, it.item_id
                  FROM item_tags it
                  WHERE it.item_id NOT IN (SELECT id FROM items WHERE deleted_at IS NOT NULL)
                  ORDER BY it.rowid`)
        .raw()
        .all() as Array<[string, string]>,
    );

    const duplicates = new LibraryRepository(db).duplicateGroups().map((g) => g.itemIds);
    return { collections, tags, members, tagged, duplicates };
  })();
}
