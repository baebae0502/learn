import { describe, expect, it } from 'vitest';
import { POSITION_NOTICE_MS, readingLocatorSchema } from '../src/reading';

describe('the reading locator', () => {
  it('still reads a value that carries the page only (saved before zoom and rotation were kept)', () => {
    expect(readingLocatorSchema.parse({ kind: 'pdf', pageIndex: 36 })).toEqual({ kind: 'pdf', pageIndex: 36 });
  });
  it('reads the place in the page, the zoom and the rotation', () => {
    const v = { kind: 'pdf', pageIndex: 36, top: 120.5, left: 0, zoom: 1.5, rotation: 90 } as const;
    expect(readingLocatorSchema.parse(v)).toEqual(v);
    for (const zoom of ['auto', 'page-width', 'page-fit', 0.25, 4] as const) expect(readingLocatorSchema.parse({ kind: 'pdf', pageIndex: 0, zoom }).kind).toBe('pdf');
  });
  it('rejects a zoom outside 0.25 to 4, an unknown zoom name and a rotation that is not a quarter turn', () => {
    for (const zoom of [0.2, 4.1, 0, -1, 'fit', Number.NaN]) expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, zoom }).success, String(zoom)).toBe(false);
    for (const rotation of [45, 360, -90]) expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, rotation }).success, String(rotation)).toBe(false);
  });
  it('reads the scroll and spread modes and the page count, and an old value without them as it was', () => {
    const v = { kind: 'pdf', pageIndex: 4, scroll: 'horizontal', spread: 'none', pages: 17 } as const;
    expect(readingLocatorSchema.parse(v)).toEqual(v);
    for (const scroll of ['vertical', 'horizontal', 'page'] as const) expect(readingLocatorSchema.parse({ kind: 'pdf', pageIndex: 0, scroll })).toMatchObject({ scroll });
    for (const spread of ['none', 'odd', 'even'] as const) expect(readingLocatorSchema.parse({ kind: 'pdf', pageIndex: 0, spread })).toMatchObject({ spread });
    const old = readingLocatorSchema.parse({ kind: 'pdf', pageIndex: 2, zoom: 1 });
    expect(old).not.toHaveProperty('scroll');
    expect(old).not.toHaveProperty('spread');
    expect(old).not.toHaveProperty('pages');
  });
  it('rejects a mode it does not know and a page count that is not a whole number of at least 1', () => {
    for (const scroll of ['wrapped', 'Vertical', '', 1]) expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, scroll }).success, String(scroll)).toBe(false);
    for (const spread of ['both', 'odds', 0]) expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, spread }).success, String(spread)).toBe(false);
    for (const pages of [0, -1, 1.5, Number.NaN, '3']) expect(readingLocatorSchema.safeParse({ kind: 'pdf', pageIndex: 0, pages }).success, String(pages)).toBe(false);
  });
  it('announces a position at most once per two seconds', () => {
    expect(POSITION_NOTICE_MS).toBe(2000);
  });
});
