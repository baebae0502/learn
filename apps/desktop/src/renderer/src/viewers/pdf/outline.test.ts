import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { currentOutlineId, filterOutline, OUTLINE_BATCH, outlineScrollTarget, outlinePages, outlineRows, type PdfOutlineNode } from './outline';

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
    await outlinePages(d, rows, () => true);
    expect(vi.mocked(d.getDestination)).not.toHaveBeenCalled();
  });

  describe('in batches', () => {
    const many = outlineRows(Array.from({ length: 70 }, (_, i) => node(`E${i}`, [], { dest: [i, { name: 'Fit' }] })));

    it('resolves a batch at a time, in order, and reports the pages found so far after each', async () => {
      const seen: number[][] = [];
      const pages = await outlinePages(doc(), many, () => false, (so_far) => seen.push([...so_far.values()]));
      expect(OUTLINE_BATCH).toBe(32);
      expect(seen.map((s) => s.length)).toEqual([32, 64, 70]);
      expect([...pages.keys()]).toEqual(many.map((r) => r.id));
      expect([...pages.values()]).toEqual(many.map((_, i) => i + 1));
    });

    it('asks a whole batch at once, not one entry after another', async () => {
      let open = 0;
      let most = 0;
      const d = doc({
        getPageIndex: vi.fn(async () => {
          open++;
          most = Math.max(most, open);
          await Promise.resolve();
          open--;
          return 0;
        }),
      });
      await outlinePages(d, outlineRows(Array.from({ length: 40 }, (_, i) => node(`E${i}`, [], { dest: [{ num: i, gen: 0 }] }))), () => false);
      expect(most).toBe(32);
    });

    it('stops at the batch boundary when cancelled and reports nothing more', async () => {
      const d = doc();
      let stop = false;
      const batches: number[] = [];
      await outlinePages(d, many, () => stop, (so_far) => {
        batches.push(so_far.size);
        stop = true;
      });
      expect(batches).toEqual([32]);
    });
  });
});

describe('outlineScrollTarget', () => {
  const at = (index: number, scrollTop: number, viewport = 280) => outlineScrollTarget({ index, rowHeight: 28, scrollTop, viewport });
  it('a row above the window is brought to its top edge', () => {
    expect(at(2, 280)).toBe(56);
  });
  it('a row below the window is brought to the bottom edge', () => {
    // Row 30 spans 840–868: the window ends there when it starts at 588.
    expect(at(30, 0)).toBe(588);
  });
  it('a row in view needs no scroll, a row partly in view does', () => {
    expect(at(5, 0)).toBeNull();
    expect(at(9, 0)).toBeNull();
    expect(at(10, 0)).toBe(28);
    expect(at(3, 100)).toBe(84);
  });
  it('never goes below 0, whatever the window is', () => {
    expect(at(0, 0)).toBeNull();
    expect(at(1, 0, 10)).toBe(46);
    expect(at(0, 0, 10)).toBe(18);
    expect(outlineScrollTarget({ index: 0, rowHeight: 28, scrollTop: 14, viewport: 10 })).toBe(0);
  });
});
