import { SETTINGS, SIDEBAR_EXPANDED_MAX } from '@learn/domain';

export interface TagsSelector {
  show: 'view' | 'all';
  sort: 'name' | 'count';
}
export const DEFAULT_TAGS_SELECTOR: Readonly<TagsSelector> = Object.freeze({ show: 'view', sort: 'name' });

/** tags.selector as stored (spec 4.3), else the default. */
export function parseTagsSelector(raw: unknown): TagsSelector {
  const r = SETTINGS['tags.selector'].safeParse(raw);
  return r.success ? r.data : { ...DEFAULT_TAGS_SELECTOR };
}

/**
 * sidebar.expanded as stored (spec 10.4): each collection once, and only those `known` to exist. Anything the schema
 * does not read is an empty list — the tree starts closed.
 */
export function parseExpanded(raw: unknown, known: (collectionId: string) => boolean): string[] {
  const r = SETTINGS['sidebar.expanded'].safeParse(raw);
  if (!r.success) return [];
  return [...new Set(r.data)].filter(known).slice(0, SIDEBAR_EXPANDED_MAX);
}
