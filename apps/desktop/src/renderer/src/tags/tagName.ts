export const MAX_TAG_NAME = 200;

/** NFC and trimmed, as the database stores a tag name. */
export const cleanTagName = (raw: string): string => raw.normalize('NFC').trim();

const fold = (raw: string): string => cleanTagName(raw).toLowerCase();
/** The same name by the database's rule (case-insensitive, SQLite folds ASCII only) or a wider one: the sheet is asked at least when the database would merge. */
export const sameTagName = (a: string, b: string): boolean => fold(a) === fold(b);

/** Over the limit as the database counts it: UTF-16 units of the cleaned name. */
export const tooLongTagName = (raw: string): boolean => cleanTagName(raw).length > MAX_TAG_NAME;

export type TagNameVerdict = { kind: 'unchanged' } | { kind: 'tooLong' } | { kind: 'rename'; name: string };

/** What the name field held, against the tag's name: blank or the same keeps it, too long is refused, else a rename (a case change is one). */
export function tagNameVerdict(text: string, original: string): TagNameVerdict {
  const name = cleanTagName(text);
  if (name === '' || name === cleanTagName(original)) return { kind: 'unchanged' };
  if (name.length > MAX_TAG_NAME) return { kind: 'tooLong' };
  return { kind: 'rename', name };
}
