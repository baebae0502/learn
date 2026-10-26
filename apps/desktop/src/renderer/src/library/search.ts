import type { LibraryItem, SearchText } from '@learn/domain';
import { CHOSEONG, MATCH_RANK, WORD_START, matchKorean, splitFinal, type Match, type MatchKind } from '../palette/hangul';
import { timed } from '../ui/perfMarks';

/**
 * Quick search over the library list (spec 4.2). Every query word must be in some field (AND). Fields compare NFC and
 * lower-cased, with whitespace runs as one space. The short fields (title, creators, publisher, original file name,
 * year) also have a 초성 string, so ㅅㅎ finds 신호; the long ones (abstract, memo) are matched literally.
 *
 * Built once per list (once more when the long texts arrive), the index keeps each kind of text as ONE string with a
 * separator between fields and items. A query word is then a few native indexOf scans of those strings, not a loop over
 * items and fields: at 10,000 items a few milliseconds, inside the 50 ms from a keystroke to the painted rows.
 *
 * A word reads as the palette's matchKorean reads a query (one rule for both): letters match themselves, a 초성
 * matches any syllable with that initial, and a last syllable that may still be composing also reads split (갖 → 가ㅈ).
 * The index applies that rule itself, on the spot its 초성 string points to: calling matchKorean for every candidate
 * costs a locale-aware lower-casing per call, tens of milliseconds per keystroke at this size.
 */

/** Between fields and after each item. No query word contains it: folding turns control characters into spaces. */
const SEP = '\u0001';
const S_BASE = 0xac00;
const S_END = 0xd7a4;
const N_COUNT = 588; // 21 vowels × 28 finals
const CHO_CODES = CHOSEONG.map((c) => c.charCodeAt(0));
const CHO = new Set<number>(CHO_CODES);
const SPACES = /[\s\u0000-\u001f\u007f]+/g;
/**
 * The same for a whole joined text, which keeps its SEPs: only what changes (runs of two or more, a whitespace other than
 * the space, a control) is matched — replacing every single space of a 1.5 M-character text took 150 ms, this 15.
 */
const FIELD_SPACES = /[\s\u0000\u0002-\u001f\u007f]{2,}|[^\S ]|[\u0000\u0002-\u001f\u007f]/g;
const SURROGATE = /[\uD800-\uDFFF]/;

/**
 * NFC, lower case, controls and whitespace runs as one space, trimmed (spec 4.2). toLowerCase gives what
 * toLocaleLowerCase('ko') gives for every character (Korean has no case tailoring) without a locale lookup per call.
 */
export function foldText(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(SPACES, ' ').trim();
}

/** A field's own SEP (never in practice) would split it: it becomes a space. */
const clean = (s: string): string => (s.includes(SEP) ? s.replaceAll(SEP, ' ') : s);
/** foldText over a whole joined text at once (a few ms for 10,000 items, against ~100 ms field by field); not trimmed per field. */
const foldJoined = (s: string): string => s.normalize('NFC').toLowerCase().replace(FIELD_SPACES, ' ');

/** Each UTF-16 unit's 초성 (a precomposed syllable's initial consonant), every other unit as it is: offsets carry over. */
function initialsOf(s: string): string {
  const out = new Uint16Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c >= S_BASE && c < S_END ? CHO_CODES[Math.floor((c - S_BASE) / N_COUNT)]! : c;
  }
  let text = '';
  for (let i = 0; i < out.length; i += 8192) text += String.fromCharCode(...out.subarray(i, i + 8192));
  return text;
}

/** One word of the query. */
export interface SearchTerm {
  /** The word folded like the fields: what the long fields must contain, literally. */
  text: string;
  /**
   * How the short fields may contain it: the word itself and, when its last syllable may still be composing, that
   * syllable split (갖 → 가ㅈ, on its way to 가져). In a reading a 초성 matches any syllable with that initial.
   */
  readings: string[];
}

/** The distinct words of a query (whitespace splits; an all-space query has none). */
export function parseQuery(query: string): SearchTerm[] {
  const words = foldText(query).split(' ').filter((w) => w !== '');
  return [...new Set(words)].map((text) => {
    const split = splitFinal(text.at(-1)!);
    return { text, readings: split ? [text, text.slice(0, -1) + split[0] + split[1]] : [text] };
  });
}

/** A reading prepared for the scans. */
interface Reading {
  text: string;
  /** Its 초성 form: where a match must sit in a 초성 string. */
  initials: string;
  /** No 초성 in it: a plain substring. */
  plain: boolean;
}
function readingOf(text: string): Reading {
  let plain = true;
  for (let i = 0; i < text.length && plain; i++) if (CHO.has(text.charCodeAt(i))) plain = false;
  return { text, initials: initialsOf(text), plain };
}

/** Whether `r` reads at offset p of `text` (its 초성 form `initials`): letters equal, each 초성 the syllable's initial. */
function readsAt(text: string, initials: string, p: number, r: Reading): boolean {
  if (!initials.startsWith(r.initials, p)) return false;
  for (let j = 0; j < r.text.length; j++) {
    const c = r.text.charCodeAt(j);
    if (!CHO.has(c) && text.charCodeAt(p + j) !== c) return false;
  }
  return true;
}

/** The first offset from `from` where `r` reads in `text`, or -1. */
function findReading(text: string, initials: string, r: Reading, from = 0): number {
  if (r.plain) return text.indexOf(r.text, from);
  for (let p = initials.indexOf(r.initials, from); p !== -1; p = initials.indexOf(r.initials, p + 1)) {
    if (readsAt(text, initials, p, r)) return p;
  }
  return -1;
}

/** Opaque outside this module (search() reads it). */
export interface SearchIndex {
  readonly items: readonly LibraryItem[];
  /** The short fields of every item: title first, SEP between fields and after each item. */
  readonly short: string;
  /** `short` with each syllable replaced by its 초성 (same offsets). */
  readonly initials: string;
  /** Where item k's text starts in `short`; [items.length] is the end. */
  readonly starts: Int32Array;
  /** Where item k's title ends in `short`. */
  readonly titleEnds: Int32Array;
  /** 1 when item k's folded title keeps the offsets of the title as shown (no collapsed space, no case change of length, no surrogate pair). */
  readonly plainTitle: Uint8Array;
  /** Abstract SEP memo SEP, for the items that have either. */
  readonly long: string;
  /** Where each long segment starts; the last entry is the end. */
  readonly longStarts: Int32Array;
  /** The item index of each long segment. */
  readonly longItems: Int32Array;
}
type ShortPart = Omit<SearchIndex, 'long' | 'longStarts' | 'longItems'>;
type LongPart = Pick<SearchIndex, 'long' | 'longStarts' | 'longItems'>;
const NO_LONG: LongPart = { long: '', longStarts: new Int32Array(1), longItems: new Int32Array(0) };

function shortPart(items: readonly LibraryItem[]): ShortPart {
  const n = items.length;
  const raw: string[] = [];
  for (const it of items) {
    raw.push(clean(it.title));
    for (const name of it.creators) raw.push(SEP, clean(name));
    raw.push(SEP, clean(it.publisher ?? ''), SEP, clean(it.originalName), SEP, it.year === null ? '' : String(it.year), SEP);
  }
  const short = foldJoined(raw.join(''));
  const starts = new Int32Array(n + 1);
  const titleEnds = new Int32Array(n);
  const plainTitle = new Uint8Array(n);
  let at = 0;
  for (let k = 0; k < n; k++) {
    const it = items[k]!;
    starts[k] = at;
    const titleEnd = short.indexOf(SEP, at);
    titleEnds[k] = titleEnd;
    let end = titleEnd;
    for (let f = 0; f < it.creators.length + 3; f++) end = short.indexOf(SEP, end + 1); // creators, publisher, file name, year
    at = end + 1;
    const nfc = it.title.normalize('NFC');
    plainTitle[k] = titleEnd - starts[k]! === nfc.length && !SURROGATE.test(nfc) ? 1 : 0;
  }
  starts[n] = at;
  return { items, short, initials: initialsOf(short), starts, titleEnds, plainTitle };
}

function longPart(items: readonly LibraryItem[], texts: readonly SearchText[] | undefined): LongPart {
  if (!texts || texts.length === 0) return NO_LONG;
  const at = new Map<string, number>();
  items.forEach((it, k) => at.set(it.id, k));
  const raw: string[] = [];
  const owners: number[] = [];
  for (const t of texts) {
    const k = at.get(t.id);
    if (k === undefined) continue; // trashed, or not in this list
    owners.push(k);
    raw.push(clean(t.abstract ?? ''), SEP, clean(t.extra ?? ''), SEP);
  }
  const long = foldJoined(raw.join(''));
  const longStarts = new Int32Array(owners.length + 1);
  let p = 0;
  for (let i = 0; i < owners.length; i++) {
    longStarts[i] = p;
    p = long.indexOf(SEP, long.indexOf(SEP, p) + 1) + 1; // past the abstract's SEP and the memo's
  }
  longStarts[owners.length] = p;
  return { long, longStarts, longItems: Int32Array.from(owners) };
}

const shortParts = new WeakMap<readonly LibraryItem[], ShortPart>();
/** The short part of this list array, built once: the long texts arriving later rebuild only their own part. */
function shortPartFor(items: readonly LibraryItem[]): ShortPart {
  let short = shortParts.get(items);
  if (!short) {
    short = shortPart(items);
    shortParts.set(items, short);
  }
  return short;
}

export function buildSearchIndex(items: readonly LibraryItem[], texts?: readonly SearchText[]): SearchIndex {
  return { ...shortPartFor(items), ...longPart(items, texts) };
}

const indexes = new WeakMap<readonly LibraryItem[], { texts: readonly SearchText[] | undefined; index: SearchIndex }>();
/**
 * The index of this list array and these long texts, built once and shared: the toolbar count and the table ask for it
 * in the same frame. A list read again is a new array, so a new index.
 */
export function searchIndexFor(items: readonly LibraryItem[], texts?: readonly SearchText[]): SearchIndex {
  const hit = indexes.get(items);
  if (hit && hit.texts === texts) return hit.index;
  const index = timed('search:index', () => buildSearchIndex(items, texts));
  indexes.set(items, { texts, index });
  return index;
}

/** The fields the short index holds: a change to any of them changes what a query can find. */
function sameSearchedFields(a: LibraryItem, b: LibraryItem): boolean {
  return (
    a.title === b.title && a.publisher === b.publisher && a.originalName === b.originalName && a.year === b.year &&
    a.creators.length === b.creators.length && a.creators.every((c, k) => c === b.creators[k])
  );
}

/**
 * A list patched in place (same length and ids; a few rows replaced) keeps the old list's index when none of the replaced
 * rows changed a searched field: opening an item, a re-checked file or a relink must not make the next keystroke pay for a
 * new index. The index reads `items` for titles and ids only, which are the same. Anything else is left to build a new one.
 */
export function carrySearchIndex(prev: readonly LibraryItem[], next: readonly LibraryItem[]): void {
  if (prev.length !== next.length) return;
  for (let k = 0; k < prev.length; k++) {
    const a = prev[k]!;
    const b = next[k]!;
    if (a !== b && (a.id !== b.id || !sameSearchedFields(a, b))) return;
  }
  const short = shortParts.get(prev);
  if (short) shortParts.set(next, short);
  const full = indexes.get(prev);
  if (full) indexes.set(next, full);
}

export interface SearchResult {
  /** The items every query word is in. */
  ids: ReadonlySet<string>;
  /** Where the title matched (for <mark>): the first query word found in it; absent when only other fields matched. */
  titleMatches: ReadonlyMap<string, Match>;
}

const lastResults = new WeakMap<SearchIndex, { query: string; result: SearchResult | null }>();
/** search(), answered from memory when this index was just asked the same query. */
export function searchCached(index: SearchIndex, query: string): SearchResult | null {
  const hit = lastResults.get(index);
  if (hit && hit.query === query) return hit.result;
  const result = timed('search', () => search(index, query));
  lastResults.set(index, { query, result });
  return result;
}

/** The segment holding offset `p`: the last k with starts[k] <= p. */
function segmentAt(starts: Int32Array, p: number): number {
  let lo = 0;
  let hi = starts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Marks every item whose short fields hold reading `r`: one scan, which skips the rest of an item once marked. */
function markShort(index: SearchIndex, r: Reading, marks: Uint8Array): void {
  const { short, initials, starts } = index;
  let p = findReading(short, initials, r);
  while (p !== -1) {
    const k = segmentAt(starts, p);
    marks[k] = 1;
    p = findReading(short, initials, r, starts[k + 1]!);
  }
}

/** Marks every item whose abstract or memo holds `text` literally. */
function markLong(index: SearchIndex, text: string, marks: Uint8Array): void {
  const { long, longStarts, longItems } = index;
  let p = long.indexOf(text);
  while (p !== -1) {
    const k = segmentAt(longStarts, p);
    marks[longItems[k]!] = 1;
    p = long.indexOf(text, longStarts[k + 1]!);
  }
}

interface Prepared {
  text: string;
  readings: Reading[];
}

function matchTerm(index: SearchIndex, t: Prepared): Uint8Array {
  const marks = new Uint8Array(index.items.length);
  for (const r of t.readings) markShort(index, r, marks);
  if (index.long.length > 0) markLong(index, t.text, marks);
  return marks;
}

/** The match kinds of a literal hit, ranked as the palette ranks them (exact, prefix, word start, substring). */
function literalKind(title: string, start: number, end: number): MatchKind {
  if (start === 0) return end === title.length ? 'exact' : 'prefix';
  return WORD_START.test(title[start - 1]!) ? 'word' : 'substring';
}

/** matchKorean on a folded title: each reading's first place, the best kind (the first reading on a tie). */
function readTitle(title: string, initials: string, t: Prepared): Match | null {
  let best: Match | null = null;
  for (const r of t.readings) {
    const start = findReading(title, initials, r);
    if (start === -1) continue;
    const end = start + r.text.length;
    const m: Match = { start, end, kind: title.startsWith(r.text, start) ? literalKind(title, start, end) : 'initials' };
    if (!best || MATCH_RANK[m.kind] < MATCH_RANK[best.kind]) best = m;
  }
  return best;
}

/** The first query word found in item k's title, in code points of the title as shown. */
function titleMatch(index: SearchIndex, k: number, terms: readonly Prepared[]): Match | null {
  if (index.plainTitle[k] !== 1) {
    // Folding moved its offsets: the palette's matchKorean reads the title as shown (rare: kept off the fast path).
    const title = index.items[k]!.title;
    for (const t of terms) {
      const m = matchKorean(t.text, title);
      if (m) return m;
    }
    return null;
  }
  const from = index.starts[k]!;
  const to = index.titleEnds[k]!;
  const title = index.short.slice(from, to);
  const initials = index.initials.slice(from, to);
  for (const t of terms) {
    const m = readTitle(title, initials, t);
    if (m) return m;
  }
  return null;
}

/** The items every word of `query` is in, and their title highlights; null for an empty query (no filtering). */
export function search(index: SearchIndex, query: string): SearchResult | null {
  const terms = parseQuery(query).map((t): Prepared => ({ text: t.text, readings: t.readings.map(readingOf) }));
  if (terms.length === 0) return null;
  const all = matchTerm(index, terms[0]!);
  for (const t of terms.slice(1)) {
    const marks = matchTerm(index, t);
    for (let k = 0; k < marks.length; k++) if (marks[k] === 0) all[k] = 0;
  }
  const ids = new Set<string>();
  const titleMatches = new Map<string, Match>();
  for (let k = 0; k < all.length; k++) {
    if (all[k] !== 1) continue;
    const id = index.items[k]!.id;
    ids.add(id);
    const m = titleMatch(index, k, terms);
    if (m) titleMatches.set(id, m);
  }
  return { ids, titleMatches };
}
