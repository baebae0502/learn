import type { LibraryScope } from '@learn/domain';
import type { CollectionNode, OrganizeModel } from '../organize/model';

/** The keys of the special views in the tree: a prefix no collection id (a uuid) has. */
export const SCOPE_KEYS = { all: 'scope:all', recent: 'scope:recent', unfiled: 'scope:unfiled', duplicates: 'scope:duplicates' } as const;
export type SpecialKind = keyof typeof SCOPE_KEYS;
/** The key of the row being created (it is not a collection yet). */
export const DRAFT_KEY = 'draft:new';

export const keyOfScope = (scope: LibraryScope): string => (scope.kind === 'collection' ? scope.id : SCOPE_KEYS[scope.kind]);

export function scopeOfKey(key: string): LibraryScope {
  const kind = (Object.keys(SCOPE_KEYS) as SpecialKind[]).find((k) => SCOPE_KEYS[k] === key);
  return kind ? ({ kind } as LibraryScope) : { kind: 'collection', id: key };
}

export interface SpecialRow {
  kind: SpecialKind;
  /** The number on the row, or null: 최근 연 자료 has none (the mockup), and an empty view says nothing. */
  count: number | null;
}

/**
 * The special views that are drawn (spec 3.2): 내 라이브러리 always, the others only with content — and the one being
 * looked at stays while it is, even after its last item has gone (it is left by choosing another view).
 */
export function visibleSpecials(input: { itemCount: number; hasRecent: boolean; model: OrganizeModel | undefined; current: LibraryScope['kind'] }): SpecialRow[] {
  const { model, current } = input;
  const unfiled = model?.unfiled.size ?? 0;
  const duplicates = model?.duplicates.size ?? 0;
  const rows: SpecialRow[] = [{ kind: 'all', count: input.itemCount > 0 ? input.itemCount : null }];
  if (input.hasRecent || current === 'recent') rows.push({ kind: 'recent', count: null });
  if ((model !== undefined && model.collectionCount > 0 && unfiled > 0) || current === 'unfiled') rows.push({ kind: 'unfiled', count: unfiled > 0 ? unfiled : null });
  if (duplicates > 0 || current === 'duplicates') rows.push({ kind: 'duplicates', count: duplicates > 0 ? duplicates : null });
  return rows;
}

/** The collections above `id`, root first (not `id` itself). */
export const ancestorIds = (model: OrganizeModel, id: string): string[] => model.path(id).slice(0, -1).map((n) => n.id);

/** Every collection below `id`. */
export function descendantIds(model: OrganizeModel, id: string): string[] {
  const out: string[] = [];
  const walk = (n: CollectionNode) => {
    for (const c of n.children) {
      out.push(c.id);
      walk(c);
    }
  };
  const node = model.node(id);
  if (node) walk(node);
  return out;
}

/**
 * The keys of the collection rows in the order they are drawn: the tree's order, only below open parents. A row being
 * created (`draftParent` is its parent, null for the top) goes first among its siblings; below a closed parent it is not
 * drawn, so it is not listed.
 */
export function visibleCollectionKeys(model: OrganizeModel, expanded: ReadonlySet<string>, draftParent?: string | null): string[] {
  const out: string[] = [];
  const walk = (nodes: readonly CollectionNode[], parent: string | null) => {
    if (draftParent !== undefined && draftParent === parent) out.push(DRAFT_KEY);
    for (const n of nodes) {
      out.push(n.id);
      if (expanded.has(n.id)) walk(n.children, n.id);
    }
  };
  walk(model.roots, null);
  return out;
}
