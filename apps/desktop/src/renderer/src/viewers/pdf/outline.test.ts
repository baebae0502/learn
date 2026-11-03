import { describe, expect, it } from 'vitest';
import { currentOutlineId, filterOutline, outlineRows, type PdfOutlineNode } from './outline';

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
