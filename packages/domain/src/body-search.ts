export const PDF_TEXT_EXTRACTOR = 'pdf-text-1';
export const extractKey = (sha256: string): string => `extract:${sha256}:${PDF_TEXT_EXTRACTOR}`;

export const TEXT_LIMITS = {
  maxFileBytes: 512 * 1024 * 1024, maxPages: 5000, maxPageChars: 100_000, maxDocChars: 10_000_000,
  batchPages: 20, batchChars: 500_000, messageGapMs: 30_000, jobMs: 15 * 60_000, attempts: 3,
  emptyPerPage: 10, restartEvery: 50, idleMs: 30_000, startDelayMs: 5_000, likeChunk: 2000, pagesShown: 20,
} as const;

export type BodyTextFailure = 'locked' | 'damaged' | 'too-large' | 'gave-up';
export type BodyTextState =
  | { state: 'pending' }
  | { state: 'done'; pages: number; truncated: boolean }
  | { state: 'empty'; pages: number }
  | { state: 'failed'; reason: BodyTextFailure };

export interface ExtractPayload { sha256: string; type: 'pdf'; nextPage: number; pages: number | null; chars: number; truncated: boolean }

/** Private-use marks around a match in a snippet; the screen turns them into highlights. */
export const MARK_START = '';
export const MARK_END = '';

/** Body words: three or more code points go to the trigram index, exactly two to a scan. */
export interface BodyWords { fts: string[]; like: string[] }

const MAX_BODY_WORDS = 8;

export function bodyQueryWords(query: string): BodyWords {
  const words = [...new Set(query.normalize('NFC').split(/\s+/u).filter((w) => w !== ''))].slice(0, MAX_BODY_WORDS);
  const out: BodyWords = { fts: [], like: [] };
  for (const w of words) {
    const n = [...w].length;
    if (n >= 3) out.fts.push(w);
    else if (n === 2) out.like.push(w);
  }
  return out;
}

export const hasBodyWords = (w: BodyWords): boolean => w.fts.length + w.like.length > 0;

/** Each word is one quoted phrase (a quote inside is doubled), all of them required on the same page. */
export function ftsMatch(words: readonly string[]): string {
  return words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' AND ');
}

export function likePattern(word: string): string {
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const SNIPPET_BEFORE = 20;
const SNIPPET_AFTER = 28;
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** LIKE ignores case for ASCII letters only, so a word's ASCII letters match both cases and the rest match exactly. */
const asciiInsensitive = (word: string): string =>
  [...word].map((c) => (/[A-Za-z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : escapeRegExp(c))).join('');

/** Merged [start, end) ranges of every word's matches in `text`. */
function matchRanges(text: string, words: readonly string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const w of words) {
    for (const m of text.matchAll(new RegExp(asciiInsensitive(w), 'gu'))) ranges.push([m.index, m.index + m[0].length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);

export function likeSnippet(text: string, words: readonly string[]): string {
  const all = matchRanges(text, words);
  const first = all[0];
  if (!first) return text.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);
  let start = Math.max(0, first[0] - SNIPPET_BEFORE);
  let end = Math.min(text.length, first[1] + SNIPPET_AFTER);
  // Cuts fall between words, never inside the first match.
  if (start > 0) {
    while (start < first[0] && !isSpace(text[start - 1])) start++;
    while (start < first[0] && isSpace(text[start])) start++;
  }
  if (end < text.length) {
    while (end > first[1] && !isSpace(text[end])) end--;
    while (end > first[1] && isSpace(text[end - 1])) end--;
  }
  let out = '';
  let at = start;
  for (const [s, e] of all) {
    if (e <= start || s >= end) continue;
    const a = Math.max(s, start);
    const b = Math.min(e, end);
    out += text.slice(at, a) + MARK_START + text.slice(a, b) + MARK_END;
    at = b;
  }
  out += text.slice(at, end);
  return `${start > 0 ? '…' : ''}${out}${end < text.length ? '…' : ''}`;
}
