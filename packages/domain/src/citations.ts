import type { ToolOutcome } from './tutor';

export const CITE_RE = /\[\[p([1-9][0-9]{0,5})\]\]/g;
export const citeToken = (pageIndex: number): string => `[[p${pageIndex + 1}]]`;

export interface CiteMark { index: number; length: number; pageIndex: number }

/** [start, end) of each code region: ``` fences (from a line-start fence to the next fence) and `inline` spans. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fence = /^```/gm;
  let open: number | null = null;
  for (let m = fence.exec(text); m; m = fence.exec(text)) {
    if (open === null) open = m.index;
    else {
      ranges.push([open, m.index + 3]);
      open = null;
    }
  }
  if (open !== null) ranges.push([open, text.length]);
  const inFence = (i: number): boolean => ranges.some(([a, b]) => i >= a && i < b);
  const inline = /`[^`\n]+`/g;
  for (let m = inline.exec(text); m; m = inline.exec(text)) {
    if (inFence(m.index)) continue;
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** Cite tokens outside code, in text order. */
export function citeMarks(text: string): CiteMark[] {
  const code = codeRanges(text);
  const marks: CiteMark[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const at = m.index;
    if (code.some(([a, b]) => at >= a && at < b)) continue;
    marks.push({ index: at, length: m[0].length, pageIndex: Number(m[1]) - 1 });
  }
  return marks;
}

/** Each cited page once, in the order first cited. */
export function citedPages(text: string): number[] {
  return [...new Set(citeMarks(text).map((m) => m.pageIndex))];
}

export interface ReadSpan { tool: string; outcome: ToolOutcome; pageFrom: number | null; pageTo: number | null }

/** The pages read_pdf_pages returned in this turn: ok, limited and duplicate. */
export function verifiedPages(reads: readonly ReadSpan[]): Set<number> {
  const pages = new Set<number>();
  for (const r of reads) {
    if (r.tool !== 'read_pdf_pages') continue;
    if (r.outcome !== 'ok' && r.outcome !== 'limited' && r.outcome !== 'duplicate') continue;
    if (r.pageFrom === null || r.pageTo === null) continue;
    for (let p = r.pageFrom; p <= r.pageTo; p += 1) pages.add(p);
  }
  return pages;
}

export interface CitationCheck { verified: number[]; unverified: Array<{ pageIndex: number; outside: boolean }> }

export function checkCitations(text: string, reads: readonly ReadSpan[], pageCount: number): CitationCheck {
  const read = verifiedPages(reads);
  const check: CitationCheck = { verified: [], unverified: [] };
  for (const pageIndex of citedPages(text)) {
    const outside = pageIndex >= pageCount;
    if (!outside && read.has(pageIndex)) check.verified.push(pageIndex);
    else check.unverified.push({ pageIndex, outside });
  }
  return check;
}

/** The answer as copied: each token replaced by the caller's label for a verified page or its "no source" word. */
export function citationCopyText(text: string, verified: ReadonlySet<number>, label: { page(page1: number): string; none: string }): string {
  let out = '';
  let at = 0;
  for (const m of citeMarks(text)) {
    out += text.slice(at, m.index) + (verified.has(m.pageIndex) ? label.page(m.pageIndex + 1) : label.none);
    at = m.index + m.length;
  }
  return out + text.slice(at);
}

/** The pages a reground asks to read first: the unverified ones inside the document, in order. */
export function regroundPages(check: CitationCheck): number[] {
  return check.unverified.filter((u) => !u.outside).map((u) => u.pageIndex);
}
