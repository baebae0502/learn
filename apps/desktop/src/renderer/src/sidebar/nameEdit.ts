import { t } from '../strings';

/** The longest name the database takes (collections-repository cleanName). */
export const NAME_MAX = 200;
/** What a new collection starts as, and what an empty name falls back to — Finder's new folder. */
export const NEW_COLLECTION_NAME = t.organize.sidebar.newName;

export type NameResult = { name: string } | { tooLong: true };

/**
 * A finished name (spec 3.4): normalized and trimmed the way the database does, so the count is the same; empty or blank
 * is `original` (no error); over the limit is refused.
 */
export function finishName(raw: string, original: string): NameResult {
  const name = raw.normalize('NFC').trim();
  if (name.length > NAME_MAX) return { tooLong: true };
  return { name: name === '' ? original : name };
}

/** Whether the name typed so far is over the limit (the field's note). */
export const tooLong = (raw: string): boolean => raw.normalize('NFC').trim().length > NAME_MAX;
