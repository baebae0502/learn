import { LIBRARY_SORT_COLUMNS, SETTINGS, type ItemType, type LibraryItem, type StorageMode } from '@learn/domain';

export type LibrarySortColumn = (typeof LIBRARY_SORT_COLUMNS)[number];
export type LibrarySort = { column: LibrarySortColumn; direction: 'asc' | 'desc' };

/** 추가일, newest first (spec §3.1). */
export const DEFAULT_SORT: LibrarySort = { column: 'createdAt', direction: 'desc' };

/** The recent view sorts by when the item was opened, newest first (spec 3.2). */
export const DEFAULT_SORT_RECENT: LibrarySort = { column: 'openedAt', direction: 'desc' };

/** library.sort (or library.sort.recent, with its own fallback) as stored, else the fallback. */
export function parseSort(raw: unknown, fallback: LibrarySort = DEFAULT_SORT): LibrarySort {
  const r = SETTINGS['library.sort'].safeParse(raw);
  return r.success ? r.data : fallback;
}

const NEWEST_FIRST: ReadonlySet<LibrarySortColumn> = new Set<LibrarySortColumn>(['createdAt', 'updatedAt', 'openedAt', 'size', 'progress']);
/** The direction a first press on a column sorts in (as Finder): dates and sizes newest or largest first. */
export const firstDirection = (column: LibrarySortColumn): 'asc' | 'desc' => (NEWEST_FIRST.has(column) ? 'desc' : 'asc');

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const TYPE_ORDER: Readonly<Record<ItemType, number>> = { pdf: 0, video: 1 };
const STORAGE_ORDER: Readonly<Record<StorageMode, number>> = { managed: 0, linked: 1 };
type SortKey = string | number | null;
const time = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const text = (s: string): string | null => (s === '' ? null : s);
const KEY: Readonly<Record<LibrarySortColumn, (i: LibraryItem) => SortKey>> = {
  title: (i) => text(i.title),
  creators: (i) => i.creators[0] ?? null,
  year: (i) => i.year,
  type: (i) => TYPE_ORDER[i.type],
  createdAt: (i) => time(i.createdAt),
  openedAt: (i) => time(i.openedAt),
  progress: (i) => i.progress,
  updatedAt: (i) => time(i.updatedAt),
  storageMode: (i) => STORAGE_ORDER[i.storageMode],
  size: (i) => i.size,
  originalName: (i) => text(i.originalName),
};

/**
 * The table's order (spec §3.1): text by the Korean collator (numbers in it by value), times, sizes and counts by value,
 * kinds and storage in a fixed order. Empty values go last in either direction; equal values by 추가일 newest first,
 * then in the list's own order (the repository's created_at DESC, rowid DESC: two files of one import can share a
 * millisecond). Returns a new array.
 */
export function sortItems(items: readonly LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const keyOf = KEY[sort.column];
  const dir = sort.direction === 'asc' ? 1 : -1;
  const rows = items.map((item, at) => ({ item, at, key: keyOf(item), added: time(item.createdAt) ?? 0 }));
  rows.sort((a, b) => {
    if (a.key === null || b.key === null) {
      if (a.key !== b.key) return a.key === null ? 1 : -1;
    } else {
      const c = typeof a.key === 'string' && typeof b.key === 'string' ? collator.compare(a.key, b.key) : Number(a.key) - Number(b.key);
      if (c !== 0) return c * dir;
    }
    if (a.added !== b.added) return b.added - a.added;
    return a.at - b.at;
  });
  return rows.map((r) => r.item);
}
