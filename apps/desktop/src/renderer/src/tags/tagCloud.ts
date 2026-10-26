import type { OrganizeTag } from '@learn/domain';
import { matchKorean } from '../palette/hangul';
import { nameCollator } from '../organize/tree';
import type { TagsSelector } from '../organize/viewSettings';

export interface CloudChip {
  tag: OrganizeTag;
  /** In the filter. */
  on: boolean;
  /** The view shown has no item with it (a chip that is on stays in the cloud whatever the view is, and is then hollow in accent). */
  dim: boolean;
}

export interface CloudInput {
  /** Every tag, as the model has them. */
  tags: readonly OrganizeTag[];
  /** Per tag, the number of items of the view (the scope, before the tag filter and the search) that have it. */
  counts: ReadonlyMap<string, number>;
  filter: ReadonlySet<string>;
  selector: TagsSelector;
  /** The "태그 필터" field. */
  query: string;
}

/** How many of the view's items each tag has: the common part of its items and the view's, counted from the smaller side. */
export function viewCounts(tags: readonly OrganizeTag[], tagItems: (tagId: string) => ReadonlySet<string>, scoped: ReadonlySet<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const tag of tags) {
    const items = tagItems(tag.id);
    const [small, big] = items.size <= scoped.size ? [items, scoped] : [scoped, items];
    let n = 0;
    for (const id of small) if (big.has(id)) n++;
    out.set(tag.id, n);
  }
  return out;
}

/**
 * The selector's chips (spec 4.3): the colour tags first by slot, the rest by name or by how many of the view's items they
 * have; the field narrows by name (NFC, case folded, 초성). 현재 보기의 태그만 leaves out a tag the view lacks, unless it is
 * in the filter (so it can be taken out); 모든 태그 keeps it, dim.
 */
export function cloudChips(input: CloudInput): CloudChip[] {
  const { tags, counts, filter, selector } = input;
  const query = input.query.trim();
  const inView = (tag: OrganizeTag) => (counts.get(tag.id) ?? 0) > 0;
  const shown = tags.filter((tag) => {
    if (selector.show === 'view' && !filter.has(tag.id) && !inView(tag)) return false;
    return query === '' || matchKorean(query, tag.name) !== null;
  });
  const coloured = shown.filter((tag) => tag.position !== null).sort((a, b) => a.position! - b.position!);
  const byName = (a: OrganizeTag, b: OrganizeTag) => nameCollator.compare(a.name, b.name);
  const byCount = (a: OrganizeTag, b: OrganizeTag) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || byName(a, b);
  const rest = shown.filter((tag) => tag.position === null).sort(selector.sort === 'count' ? byCount : byName);
  return [...coloured, ...rest].map((tag) => {
    const on = filter.has(tag.id);
    return { tag, on, dim: !inView(tag) };
  });
}
