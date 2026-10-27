import { t } from '../strings';

// What an in-app drag carries (spec 8.1). A drop reads these and nothing else: the hook libraries add their own types too.
export const MIME_ITEMS = 'application/x-learn-items+json';
export const MIME_COLLECTION = 'application/x-learn-collection+json';
export const MIME_TAG = 'application/x-learn-tag+json';

/** The most ids one drag names: a drop reads a payload from outside the app, so it is bounded. */
export const DRAG_IDS_MAX = 100_000;

export const itemsDrag = (itemIds: readonly string[]): Record<string, string> => ({
  [MIME_ITEMS]: JSON.stringify({ itemIds }),
  'text/plain': t.organize.dnd.plain(itemIds.length),
});
export const collectionDrag = (c: { id: string; name: string }): Record<string, string> => ({
  [MIME_COLLECTION]: JSON.stringify({ collectionId: c.id }),
  'text/plain': c.name,
});
export const tagDrag = (tag: { id: string; name: string }): Record<string, string> => ({
  [MIME_TAG]: JSON.stringify({ tagId: tag.id }),
  'text/plain': tag.name,
});

function record(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const idOf = (text: string, key: string): string | null => {
  const id = record(text)?.[key];
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/** The item ids of a drag, first occurrence kept; null for anything that is not an items payload. */
export function parseItemsPayload(text: string): string[] | null {
  const ids = record(text)?.['itemIds'];
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > DRAG_IDS_MAX) return null;
  if (!ids.every((id) => typeof id === 'string' && id.length > 0)) return null;
  return [...new Set(ids as string[])];
}
export const parseCollectionPayload = (text: string): string | null => idOf(text, 'collectionId');
export const parseTagPayload = (text: string): string | null => idOf(text, 'tagId');
