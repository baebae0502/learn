import type { LibraryItem } from '@learn/domain';
import type { OrganizeModel } from './model';

const NONE: readonly LibraryItem[] = Object.freeze([]);

/**
 * The items that have every one of the chosen tags (spec 4.3, AND). No tag chosen filters nothing and gives the list
 * back as it is. Tags are tested smallest set first, so a rare tag decides at once.
 */
export function filterByTags(model: OrganizeModel, items: readonly LibraryItem[], tagIds: ReadonlySet<string>): readonly LibraryItem[] {
  if (tagIds.size === 0) return items;
  const sets = [...tagIds].map((id) => model.tagItems(id)).sort((a, b) => a.size - b.size);
  if (sets[0]!.size === 0) return NONE;
  return items.filter((i) => sets.every((s) => s.has(i.id)));
}
