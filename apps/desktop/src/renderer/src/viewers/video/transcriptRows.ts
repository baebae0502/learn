/** Where the keyboard cursor goes for a key of the list box (spec 7.2); null for a key that is not the list's or a list with no rows. */
export function cursorAfter(key: string, cursor: number, count: number, page: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = Math.min(Math.max(cursor, 0), last);
  switch (key) {
    case 'ArrowDown': return cursor < 0 ? 0 : Math.min(last, from + 1);
    case 'ArrowUp': return cursor < 0 ? 0 : Math.max(0, from - 1);
    case 'Home': return 0;
    case 'End': return last;
    case 'PageDown': return Math.min(last, from + page);
    case 'PageUp': return Math.max(0, from - page);
    default: return null;
  }
}

export interface Segment {
  text: string;
  match: boolean;
}

/** A cue's text cut at its match ranges (sorted, apart), so each piece is drawn as a text node and the matches as marks. */
export function segments(text: string, ranges: ReadonlyArray<readonly [number, number]> | undefined): Segment[] {
  if (!ranges || ranges.length === 0) return [{ text, match: false }];
  const out: Segment[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) out.push({ text: text.slice(at, from), match: false });
    out.push({ text: text.slice(from, to), match: true });
    at = to;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}
