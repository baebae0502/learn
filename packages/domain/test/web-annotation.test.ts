import { describe, expect, it } from 'vitest';
import { newId, pdfAnchor, toWebAnnotation, type PdfAnchor } from '../src/index';

const base = { kind: 'pdf', revisionId: newId(), pageIndex: 41, quads: [[1, 2, 3, 4, 5, 6, 7, 8]], coordinateSpace: 'pdf-user-space' } as const satisfies Record<string, unknown>;

describe('pdfAnchor', () => {
  it('requires text for a span but not for a region', () => {
    expect(pdfAnchor.safeParse({ ...base, precision: 'span' }).success).toBe(false);
    expect(pdfAnchor.safeParse({ ...base, precision: 'region' }).success).toBe(true);
    expect(pdfAnchor.safeParse({ ...base, precision: 'item' }).success).toBe(false);
  });
  it('rejects an empty position', () => {
    const text = { quote: { exact: 'x', prefix: '', suffix: '' }, position: { start: 3, end: 3 } };
    expect(pdfAnchor.safeParse({ ...base, precision: 'span', text }).success).toBe(false);
  });
});

describe('toWebAnnotation', () => {
  const anchor: PdfAnchor = {
    ...base, precision: 'span', quads: [[1, 2, 3, 4, 5, 6, 7, 8]],
    text: { quote: { exact: 'b', prefix: 'a😀', suffix: 'c' }, position: { start: 3, end: 4 } },
  };
  it('writes a page fragment, the quote, and a position in code points', () => {
    expect(toWebAnnotation(anchor, { source: 'file:///x.pdf', pageText: 'a😀bc' })).toEqual({
      source: 'file:///x.pdf',
      selector: [
        { type: 'FragmentSelector', conformsTo: 'http://tools.ietf.org/rfc/rfc3778', value: 'page=42' },
        { type: 'TextQuoteSelector', exact: 'b', prefix: 'a😀', suffix: 'c' },
        { type: 'TextPositionSelector', start: 2, end: 3 },
      ],
    });
  });
  it('leaves the position out without page text, and the quote out without text', () => {
    expect(toWebAnnotation(anchor, { source: 's' }).selector).toHaveLength(2);
    expect(toWebAnnotation({ ...base, quads: [[1, 2, 3, 4, 5, 6, 7, 8]], precision: 'region' }, { source: 's' }).selector).toHaveLength(1);
  });
});
