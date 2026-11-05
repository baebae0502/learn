import { describe, expect, it } from 'vitest';
import { furthestPageSeen, type PageSpan } from './furthestPage';

/** Pages of 400 px with 10 px between, the first starting at 0. */
const pages = (count: number): PageSpan[] => Array.from({ length: count }, (_, i) => ({ number: i + 1, top: i * 410, bottom: i * 410 + 400 }));

describe('the furthest page seen', () => {
  it('is the last page wholly in view when several pages are on screen', () => {
    // The stage shows pages 3 and 4 and half of 5 (scrolled to page 3's top).
    const box = { scrollTop: 820, clientHeight: 900, scrollHeight: 41_000 };
    expect(furthestPageSeen(3, 100, box, pages(100).slice(2, 5))).toBe(4);
  });
  it('is the top page when no page is wholly in view (a page taller than the stage)', () => {
    const tall: PageSpan[] = [{ number: 7, top: 0, bottom: 3000 }, { number: 8, top: 3010, bottom: 6010 }];
    expect(furthestPageSeen(7, 20, { scrollTop: 500, clientHeight: 900, scrollHeight: 60_000 }, tall)).toBe(7);
  });
  it('is the last page once the scroll reaches the end, even when the page above is the top one', () => {
    // 30 slides, two on screen: at the very end the top page is 29 and the last one is 30.
    const box = { scrollTop: 29 * 410 - 10, clientHeight: 820, scrollHeight: 29 * 410 - 10 + 820 };
    expect(furthestPageSeen(29, 30, box, pages(30).slice(28))).toBe(30);
  });
  it('is the last page at the end of a single tall page document', () => {
    expect(furthestPageSeen(1, 1, { scrollTop: 2100, clientHeight: 900, scrollHeight: 3000 }, [{ number: 1, top: 0, bottom: 3000 }])).toBe(1);
    expect(furthestPageSeen(5, 5, { scrollTop: 9000, clientHeight: 900, scrollHeight: 9900 }, [{ number: 5, top: 5000, bottom: 9900 }])).toBe(5);
  });
  it('never counts a page that is only partly in view, nor goes below the top page', () => {
    const box = { scrollTop: 0, clientHeight: 600, scrollHeight: 41_000 };
    expect(furthestPageSeen(1, 100, box, pages(100).slice(0, 2))).toBe(1);
    expect(furthestPageSeen(9, 100, box, [])).toBe(9);
  });
  it('counts a page that touches the edge by a rounding pixel (page 2 ends at 810)', () => {
    const box = { scrollTop: 0, clientHeight: 809.5, scrollHeight: 41_000 };
    expect(furthestPageSeen(1, 100, box, pages(100).slice(0, 2))).toBe(2);
    expect(furthestPageSeen(1, 100, { ...box, clientHeight: 808 }, pages(100).slice(0, 2))).toBe(1);
  });
  it('reaches the end within a rounding pixel', () => {
    expect(furthestPageSeen(29, 30, { scrollTop: 1000, clientHeight: 500, scrollHeight: 1500.5 }, pages(30).slice(28))).toBe(30);
    expect(furthestPageSeen(29, 30, { scrollTop: 1000, clientHeight: 500, scrollHeight: 1502 }, pages(30).slice(28))).toBe(29);
  });
});
