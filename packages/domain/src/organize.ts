import type { TagColorId } from './tag-colors';

/** A live collection as the sidebar tree needs it. No count: the renderer counts from `members`. */
export interface OrganizeCollection {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface OrganizeTag {
  id: string;
  name: string;
  color: TagColorId | null;
  position: number | null;
}

/**
 * Everything the sidebar, the tag selector and the special views need that the item list does not carry, read in one
 * go (`library:organize`). Trashed items are left out of every list and trashed collections out of everything.
 * `members` and `tagged` have a key only for a collection or tag with at least one item.
 */
export interface OrganizeSnapshot {
  /** Live collections, in creation order (name order is the renderer's job). */
  collections: OrganizeCollection[];
  /** Every tag: colored ones first by position, then the rest in creation order. */
  tags: OrganizeTag[];
  /** Collection id → the non-trashed items directly in it (not its subcollections). */
  members: Record<string, string[]>;
  /** Tag id → the non-trashed items that have it. */
  tagged: Record<string, string[]>;
  /** Groups of non-trashed items whose original files share one sha256, two or more per group. */
  duplicates: string[][];
}
