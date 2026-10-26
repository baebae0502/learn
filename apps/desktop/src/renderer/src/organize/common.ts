import type { OrganizeTag } from '@learn/domain';
import type { OrganizeModel } from './model';

/**
 * The tags every one of `ids` has (spec 6.2), in an item's own chip order. Reads the model only: with 10,000 selected it
 * is the first item's tags (a handful) times the selection, a set lookup each — never an IPC call (spec 12).
 */
export function commonTags(model: OrganizeModel, ids: readonly string[]): OrganizeTag[] {
  const first = ids[0];
  if (first === undefined) return [];
  return model.tagsOfItem(first).filter((tag) => {
    const holders = model.tagItems(tag.id);
    return holders.size >= ids.length && ids.every((id) => holders.has(id));
  });
}

/**
 * The collections every one of `ids` is directly in (spec 6.2), in tree order. The same set marks the collections the
 * 컬렉션에 추가 ▾ menu shows as already holding the selection. One pass over the items' own lists.
 */
export function commonCollections(model: OrganizeModel, ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const seen = new Map<string, number>();
  for (const id of unique) for (const collectionId of model.directCollectionsOf(id)) seen.set(collectionId, (seen.get(collectionId) ?? 0) + 1);
  return model.flat.filter((node) => seen.get(node.id) === unique.length).map((node) => node.id);
}
