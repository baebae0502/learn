import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { currentOutlineId, filterOutline, outlinePages, outlineRows, type PdfOutlineNode } from './outline';

const node = (title: string, items: PdfOutlineNode[] = [], extra: Partial<PdfOutlineNode> = {}): PdfOutlineNode =>
  ({ title, bold: false, italic: false, color: new Uint8ClampedArray([0, 0, 0]), dest: null, url: null, unsafeUrl: undefined, newWindow: undefined, count: undefined, items, ...extra }) as PdfOutlineNode;

const TREE = [
  node('Chapter 1', [node('1.1 Intro'), node('1.2 Scope')], { dest: 'ch1' }),
  node('Chapter 3', [node('3.1 Setup'), node('3.2 Method', [node('3.2.1 Detail')]), node('3.3 Result')], { dest: [{ num: 9, gen: 0 }, { name: 'XYZ' }, 0, 700, null] }),
  node('Links', [], { url: 'https://example.org/x' }),
];

describe('outlineRows', () => {
  it('has no rows without an outline', () => {
    expect(outlineRows(null)).toEqual([]);
    expect(outlineRows([])).toEqual([]);
  });

  it('numbers a row by its path and keeps the depth, destination and link', () => {
    const rows = outlineRows(TREE);
    expect(rows.map((r) => r.id)).toEqual(['0', '1', '2']);
    expect(rows[1]!.children.map((r) => r.id)).toEqual(['1.0', '1.1', '1.2']);
    expect(rows[1]!.children[1]!.children[0]).toMatchObject({ id: '1.1.0', title: '3.2.1 Detail', depth: 2, children: [] });
    expect(rows[0]).toMatchObject({ depth: 0, dest: 'ch1', url: null });
    expect(rows[2]).toMatchObject({ dest: null, url: 'https://example.org/x' });
  });

  it('gives an untitled entry a dash instead of an empty row', () => {
    expect(outlineRows([node('  ')])[0]!.title).toBe('–');
  });
});

describe('filterOutline', () => {
  const rows = outlineRows(TREE);
  const titles = (rs: readonly { title: string; children: readonly unknown[] }[]): string[] => rs.map((r) => r.title);

  it('gives everything back for an empty query', () => {
    expect(filterOutline(rows, '')).toBe(rows);
    expect(filterOutline(rows, '   ')).toBe(rows);
  });

  it('keeps a hit with the ancestors that lead to it, and nothing else', () => {
    const found = filterOutline(rows, '3.2');
    expect(titles(found)).toEqual(['Chapter 3']);
    expect(titles(found[0]!.children)).toEqual(['3.2 Method']);
    expect(titles(found[0]!.children[0]!.children)).toEqual(['3.2.1 Detail']);
  });

  it('ignores case and compares in NFC', () => {
    expect(titles(filterOutline(rows, 'CHAPTER 3'))).toEqual(['Chapter 3']);
    const korean = outlineRows([node('메커니즘'.normalize('NFD'))]);
    expect(titles(filterOutline(korean, '메커니즘'.normalize('NFC')))).toEqual(['메커니즘'.normalize('NFD')]);
    expect(titles(filterOutline(outlineRows([node('메커니즘')]), '메커니즘'.normalize('NFD')))).toEqual(['메커니즘']);
  });

  it('finds nothing for a word that is not there', () => {
    expect(filterOutline(rows, 'zzz')).toEqual([]);
  });
});

describe('currentOutlineId', () => {
  const rows = outlineRows(TREE);
  const pages = new Map([['0', 1], ['0.0', 1], ['0.1', 4], ['1', 10], ['1.0', 10], ['1.1', 14], ['1.1.0', 15], ['1.2', 20]]);

  it('is the last entry, in reading order, that starts on or before the page', () => {
    expect(currentOutlineId(rows, pages, 1)).toBe('0.0');
    expect(currentOutlineId(rows, pages, 9)).toBe('0.1');
    expect(currentOutlineId(rows, pages, 15)).toBe('1.1.0');
    expect(currentOutlineId(rows, pages, 99)).toBe('1.2');
  });

  it('is none before the first entry and without resolved pages', () => {
    expect(currentOutlineId(rows, new Map([['0', 3]]), 2)).toBeNull();
    expect(currentOutlineId(rows, new Map(), 5)).toBeNull();
  });
});

describe('outlinePages', () => {
  const rows = outlineRows([
    node('Named', [], { dest: 'chapter' }),
    node('Explicit', [], { dest: [{ num: 7, gen: 0 }, { name: 'XYZ' }] }),
    node('Index', [], { dest: [4, { name: 'Fit' }] }),
    node('Link', [], { url: 'https://example.org' }),
    node('Broken', [], { dest: 'missing' }),
  ]);
  const doc = (over: Partial<Record<'getDestination' | 'getPageIndex', unknown>> = {}) =>
    ({
      getDestination: vi.fn(async (name: string) => (name === 'chapter' ? [{ num: 3, gen: 0 }, { name: 'Fit' }] : null)),
      getPageIndex: vi.fn(async (ref: { num: number }) => ref.num * 10),
      ...over,
    }) as unknown as PDFDocumentProxy;

  it('resolves named, explicit and page-index destinations to page numbers, and skips links and unknown names', async () => {
    const pages = await outlinePages(doc(), rows, () => false);
    expect([...pages]).toEqual([['0', 31], ['1', 71], ['2', 5]]);
  });
  it('leaves out an entry whose lookup fails, and says nothing when the document is going away', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = doc({ getPageIndex: vi.fn(async () => { throw new Error('Transport destroyed'); }) });
    expect([...(await outlinePages(failing, rows, () => true))]).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect([...(await outlinePages(failing, rows, () => false))]).toEqual([['2', 5]]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it('stops asking once cancelled', async () => {
    const d = doc();
    let calls = 0;
    await outlinePages(d, rows, () => ++calls > 1);
    expect(vi.mocked(d.getDestination)).toHaveBeenCalledTimes(1);
  });
});
