import type { OrganizeCollection, OrganizeSnapshot, OrganizeTag } from '@learn/domain';
import type { Db } from './connection';
import { LibraryRepository } from './library-repository';
import { TAG_ORDER, isTagColor } from './tags-repository';

interface CollectionRow { id: string; name: string; parent_id: string | null; created_at: string }
interface TagRow { id: string; name: string; color: string | null; position: number | null }
interface PairRow { owner: string; item: string }

/** Rows of (owner, item) in their stored order → owner → items; an owner with no row has no key. */
function groupItems(rows: readonly PairRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.owner] ??= []).push(r.item);
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
        .prepare(`SELECT ci.collection_id AS owner, ci.item_id AS item
                  FROM collection_items ci
                  JOIN collections c ON c.id = ci.collection_id AND c.deleted_at IS NULL
                  JOIN items i ON i.id = ci.item_id AND i.deleted_at IS NULL
                  ORDER BY ci.rowid`)
        .all() as PairRow[],
    );

    const tagged = groupItems(
      db
        .prepare(`SELECT it.tag_id AS owner, it.item_id AS item
                  FROM item_tags it
                  JOIN items i ON i.id = it.item_id AND i.deleted_at IS NULL
                  ORDER BY it.rowid`)
        .all() as PairRow[],
    );

    const duplicates = new LibraryRepository(db).duplicateGroups().map((g) => g.itemIds);
    return { collections, tags, members, tagged, duplicates };
  })();
}
