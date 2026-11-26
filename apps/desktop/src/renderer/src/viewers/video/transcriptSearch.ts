import type { Cue } from '@learn/domain';

/** A text folded for matching: what is searched, and for each unit of it the index in the original text where its letter begins. */
export interface Folded {
  folded: string;
  map: number[];
}

/** One cue's matches: the ranges ([start, end) in the cue's own text) the query was found at. */
export interface CueHit {
  index: number;
  ranges: Array<[number, number]>;
}

const isHangul = (c: number): boolean => (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xd7b0 && c <= 0xd7ff);
const MARK = /^\p{M}$/u;
const LATIN = /^\p{Script=Latin}/u;
const STRIP_MARKS = /\p{M}/gu;
const SPACE = /^\s$/;

/** A unit that goes with the one before it: a combining mark, or a vowel or final jamo after a lead jamo. */
function extends_(prev: number, unit: number): boolean {
  if (unit < 0x300) return false;
  // Composed syllables are the common case of Korean text: no mark can be one of them.
  if (unit >= 0xac00 && unit <= 0xd7a3) return false;
  if (unit >= 0x1160 && unit <= 0x11ff) return prev >= 0x1100 && prev <= 0x11ff;
  return MARK.test(String.fromCharCode(unit));
}

/** One letter with its marks, folded: Latin loses its accents and case, Hangul is composed, anything else is only lower-cased. */
function foldCluster(cluster: string): string {
  const first = cluster.codePointAt(0)!;
  if (isHangul(first)) return cluster.normalize('NFC');
  if (LATIN.test(cluster)) return cluster.normalize('NFD').toLowerCase().replace(STRIP_MARKS, '');
  return cluster.normalize('NFC').toLowerCase();
}

/** A unit that folds to itself and starts no mark sequence of its own: a composed syllable, or ASCII that is not a capital or a space. */
const plain = (c: number): boolean => (c >= 0xac00 && c <= 0xd7a3) || (c > 32 && c < 0x80 && (c < 65 || c > 90));

/** Text whose folding is its lower case and nothing else, unit for unit: printable ASCII and composed Hangul syllables (no break, no mark). */
const PLAIN_TEXT = /^[\u0020-\u007e\uac00-\ud7a3]*$/;

/**
 * Folds `text`. `identity` says every folded unit stands where its letter did (nothing was composed, taken off or turned into a space of
 * another length), so `map` is not needed; `wantMap` false skips building it (the cheap pass over cues that may not match at all).
 */
function fold(text: string, wantMap: boolean): Folded & { identity: boolean } {
  if (PLAIN_TEXT.test(text)) return { folded: text.toLowerCase(), map: [], identity: true };
  let folded = '';
  const map: number[] = [];
  let identity = true;
  const n = text.length;
  for (let i = 0; i < n; ) {
    // A run of letters that fold to themselves is taken whole; a mark after its last letter belongs to that letter's cluster instead.
    let j = i;
    while (j < n && plain(text.charCodeAt(j))) j++;
    if (j < n && j > i && extends_(text.charCodeAt(j - 1), text.charCodeAt(j))) j--;
    if (j > i) {
      folded += text.slice(i, j);
      if (wantMap) for (let k = i; k < j; k++) map.push(k);
      i = j;
      continue;
    }
    const c = text.charCodeAt(i);
    let end = i + 1;
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) end = i + 2;
    while (end < n && extends_(text.charCodeAt(end - 1), text.charCodeAt(end))) end++;
    const cluster = text.slice(i, end);
    const piece = cluster.length === 1 && SPACE.test(cluster) ? ' ' : c < 0x80 && end === i + 1 ? cluster.toLowerCase() : foldCluster(cluster);
    folded += piece;
    if (piece.length !== end - i) identity = false;
    if (wantMap) for (let k = 0; k < piece.length; k++) map.push(i);
    i = end;
  }
  return { folded, map, identity };
}

/**
 * The text as the search reads it (spec 7.4): NFC, Latin diacritics off, lower case, Hangul kept; every white space is one space, so a
 * phrase is found across a line break. `map[i]` is the index in `text` of the letter that folded unit `i` came from.
 */
export function foldForSearch(text: string): Folded {
  const f = fold(text, true);
  // The plain fast path builds no map: it is the identity.
  return f.identity && f.map.length === 0 ? { folded: f.folded, map: Array.from({ length: f.folded.length }, (_, i) => i) } : { folded: f.folded, map: f.map };
}

/** The end in the original text of the letter whose folded unit is `at`: where the next letter begins, or the text's end. */
function endOf(map: readonly number[], at: number, length: number): number {
  for (let j = at + 1; j < map.length; j++) if (map[j]! > map[at]!) return map[j]!;
  return length;
}

/**
 * The cues that have the query in them (case, accents and a line break between words do not matter; the query is trimmed), each with
 * the ranges of its own text. Nothing for a blank query. A match never overlaps the one before it.
 */
export function findInCues(cues: readonly Cue[], query: string): CueHit[] {
  const needle = fold(query.trim(), false).folded;
  if (needle === '') return [];
  const hits: CueHit[] = [];
  for (let index = 0; index < cues.length; index++) {
    const text = cues[index]!.text;
    // The cheap pass: most cues have no match, and the map is built only for those that do.
    const cheap = fold(text, false);
    const first = cheap.folded.indexOf(needle);
    if (first < 0) continue;
    const ranges: Array<[number, number]> = [];
    if (cheap.identity) {
      for (let at = first; at >= 0; at = cheap.folded.indexOf(needle, at + needle.length)) ranges.push([at, at + needle.length]);
    } else {
      const { folded, map } = fold(text, true);
      for (let at = first; at >= 0; at = folded.indexOf(needle, at + needle.length)) ranges.push([map[at]!, endOf(map, at + needle.length - 1, text.length)]);
    }
    hits.push({ index, ranges });
  }
  return hits;
}
