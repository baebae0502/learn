import { TRASH_TARGET, type CommandTargetInfo, type OrganizeSnapshot, type TrashView, type TrashedCollection } from '@learn/domain';
import type { CommandTarget, TrashRows } from '../commands/registry';
import type { LibrarySort } from '../library/sort';
import { buildOrganizeModel, type OrganizeModel } from '../organize/model';
import { matchKorean, type Match } from '../palette/hangul';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};
const newestFirst = (a: TrashedCollection, b: TrashedCollection): number => time(b.deletedAt) - time(a.deletedAt);

/**
 * The trash view's collection rows as the table draws them (spec 4.3): always above the items, in the sort's own order when
 * it is the name (제목) or 삭제한 날짜, else most recently trashed first. A tag filter keeps none (a collection has no tags); a
 * query keeps the rows whose name has every word, read as the palette reads a collection's name (초성 too). A new array.
 */
export function trashCollectionRows(collections: readonly TrashedCollection[], opts: { sort: LibrarySort; query: string; tagFiltered: boolean }): TrashedCollection[] {
  if (opts.tagFiltered) return [];
  const words = opts.query.trim().split(/\s+/).filter((w) => w !== '');
  const kept = words.length === 0 ? [...collections] : collections.filter((c) => words.every((w) => matchKorean(w, c.name) !== null));
  const dir = opts.sort.direction === 'asc' ? 1 : -1;
  if (opts.sort.column === 'title') return kept.sort((a, b) => collator.compare(a.name, b.name) * dir || newestFirst(a, b));
  if (opts.sort.column === 'deletedAt') return kept.sort((a, b) => (time(a.deletedAt) - time(b.deletedAt)) * dir || collator.compare(a.name, b.name));
  return kept.sort(newestFirst);
}

/** The part of a collection row's name the quick search matched (the query read as one word), for the title's <mark>. */
export function collectionMatch(name: string, query: string): Match | null {
  const q = query.trim();
  return q === '' ? null : matchKorean(q, name);
}

/** One id index per trash view read (it is replaced, never changed). */
const indexes = new WeakMap<TrashView, { items: ReadonlySet<string>; collections: ReadonlySet<string> }>();
function idsOf(view: TrashView): { items: ReadonlySet<string>; collections: ReadonlySet<string> } {
  let found = indexes.get(view);
  if (!found) {
    found = { items: new Set(view.items.map((i) => i.id)), collections: new Set(view.collections.map((c) => c.id)) };
    indexes.set(view, found);
  }
  return found;
}

/** The selected rows the trash holds, items and collections apart, in the view's order (most recently trashed first). */
export function splitTrashSelection(view: TrashView | undefined, selected: ReadonlySet<string>): TrashRows {
  if (!view || selected.size === 0) return { itemIds: [], collectionIds: [] };
  return { itemIds: view.items.filter((i) => selected.has(i.id)).map((i) => i.id), collectionIds: view.collections.filter((c) => selected.has(c.id)).map((c) => c.id) };
}

/** How many selected rows the trash holds: the command context's selection count in the trash view. */
export function trashSelectionCount(view: TrashView | undefined, selected: ReadonlySet<string>): number {
  if (!view || selected.size === 0) return 0;
  const ids = idsOf(view);
  let n = 0;
  for (const id of selected) if (ids.items.has(id) || ids.collections.has(id)) n += 1;
  return n;
}

/**
 * Command targets with the trash view's rows among them (P-10): an id the trash holds is a trash row; the rest are judged
 * as anywhere else by `live` (live items from the list, sidebar collections, tags). No view: everything is `live`'s.
 */
export function withTrashTargets(view: TrashView | undefined, target: CommandTarget, live: (rest: CommandTarget) => CommandTargetInfo[]): CommandTargetInfo[] {
  if (!view) return live(target);
  const ids = idsOf(view);
  const itemIds = target.itemIds ?? [];
  const collectionIds = target.collectionIds ?? [];
  const rows = itemIds.filter((id) => ids.items.has(id)).length + collectionIds.filter((id) => ids.collections.has(id)).length;
  const rest: CommandTarget = { ...target, itemIds: itemIds.filter((id) => !ids.items.has(id)), collectionIds: collectionIds.filter((id) => !ids.collections.has(id)) };
  return [...live(rest), ...Array.from({ length: rows }, (): CommandTargetInfo => TRASH_TARGET)];
}

let last: { snapshot: OrganizeSnapshot; view: TrashView; model: OrganizeModel } | null = null;
/**
 * The organize model of the trash view (Q-6a): the live tree and tags, with the trashed items' places and tags — what the
 * read-only item panel, the table's colour dots and the tag selector and filter read there. One model per snapshot and read.
 */
export function trashModelFor(snapshot: OrganizeSnapshot, view: TrashView): OrganizeModel {
  if (last && last.snapshot === snapshot && last.view === view) return last.model;
  const model = buildOrganizeModel({ ...snapshot, members: view.members, tagged: view.tagged, duplicates: [] }, view.items);
  last = { snapshot, view, model };
  return model;
}
