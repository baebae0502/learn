import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Props a sheet body takes while it scrolls; none while everything fits. `data-under-top` / `data-under-bottom`: content
 * is scrolled under the title's or the foot's edge, which then draws its hairline (sheet.css).
 */
export type ScrollRegionProps =
  | { tabIndex: 0; role: 'region'; 'aria-labelledby': string; 'data-scrolls': ''; 'data-under-top'?: ''; 'data-under-bottom'?: '' }
  | Record<string, never>;

interface Measure {
  scrolls: boolean;
  top: boolean;
  bottom: boolean;
}
const FITS: Measure = { scrolls: false, top: false, bottom: false };
const same = (a: Measure, b: Measure) => a.scrolls === b.scrolls && a.top === b.top && a.bottom === b.bottom;

/**
 * A sheet body that scrolls is a keyboard stop (WCAG 2.1.1; axe scrollable-region-focusable, found on the 768-tall
 * macOS runner, run 39779536146): while its content overflows it takes tabIndex 0 and is a region named by the sheet's
 * title, so Tab reaches it and the arrows, Page Up / Page Down and Space scroll it. When everything fits it is no stop.
 * Re-measured whenever its box or its content changes size (the window is sized to the content after it renders), and
 * on scroll: which edges have content under them (critique m3, as NSScrollView draws a sheet's scroll edges).
 */
export function useScrollRegion(ref: RefObject<HTMLElement | null>, labelledBy: string): ScrollRegionProps {
  const [m, setM] = useState<Measure>(FITS);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const scrolls = el.scrollHeight > el.clientHeight + 1;
      const next = scrolls ? { scrolls, top: el.scrollTop > 0, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1 } : FITS;
      setM((prev) => (same(prev, next) ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, [ref]);
  if (!m.scrolls) return {};
  return {
    tabIndex: 0,
    role: 'region',
    'aria-labelledby': labelledBy,
    'data-scrolls': '',
    ...(m.top ? { 'data-under-top': '' as const } : {}),
    ...(m.bottom ? { 'data-under-bottom': '' as const } : {}),
  };
}
