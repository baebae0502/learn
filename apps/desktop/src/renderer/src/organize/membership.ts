import { api, unwrap } from '../api';
import { descendantIds } from '../sidebar/rows';
import type { OrganizeModel } from './model';
import { cachedSnapshot, patchSnapshot } from './snapshotCache';
import { withMembers, withoutMembers } from './snapshotPatch';

/**
 * What changes memberships, and the only place that does (the item panel, the menus, Task 8's drops): the call, the
 * snapshot patched at once, and what an undo needs. `collections:addItems` and `removeItems` answer the ids that really
 * changed, and those are what an undo puts back or takes out: an empty answer is nothing to undo.
 */
export interface Removal {
  collectionId: string;
  itemIds: string[];
}

/** The most ids one `collections:*Items` / `tags:*` call takes (the channel's schema, D/ipc.ts). */
export const IDS_PER_CALL = 5000;

export function inChunks<T>(xs: readonly T[], size: number = IDS_PER_CALL): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Files `itemIds` into the collection. Resolves to the ids that were new there, as main answers. */
export async function addItemsTo(collectionId: string, itemIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return [];
  const added: string[] = [];
  for (const chunk of inChunks(ids)) added.push(...(await unwrap(api().collections.addItems({ collectionId, itemIds: chunk }))));
  patchSnapshot((s) => withMembers(s, collectionId, ids));
  return added;
}

/**
 * Takes `itemIds` out of the collection and every live collection below it, wherever they are held directly (owner
 * decision: a parent shows its children's items, so taking an item out of the parent takes it out of the view). Resolves
 * to what to put back, collection by collection in tree order. A refusal stops at once: what was taken out before it
 * stays out, and the notice that follows refreshes the snapshot. `progress` is the list that fills as the calls go —
 * a caller that must undo a half-done removal (a move whose second half failed) keeps it and reads it after the throw.
 */
export async function removeFromScope(model: OrganizeModel, scopeCollectionId: string, itemIds: readonly string[], progress: Removal[] = []): Promise<Removal[]> {
  const scope = new Set([scopeCollectionId, ...descendantIds(model, scopeCollectionId)]);
  const held = new Map<string, string[]>();
  for (const id of new Set(itemIds)) {
    for (const collectionId of model.directCollectionsOf(id)) {
      if (!scope.has(collectionId)) continue;
      const list = held.get(collectionId);
      if (list) list.push(id);
      else held.set(collectionId, [id]);
    }
  }
  const order = new Map(model.flat.map((node, i) => [node.id, i]));
  for (const [collectionId, ids] of [...held].sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))) {
    const entry: Removal = { collectionId, itemIds: [] };
    for (const chunk of inChunks(ids)) {
      const removed = await unwrap(api().collections.removeItems({ collectionId, itemIds: chunk }));
      if (removed.length > 0) {
        if (entry.itemIds.length === 0) progress.push(entry);
        entry.itemIds.push(...removed);
      }
      patchSnapshot((s) => withoutMembers(s, collectionId, chunk));
    }
  }
  return progress;
}

/** Puts the removed memberships back. A collection deleted since has nothing to go back into. */
export async function undoRemovals(removals: readonly Removal[]): Promise<void> {
  for (const { collectionId, itemIds } of removals) {
    const snapshot = cachedSnapshot();
    // A collection deleted since was deleted on purpose: nothing the user still has is lost by leaving it out.
    if (snapshot && !snapshot.collections.some((c) => c.id === collectionId)) continue;
    for (const chunk of inChunks(itemIds)) await unwrap(api().collections.addItems({ collectionId, itemIds: chunk }));
    patchSnapshot((s) => withMembers(s, collectionId, itemIds));
  }
}

/** Takes back what `addItemsTo` added (the ids it returned). */
export async function undoAdds(collectionId: string, added: readonly string[]): Promise<void> {
  if (added.length === 0) return;
  for (const chunk of inChunks(added)) await unwrap(api().collections.removeItems({ collectionId, itemIds: chunk }));
  patchSnapshot((s) => withoutMembers(s, collectionId, added));
}
