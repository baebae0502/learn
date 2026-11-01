import type { StorageMode, TrashedCollection } from '@learn/domain';
import type { Db } from './connection';

/** An asset whose row a purge removed because no item, live or trashed, uses it any more (ADR-0006). */
export interface PurgedAsset {
  id: string;
  storageMode: StorageMode;
  /** The managed copy to remove; null for a linked original (never removed) and for a path another asset row still holds. */
  relativePath: string | null;
  /** The size recorded for the asset: a named copy of another size may hold edits and is kept (openable.ts). */
  size: number;
}

export interface PurgeResult {
  /** The items removed, in the order asked. */
  itemIds: string[];
  /** Every collection removed: each row asked for, then the sub-collections that were part of it. */
  collectionIds: string[];
  assets: PurgedAsset[];
}

/**
 * The trashed collections that are rows of the trash view (spec 4.3): the parent is live, there is none, or it was
 * trashed at another time. A sub-collection trashed together with its parent (the same stamp) is part of the parent's row.
 */
const ROW_COLLECTIONS = `
SELECT c.id, c.name, c.parent_id, c.deleted_at FROM collections c
LEFT JOIN collections p ON p.id = c.parent_id
WHERE c.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at <> c.deleted_at)`;

interface TrashedRow { id: string; name: string; parent_id: string | null; deleted_at: string }

/** The trash view's row count, the sidebar's 휴지통 number: the trashed items and the collection rows. */
export function trashCount(db: Db): number {
  return (db.prepare(`SELECT (SELECT COUNT(*) FROM items WHERE deleted_at IS NOT NULL) + (SELECT COUNT(*) FROM (${ROW_COLLECTIONS})) AS n`).get() as { n: number }).n;
}

/** Trashed collections by parent: a row's members are found from here (only trashed ones can be part of a row). */
function trashedChildren(db: Db): Map<string, TrashedRow[]> {
  const children = new Map<string, TrashedRow[]>();
  for (const c of db.prepare('SELECT id, name, parent_id, deleted_at FROM collections WHERE deleted_at IS NOT NULL ORDER BY rowid').all() as TrashedRow[]) {
    if (c.parent_id === null) continue;
    const siblings = children.get(c.parent_id);
    if (siblings) siblings.push(c);
    else children.set(c.parent_id, [c]);
  }
  return children;
}

/** A row's collections: the row itself first, then below it every one trashed with it (reached through ones that were). */
function rowMembers(row: TrashedRow, children: ReadonlyMap<string, readonly TrashedRow[]>): string[] {
  const out = [row.id];
  const seen = new Set(out);
  for (let k = 0; k < out.length; k++) {
    for (const child of children.get(out[k]!) ?? []) {
      if (child.deleted_at !== row.deleted_at || seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child.id);
    }
  }
  return out;
}

/** The trash view's collection rows, most recently trashed first. */
export function trashedCollections(db: Db): TrashedCollection[] {
  const rows = db.prepare(`${ROW_COLLECTIONS} ORDER BY c.deleted_at DESC, c.rowid DESC`).all() as TrashedRow[];
  if (rows.length === 0) return [];
  const children = trashedChildren(db);
  const itemsOf = new Map<string, string[]>();
  for (const [collectionId, itemId] of db
    .prepare(`SELECT ci.collection_id, ci.item_id FROM collection_items ci
              WHERE ci.collection_id IN (SELECT id FROM collections WHERE deleted_at IS NOT NULL)
                AND ci.item_id NOT IN (SELECT id FROM items WHERE deleted_at IS NOT NULL)`)
    .raw()
    .all() as Array<[string, string]>) {
    const list = itemsOf.get(collectionId);
    if (list) list.push(itemId);
    else itemsOf.set(collectionId, [itemId]);
  }
  return rows.map((row) => {
    const members = rowMembers(row, children);
    const items = new Set(members.flatMap((id) => itemsOf.get(id) ?? []));
    return { id: row.id, name: row.name, parentId: row.parent_id, deletedAt: row.deleted_at, childCount: members.length - 1, itemCount: items.size };
  });
}

/**
 * Removes the asked collection rows (the trashed ones; live and unknown ids are skipped) with the sub-collections that
 * are part of them. Any other child of theirs — a collection trashed at another time, a row of its own — first moves to
 * the top level, so the cascade does not take it along.
 */
function removeCollectionRows(db: Db, ids: readonly string[]): string[] {
  const rowOf = db.prepare(`${ROW_COLLECTIONS} AND c.id = ?`);
  const children = trashedChildren(db);
  const removed: string[] = [];
  const roots: string[] = [];
  const doomed = new Set<string>();
  for (const id of new Set(ids)) {
    if (doomed.has(id)) continue;
    const row = rowOf.get(id) as TrashedRow | undefined;
    if (!row) continue;
    roots.push(row.id);
    for (const member of rowMembers(row, children)) {
      if (doomed.has(member)) continue;
      doomed.add(member);
      removed.push(member);
    }
  }
  if (roots.length === 0) return [];
  const kidsOf = db.prepare('SELECT id FROM collections WHERE parent_id = ?').pluck();
  const toTop = db.prepare('UPDATE collections SET parent_id = NULL WHERE id = ?');
  for (const id of removed) {
    for (const kid of kidsOf.all(id) as string[]) if (!doomed.has(kid)) toTop.run(kid);
  }
  const del = db.prepare('DELETE FROM collections WHERE id = ?'); // cascades its sub-collections and memberships
  for (const id of roots) del.run(id);
  return removed;
}

/** Removes the asked items that are in the trash (cascading their memberships, tags, position); the assets they used. */
function removeItems(db: Db, ids: readonly string[]): { itemIds: string[]; assetIds: Set<string> } {
  const assetsOf = db.prepare('SELECT asset_id FROM item_assets WHERE item_id = ?').pluck();
  const del = db.prepare('DELETE FROM items WHERE id = ? AND deleted_at IS NOT NULL');
  const itemIds: string[] = [];
  const assetIds = new Set<string>();
  for (const id of new Set(ids)) {
    const used = assetsOf.all(id) as string[];
    if (del.run(id).changes === 0) continue;
    itemIds.push(id);
    for (const assetId of used) assetIds.add(assetId);
  }
  return { itemIds, assetIds };
}

interface AssetFacts { id: string; sha256: string; storage_mode: StorageMode; relative_path: string | null; size: number }

/**
 * The assets among `assetIds` that no item uses any more, live or trashed: their notes (annotations, then anchors —
 * both hang off a revision), revisions and rows go, and with the last asset of a sha its jobs. A managed path that another
 * asset row still holds keeps its file (relativePath null).
 */
function removeUnusedAssets(db: Db, assetIds: ReadonlySet<string>): PurgedAsset[] {
  const inUse = db.prepare('SELECT 1 FROM item_assets WHERE asset_id = ? LIMIT 1');
  const factsOf = db.prepare('SELECT id, sha256, storage_mode, relative_path, size FROM assets WHERE id = ?');
  const delAnnotations = db.prepare(`DELETE FROM annotations WHERE anchor_id IN
                                       (SELECT a.id FROM anchors a JOIN source_revisions r ON r.id = a.revision_id WHERE r.asset_id = ?)`);
  const delAnchors = db.prepare('DELETE FROM anchors WHERE revision_id IN (SELECT id FROM source_revisions WHERE asset_id = ?)');
  const delRevisions = db.prepare('DELETE FROM source_revisions WHERE asset_id = ?');
  const delAsset = db.prepare('DELETE FROM assets WHERE id = ?');
  const gone: AssetFacts[] = [];
  for (const id of assetIds) {
    if (inUse.get(id)) continue;
    const facts = factsOf.get(id) as AssetFacts | undefined;
    if (!facts) continue;
    delAnnotations.run(id);
    delAnchors.run(id);
    delRevisions.run(id);
    delAsset.run(id);
    gone.push(facts);
  }
  if (gone.length === 0) return [];
  const shaLeft = db.prepare('SELECT 1 FROM assets WHERE sha256 = ? LIMIT 1');
  const shas = [...new Set(gone.map((a) => a.sha256))].filter((sha) => !shaLeft.get(sha));
  // A job's dedupe key is `<kind>:<sha256>:<version>` (importer.ts): one scan for every sha that left the library.
  if (shas.length > 0) db.prepare(`DELETE FROM jobs WHERE substr(dedupe_key, instr(dedupe_key, ':') + 1, 64) IN (SELECT value FROM json_each(?))`).run(JSON.stringify(shas));
  const paths = gone.flatMap((a) => (a.storage_mode === 'managed' && a.relative_path !== null ? [a.relative_path] : []));
  const held = new Set(
    paths.length === 0 ? [] : (db.prepare('SELECT relative_path FROM assets WHERE relative_path IN (SELECT value FROM json_each(?))').pluck().all(JSON.stringify(paths)) as string[]),
  );
  return gone.map((a) => ({
    id: a.id,
    storageMode: a.storage_mode,
    relativePath: a.storage_mode === 'managed' && a.relative_path !== null && !held.has(a.relative_path) ? a.relative_path : null,
    size: a.size,
  }));
}

/**
 * 영구 삭제 (spec 4.5), one transaction: the asked collection rows, the asked items, then the assets no item uses any
 * more. Only what is in the trash goes: live and unknown ids are skipped. The files go after the commit
 * (removePurgedFiles in @learn/library).
 */
export function purgeTrash(db: Db, asked: { itemIds: readonly string[]; collectionIds: readonly string[] }): PurgeResult {
  return db.transaction((): PurgeResult => {
    const collectionIds = removeCollectionRows(db, asked.collectionIds);
    const { itemIds, assetIds } = removeItems(db, asked.itemIds);
    return { itemIds, collectionIds, assets: removeUnusedAssets(db, assetIds) };
  })();
}

/** 휴지통 비우기: every row of the trash view, most recently trashed first, in one transaction. */
export function emptyTrash(db: Db): PurgeResult {
  return db.transaction((): PurgeResult => {
    const collectionIds = (db.prepare(`${ROW_COLLECTIONS} ORDER BY c.deleted_at DESC, c.rowid DESC`).all() as TrashedRow[]).map((r) => r.id);
    const itemIds = db.prepare('SELECT id FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid DESC').pluck().all() as string[];
    return purgeTrash(db, { itemIds, collectionIds });
  })();
}
