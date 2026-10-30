import type { LibraryItem, OrganizeSnapshot, OrganizeTag } from '@learn/domain';
import { buildTree, nameCollator, type CollectionNode } from './tree';

export type { CollectionNode } from './tree';

export interface OrganizeModel {
  /** Top-level collections in name order (Korean, numbers by value); `children` likewise. */
  roots: CollectionNode[];
  /** Every collection in tree order. */
  flat: readonly CollectionNode[];
  collectionCount: number;
  node(id: string): CollectionNode | undefined;
  /** The collections from the top-level one down to `id` (empty for an unknown id). */
  path(id: string): CollectionNode[];
  /** `id` and its live descendants: the distinct items of them that the list has. */
  subtreeItems(id: string): ReadonlySet<string>;
  /** `subtreeItems(id).size`: what the sidebar shows beside the name. */
  count(id: string): number;
  /** The live collections that hold the item directly, in tree order. */
  directCollectionsOf(itemId: string): readonly string[];
  /** The item's tags: those with a position first, by position; then the rest by name. */
  tagsOfItem(itemId: string): readonly OrganizeTag[];
  tagItems(tagId: string): ReadonlySet<string>;
  /** Items in no live collection (every item when there is no collection). */
  unfiled: ReadonlySet<string>;
  /** Items of a duplicate group that still has two or more items in the list. */
  duplicates: ReadonlySet<string>;
  tags: readonly OrganizeTag[];
  tagByPosition(position: number): OrganizeTag | undefined;
}

const NO_IDS: readonly string[] = Object.freeze([]);
const NO_TAGS: readonly OrganizeTag[] = Object.freeze([]);
const NO_SET: ReadonlySet<string> = new Set();

const compareTags = (a: OrganizeTag, b: OrganizeTag): number => {
  if ((a.position === null) !== (b.position === null)) return a.position === null ? 1 : -1;
  if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
  return nameCollator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
};

/**
 * Everything the sidebar, the special views and the tag selector read, derived from the snapshot and the item list. Every
 * set counts only the items the list has: the snapshot and the list can arrive at different moments, and an item that
 * left must not be counted.
 */
export function buildOrganizeModel(snapshot: OrganizeSnapshot, items: readonly LibraryItem[]): OrganizeModel {
  const present = new Set<string>();
  for (const i of items) present.add(i.id);
  const { roots, byId, flat } = buildTree(snapshot.collections);

  const direct = new Map<string, string[]>();
  const inCollections = new Map<string, string[]>();
  const filed = new Set<string>();
  for (const node of flat) {
    const here = (snapshot.members[node.id] ?? []).filter((id) => present.has(id));
    direct.set(node.id, here);
    for (const id of here) {
      filed.add(id);
      const list = inCollections.get(id);
      if (list) list.push(node.id);
      else inCollections.set(id, [node.id]);
    }
  }
  const subtree = new Map<string, ReadonlySet<string>>();
  const subtreeOf = (node: CollectionNode): ReadonlySet<string> => {
    const known = subtree.get(node.id);
    if (known) return known;
    const set = new Set(direct.get(node.id));
    for (const child of node.children) for (const id of subtreeOf(child)) set.add(id);
    subtree.set(node.id, set);
    return set;
  };

  const tagSets = new Map<string, ReadonlySet<string>>();
  const perItem = new Map<string, OrganizeTag[]>();
  for (const tag of snapshot.tags) {
    const set = new Set<string>();
    for (const id of snapshot.tagged[tag.id] ?? []) if (present.has(id)) set.add(id);
    tagSets.set(tag.id, set);
    for (const id of set) {
      const list = perItem.get(id);
      if (list) list.push(tag);
      else perItem.set(id, [tag]);
    }
  }
  for (const list of perItem.values()) list.sort(compareTags);

  const duplicates = new Set<string>();
  for (const group of snapshot.duplicates) {
    const here = group.filter((id) => present.has(id));
    if (here.length >= 2) for (const id of here) duplicates.add(id);
  }
  const unfiled = new Set<string>();
  for (const i of items) if (!filed.has(i.id)) unfiled.add(i.id);
  const byPosition = new Map<number, OrganizeTag>();
  for (const tag of snapshot.tags) if (tag.position !== null && !byPosition.has(tag.position)) byPosition.set(tag.position, tag);

  return {
    roots,
    flat,
    collectionCount: flat.length,
    node: (id) => byId.get(id),
    path(id) {
      const out: CollectionNode[] = [];
      for (let n = byId.get(id); n; n = n.parentId === null ? undefined : byId.get(n.parentId)) out.unshift(n);
      return out;
    },
    subtreeItems: (id) => {
      const n = byId.get(id);
      return n ? subtreeOf(n) : NO_SET;
    },
    count: (id) => {
      const n = byId.get(id);
      return n ? subtreeOf(n).size : 0;
    },
    directCollectionsOf: (itemId) => inCollections.get(itemId) ?? NO_IDS,
    tagsOfItem: (itemId) => perItem.get(itemId) ?? NO_TAGS,
    tagItems: (tagId) => tagSets.get(tagId) ?? NO_SET,
    unfiled,
    duplicates,
    tags: snapshot.tags,
    tagByPosition: (position) => byPosition.get(position),
  };
}

let last: { snapshot: OrganizeSnapshot; ids: readonly string[]; model: OrganizeModel } | null = null;

/**
 * The model of this snapshot and list, shared by every caller (the toolbar, the table and the item panel each ask) and
 * kept while only values other than the ids change: a list patched after an `opened` or `metadata` notice is a new array
 * with the same ids, and the model reads nothing else from it.
 */
export function organizeModelFor(snapshot: OrganizeSnapshot, items: readonly LibraryItem[]): OrganizeModel {
  if (last && last.snapshot === snapshot && last.ids.length === items.length && last.ids.every((id, k) => id === items[k]!.id)) return last.model;
  const model = buildOrganizeModel(snapshot, items);
  last = { snapshot, ids: items.map((i) => i.id), model };
  return model;
}
