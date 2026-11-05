import { PAGE_COLORS, type PageColor } from '@learn/domain';

/** The stored setting, or 'auto' for anything unset or unreadable. */
export function parsePageColor(raw: unknown): PageColor {
  return PAGE_COLORS.find((c) => c === raw) ?? 'auto';
}

/** The colour a page is drawn in: 자동 follows the app theme. */
export function resolvePageColor(color: PageColor, shade: 'light' | 'dark'): Exclude<PageColor, 'auto'> {
  return color === 'auto' ? (shade === 'dark' ? 'dark' : 'original') : color;
}
