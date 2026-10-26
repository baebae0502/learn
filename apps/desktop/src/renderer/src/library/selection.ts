import type { LibraryItem } from '@learn/domain';
import { sortItems, type LibrarySort } from './sort';

/** The table selection as the command context reports it: flat numbers, so a report compares field by field. */
export interface SelectionCounts {
  count: number;
  /** Of those: the file is there (what Finder에서 보기 and 기본 앱으로 열기 need). */
  available: number;
  /** Of those: a linked file that went missing (what 다시 연결… needs). */
  relinkable: number;
}

const NONE: SelectionCounts = Object.freeze({ count: 0, available: 0, relinkable: 0 });

/** Counts only the selected rows still in the list: an id the list lost enables nothing. */
export function selectionCounts(items: readonly LibraryItem[], selected: ReadonlySet<string>): SelectionCounts {
  if (selected.size === 0) return NONE;
  let count = 0;
  let available = 0;
  let relinkable = 0;
  for (const i of items) {
    if (!selected.has(i.id)) continue;
    count += 1;
    if (i.availability === 'available') available += 1;
    else if (i.storageMode === 'linked') relinkable += 1;
  }
  return { count, available, relinkable };
}

/**
 * The selection in table order: the sort is a total order (ties by date added, then id), so the selected rows keep
 * the places they have among all rows. Menu and palette commands get their targets in this order.
 */
export function inTableOrder(items: readonly LibraryItem[], selected: ReadonlySet<string>, sort: LibrarySort): string[] {
  if (selected.size === 0) return [];
  return sortItems(items.filter((i) => selected.has(i.id)), sort).map((i) => i.id);
}
