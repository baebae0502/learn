import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OutlineRow, PdfOutlineNode } from './outline';
import { dropOutline, ensureOutline, outlineSnapshot } from './outlineCache';
import { createReaderStore } from './readerStore';

const row = (id: string, depth: number, title: string): OutlineRow => ({ id, title, depth, dest: null, url: null, children: [] });

describe('the outline a question carries (spec 5.1, P-13, J25)', () => {
  it('sends the first 300 entries in reading order, titles cut at 300, and whether their pages are all resolved', () => {
    const flat = Array.from({ length: 400 }, (_, i) => row(String(i), i % 10, i === 0 ? 'x'.repeat(400) : `e${i}`));
    const pages = new Map(flat.slice(0, 299).map((r, i) => [r.id, i + 1]));
    const snap = outlineSnapshot({ rows: flat, flat, pages, resolvedUpTo: 299 });
    expect(snap.outline).toHaveLength(300);
    expect(snap.outline[0]).toEqual({ title: 'x'.repeat(300), depth: 0, pageIndex: 0 });
    expect(snap.outline[9]!.depth).toBe(8);
    expect(snap.outline[299]!.pageIndex).toBeNull();
    expect(snap).toMatchObject({ outlineComplete: false, outlineTotal: 400 });
    expect(outlineSnapshot(null)).toEqual({ outline: [], outlineComplete: false, outlineTotal: 0 });
  });

  it('is complete once the first 300 entries are resolved, an entry without a page saying null', () => {
    const flat = Array.from({ length: 400 }, (_, i) => row(String(i), 0, `e${i}`));
    const pages = new Map(flat.slice(0, 300).filter((_, i) => i !== 5).map((r, i) => [r.id, i + 1]));
    const snap = outlineSnapshot({ rows: flat, flat, pages, resolvedUpTo: 300 });
    expect(snap).toMatchObject({ outlineComplete: true, outlineTotal: 400 });
    expect(snap.outline[5]!.pageIndex).toBeNull();
    expect(snap.outline[4]!.pageIndex).toBe(4);
  });

  it('says a document without an outline has a complete empty one', () => {
    expect(outlineSnapshot({ rows: [], flat: [], pages: new Map(), resolvedUpTo: 0 })).toEqual({ outline: [], outlineComplete: true, outlineTotal: 0 });
  });

  it('never cuts a title inside a surrogate pair', () => {
    const title = `${'a'.repeat(299)}😀`;
    expect(outlineSnapshot({ rows: [row('0', 0, title)], flat: [row('0', 0, title)], pages: new Map(), resolvedUpTo: 1 }).outline[0]!.title).toBe('a'.repeat(299));
  });
});

describe('ensureOutline: one cache of the outline per tab, its pages resolved once', () => {
  /** A document of `n` top-level entries, entry i going to page i + 1, counting the lookups. */
  const docOf = (n: number) => {
    const nodes = Array.from({ length: n }, (_, i) => ({ title: `E${i}`, dest: [i, { name: 'Fit' }], url: null, items: [] })) as unknown as PdfOutlineNode[];
    return { getOutline: vi.fn(async () => nodes), getDestination: vi.fn(async () => null), getPageIndex: vi.fn(async () => 0) } as unknown as PDFDocumentProxy & { getOutline: ReturnType<typeof vi.fn> };
  };
  const settle = async () => {
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it('resolves the first 300 for the tutor, then the rest when the outline pane asks for all, each entry once', async () => {
    const reader = createReaderStore();
    const doc = docOf(400);
    ensureOutline({ reader }, doc, 300);
    ensureOutline({ reader }, doc, 300);
    await settle();
    const first = reader.getState().outline!;
    expect(first.flat).toHaveLength(400);
    expect(first.resolvedUpTo).toBe(300);
    expect(first.pages.size).toBe(300);
    expect(first.pages.get('299')).toBe(300);
    expect(doc.getOutline).toHaveBeenCalledTimes(1);
    ensureOutline({ reader }, doc, 'all');
    await settle();
    const all = reader.getState().outline!;
    expect(all.resolvedUpTo).toBe(400);
    expect(all.pages.size).toBe(400);
    expect(all.pages.get('399')).toBe(400);
    expect(doc.getOutline).toHaveBeenCalledTimes(1);
    expect(outlineSnapshot(all)).toMatchObject({ outlineComplete: true, outlineTotal: 400 });
  });

  it('shows the entries at once and their pages a batch at a time', async () => {
    const reader = createReaderStore();
    const seen: number[] = [];
    reader.subscribe((s) => {
      if (s.outline && seen.at(-1) !== s.outline.resolvedUpTo) seen.push(s.outline.resolvedUpTo);
    });
    ensureOutline({ reader }, docOf(70), 'all');
    await settle();
    expect(seen).toEqual([0, 32, 64, 70]);
  });

  it('keeps nothing of a document that went away, and starts over for the next one', async () => {
    const reader = createReaderStore();
    const old = docOf(100);
    ensureOutline({ reader }, old, 300);
    dropOutline({ reader });
    await settle();
    expect(reader.getState().outline).toBeNull();
    const next = docOf(3);
    ensureOutline({ reader }, next, 300);
    await settle();
    expect(reader.getState().outline).toMatchObject({ resolvedUpTo: 3 });
    expect(reader.getState().outline!.flat.map((r) => r.title)).toEqual(['E0', 'E1', 'E2']);
  });

  it('takes an outline that fails to load as none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reader = createReaderStore();
    const doc = { getOutline: vi.fn(async () => Promise.reject(new Error('bad'))) } as unknown as PDFDocumentProxy;
    ensureOutline({ reader }, doc, 300);
    await settle();
    expect(outlineSnapshot(reader.getState().outline)).toEqual({ outline: [], outlineComplete: true, outlineTotal: 0 });
    expect(warn).toHaveBeenCalledWith('[pdf] outline failed: Error');
    warn.mockRestore();
  });
});
