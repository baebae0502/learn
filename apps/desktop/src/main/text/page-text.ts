import { MARK_END, MARK_START } from '@learn/domain';

/** The part of a pdf.js text item the worker reads. */
export interface TextItemLike {
  str?: string;
  hasEOL?: boolean;
}

// The snippet marks and the control characters other than whitespace are deleted, not turned into spaces: a mark inside a
// word must not split it, and deleting first leaves no double space behind.
const DROPPED = new RegExp(`[${MARK_START}${MARK_END}]|(?![\\t\\n\\v\\f\\r])\\p{Cc}`, 'gu');

/** One page's raw text as it is stored (spec 5.4). */
export function cleanPageText(raw: string): string {
  return raw
    .replace(DROPPED, '')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim()
    .normalize('NFC');
}

/** Main's own guard on what the worker sent: the snippet marks gone, cut at the limit without splitting a surrogate pair. */
export function guardStoredText(text: string, maxChars: number): string {
  const clean = text.replaceAll(MARK_START, '').replaceAll(MARK_END, '');
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
