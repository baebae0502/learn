import { describe, expect, it } from 'vitest';
import { checkCitations, citationCopyText, citeMarks, citeToken, citedPages, regroundPages, verifiedPages, type ReadSpan } from '../src/citations';

const TEXT = 'Attention [[p42]] and [[p1]][[p2]]; `[[p3]]` stays; [[p0]] and [[p1000000]] are not tokens; [[p999999]].\n```\n[[p4]]\n```\nAgain [[p42]].';

describe('citations', () => {
  it('finds the tokens outside code, in order, pages counted from 1', () => {
    expect(citeMarks(TEXT).map((m) => m.pageIndex)).toEqual([41, 0, 1, 999998, 41]);
    expect(citedPages(TEXT)).toEqual([41, 0, 1, 999998]);
    expect(citeToken(41)).toBe('[[p42]]');
  });
  it('verifies only what read_pdf_pages returned this turn — duplicates count, the attached page alone does not', () => {
    const reads: ReadSpan[] = [
      { tool: 'get_context', outcome: 'ok', pageFrom: 5, pageTo: 5 },
      { tool: 'read_pdf_pages', outcome: 'pending', pageFrom: 7, pageTo: 8 },
      { tool: 'read_pdf_pages', outcome: 'ok', pageFrom: 40, pageTo: 41 },
      { tool: 'read_pdf_pages', outcome: 'duplicate', pageFrom: 0, pageTo: 0 },
      { tool: 'read_pdf_pages', outcome: 'refused', pageFrom: null, pageTo: null },
      { tool: 'read_pdf_pages', outcome: 'failed', pageFrom: 1, pageTo: 1 },
    ];
    expect([...verifiedPages(reads)].sort((a, b) => a - b)).toEqual([0, 40, 41]);
    expect(verifiedPages(reads).has(5)).toBe(false);
    expect(verifiedPages(reads).has(7)).toBe(false);
    expect(checkCitations(TEXT, reads, 120)).toEqual({ verified: [41, 0], unverified: [{ pageIndex: 1, outside: false }, { pageIndex: 999998, outside: true }] });
    expect(regroundPages(checkCitations(TEXT, reads, 120))).toEqual([1]);
  });
  it('hides everything after an unclosed fence, and a stray backtick hides to the next one on its line', () => {
    expect(citedPages('a [[p1]]\n```\n[[p2]]')).toEqual([0]);
    expect(citedPages('don`t [[p3]] won`t [[p4]]')).toEqual([3]);
  });
  it('copies the answer with the labels in place of the tokens, code untouched', () => {
    const copied = citationCopyText('A [[p42]] B [[p9]] `[[p42]]`', new Set([41]), { page: (n) => `(${n}쪽)`, none: '(출처 없음)' });
    expect(copied).toBe('A (42쪽) B (출처 없음) `[[p42]]`');
  });
});
