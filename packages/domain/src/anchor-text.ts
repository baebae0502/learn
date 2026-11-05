import type { TextQuote, TextSpan } from './anchors';

export interface PageTextItem { str: string; hasEOL: boolean }
/** `starts[i]` is the offset of item i inside `text`. */
export interface PageText { text: string; starts: number[] }

/** The page's text as one string, the way the text layer's items follow each other; a line end becomes a newline. */
export function buildPageText(items: readonly PageTextItem[]): PageText {
  let text = '';
  const starts: number[] = [];
  for (const item of items) {
    starts.push(text.length);
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return { text, starts };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const isLetter = (ch: string | undefined) => ch !== undefined && /\p{L}/u.test(ch);
const isSpace = (ch: string) => /\s/u.test(ch);

/**
 * The text as it is compared: NFC, soft hyphens gone, a hyphen at a line end joined with the next line, runs of
 * whitespace one space. `map[i]` is the original offset of `norm[i]`; `map[norm.length]` is the original length.
 */
export function matchText(s: string): { norm: string; map: number[] } {
  // NFC per grapheme so every composed character still knows where it began in the original (decomposed Hangul included).
  const chars: string[] = [];
  const offs: number[] = [];
  for (const { segment, index } of segmenter.segment(s)) {
    for (const ch of segment.normalize('NFC')) {
      if (ch === '­') continue;
      for (let k = 0; k < ch.length; k++) { chars.push(ch[k]!); offs.push(index); }
    }
  }
  let norm = '';
  const map: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '-' && chars[i + 1] === '\n' && isLetter(chars[i - 1]) && isLetter(chars[i + 2])) { i += 1; continue; }
    if (isSpace(ch)) {
      if (norm.endsWith(' ')) continue;
      norm += ' ';
    } else norm += ch;
    map.push(offs[i]!);
  }
  map.push(s.length);
  return { norm, map };
}

/** The original-text range of `exact`, tolerant of line breaks, hyphenation, soft hyphens and Unicode form; nearest to `hint` when it occurs more than once. */
export function findQuote(text: string, exact: string, hint = 0): TextSpan | null {
  const needle = matchText(exact).norm.trim();
  if (needle === '') return null;
  const { norm, map } = matchText(text);
  let best = -1;
  let bestDist = Infinity;
  for (let at = norm.indexOf(needle); at !== -1; at = norm.indexOf(needle, at + 1)) {
    const dist = Math.abs(map[at]! - hint);
    if (dist < bestDist) { best = at; bestDist = dist; }
  }
  if (best === -1) return null;
  // The next character's offset lies after any soft hyphen or line-end hyphen that was dropped; a match that stops before one does not take it along.
  const next = map[best + needle.length]!;
  const dropped = text.slice(map[best + needle.length - 1]!, next).match(/(?:\u00ad|-\n)+$/);
  return { start: map[best]!, end: next - (dropped?.[0].length ?? 0) };
}

/** The quote of a span with up to `context` characters on each side. */
export function quoteAround(text: string, span: TextSpan, context = 32): TextQuote {
  return {
    exact: text.slice(span.start, span.end),
    prefix: text.slice(Math.max(0, span.start - context), span.start),
    suffix: text.slice(span.end, span.end + context),
  };
}

/** A UTF-16 offset as a count of code points. */
export function codePointOffset(text: string, utf16: number): number {
  let n = 0;
  for (let i = 0; i < utf16 && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) i += 1;
    n += 1;
  }
  return n;
}
