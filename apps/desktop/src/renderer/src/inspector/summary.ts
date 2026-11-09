import type { LibraryItem } from '@learn/domain';
import { formatSize } from '../format';
import { t } from '../strings';

/** One unbreakable value ("1.9 GB"): the line breaks at its middots, never inside a value (design-spec 4). */
const bound = (s: string): string => s.replace(/ /g, ' ');

function tally(items: readonly LibraryItem[]): { pdf: number; video: number; image: number; bytes: number } {
  const k = { pdf: 0, video: 0, image: 0, bytes: 0 };
  for (const i of items) {
    k[i.type]++;
    k.bytes += i.size;
  }
  return k;
}

/**
 * Nothing selected: "분자생물학 · 자료 48개(PDF 35 · 동영상 10 · 이미지 3) · 1.9 GB" (the view's name, then its items); a kind without
 * items is left out, and a view without items says only "자료 0개". The trash adds "· 컬렉션 N개" after the items part when it
 * holds collections.
 */
export function libraryStats(scope: string, items: readonly LibraryItem[], collections = 0): string {
  const extra = collections > 0 ? t.inspector.statsCollections(collections) : '';
  if (items.length === 0) return t.inspector.statsNone(scope, extra);
  const k = tally(items);
  const kinds = [k.pdf ? t.inspector.kindCount(t.library.type.pdf, k.pdf) : '', k.video ? t.inspector.kindCount(t.library.type.video, k.video) : '', k.image ? t.inspector.kindCount(t.library.type.image, k.image) : ''].filter(Boolean);
  return t.inspector.stats(scope, items.length, kinds.join('\u00a0· '), bound(formatSize(k.bytes)), extra);
}

/** Several selected: "PDF 2개 · 동영상 1개 · 이미지 1개 · 합계 9.8 MB". */
export function multiSummary(items: readonly LibraryItem[]): string {
  const k = tally(items);
  return [
    k.pdf ? t.inspector.kindItems(t.library.type.pdf, k.pdf) : '',
    k.video ? t.inspector.kindItems(t.library.type.video, k.video) : '',
    k.image ? t.inspector.kindItems(t.library.type.image, k.image) : '',
    t.inspector.total(bound(formatSize(k.bytes))),
  ]
    .filter(Boolean)
    .join('\u00a0· ');
}
