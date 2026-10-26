import type { OrganizeCollection } from '@learn/domain';

export interface CollectionNode {
  id: string;
  name: string;
  /** The live parent, or null for a top-level collection (also one whose parent is not live). */
  parentId: string | null;
  depth: number;
  createdAt: string;
  children: CollectionNode[];
}

export interface CollectionTree {
  roots: CollectionNode[];
  byId: ReadonlyMap<string, CollectionNode>;
  /** Every node in tree order (a parent, then its children in name order, depth first). */
  flat: CollectionNode[];
}

/** Korean collation with numbers by value (6장 < 7장 < 10장): the order of sibling collections and of tag names (spec 0, 4.3). */
export const nameCollator = new Intl.Collator('ko', { numeric: true });

const compare = (a: OrganizeCollection, b: OrganizeCollection): number =>
  nameCollator.compare(a.name, b.name) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The nested collections from the snapshot's flat list. The database keeps no order for siblings, so every level is in
 * name order; equal names fall back to creation time and id so the order never depends on how the rows arrived. A
 * collection whose parent is not in the list is shown at the top rather than lost; a cycle (which the database refuses
 * to make) cannot be reached from a top-level collection and is left out instead of looping.
 */
export function buildTree(collections: readonly OrganizeCollection[]): CollectionTree {
  const known = new Set(collections.map((c) => c.id));
  const kids = new Map<string | null, OrganizeCollection[]>();
  for (const c of collections) {
    const parent = c.parentId !== null && c.parentId !== c.id && known.has(c.parentId) ? c.parentId : null;
    const list = kids.get(parent);
    if (list) list.push(c);
    else kids.set(parent, [c]);
  }
  const byId = new Map<string, CollectionNode>();
  const flat: CollectionNode[] = [];
  const make = (c: OrganizeCollection, parentId: string | null, depth: number): CollectionNode => {
    const node: CollectionNode = { id: c.id, name: c.name, parentId, depth, createdAt: c.createdAt, children: [] };
    byId.set(c.id, node);
    flat.push(node);
    for (const child of (kids.get(c.id) ?? []).sort(compare)) node.children.push(make(child, c.id, depth + 1));
    return node;
  };
  const roots = (kids.get(null) ?? []).sort(compare).map((c) => make(c, null, 0));
  return { roots, byId, flat };
}
