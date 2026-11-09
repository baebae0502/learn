import type { LibraryItem } from '@learn/domain';

/** Past this many pixels the panel shows the icon box: Chromium decodes the whole picture before it scales it down. */
export const PREVIEW_MAX_PIXELS = 50_000_000;

/** What the panel draws for one image: its picture, or the icon box (size unknown, too large, original missing). */
export function previewMode(item: Pick<LibraryItem, 'imageSize' | 'availability'>): 'picture' | 'icon' {
  const size = item.imageSize;
  if (!size || item.availability === 'missing') return 'icon';
  return size.width * size.height > PREVIEW_MAX_PIXELS ? 'icon' : 'picture';
}
