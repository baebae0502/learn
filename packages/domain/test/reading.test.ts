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
  it('announces a position at most once per two seconds', () => {
    expect(POSITION_NOTICE_MS).toBe(2000);
  });
});
