/** The tutor's key for an agent process and its answer: the item a tab shows, and its conversation (null for a new empty session). */
export interface SessionKey { itemId: string; conversationId: string | null }

/** The same item and the same conversation; a missing key is no key's. */
export const sameKey = (a: SessionKey | null | undefined, b: SessionKey | null | undefined): boolean =>
  a != null && b != null && a.itemId === b.itemId && a.conversationId === b.conversationId;

/** A copy that a later change to the original does not reach. */
export const copyKey = (k: SessionKey): SessionKey => ({ itemId: k.itemId, conversationId: k.conversationId });
