import { z } from 'zod';
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

/**
 * Which items the library table shows (spec 3.1). Held by the library view's store, not by the shell's `View`: coming back
 * from the reader must land on the same scope.
 */
export type LibraryScope =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'unfiled' }
  | { kind: 'duplicates' }
  | { kind: 'collection'; id: string };

/** library.view as stored. Strict: a value with keys this build does not know reads as unusable and the view opens at `all`. */
export const libraryScopeSchema: z.ZodType<LibraryScope> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('recent') }),
  z.strictObject({ kind: z.literal('unfiled') }),
  z.strictObject({ kind: z.literal('duplicates') }),
  z.strictObject({ kind: z.literal('collection'), id: z.uuid() }),
]);
