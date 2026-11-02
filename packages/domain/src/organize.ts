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
 * go (`library:organize`). Trashed items are left out of every list and trashed collections out of everything but
 * `trashCount`. `members` and `tagged` have a key only for a collection or tag with at least one item.
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
  /** The rows the trash view shows (spec 4.3): the trashed items and the trashed collections that are rows of their own. */
  trashCount: number;
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
  /** 휴지통 (M6 spec 4.3): the trashed collection rows and items; shown only while the trash has something. */
  | { kind: 'trash' }
  | { kind: 'collection'; id: string };

/** library.view as stored. Strict: a value with keys this build does not know reads as unusable and the view opens at `all`. */
export const libraryScopeSchema: z.ZodType<LibraryScope> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all') }),
  z.strictObject({ kind: z.literal('recent') }),
  z.strictObject({ kind: z.literal('unfiled') }),
  z.strictObject({ kind: z.literal('duplicates') }),
  z.strictObject({ kind: z.literal('trash') }),
  z.strictObject({ kind: z.literal('collection'), id: z.uuid() }),
]);
