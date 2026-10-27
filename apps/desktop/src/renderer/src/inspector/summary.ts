import type { LibraryItem } from '@learn/domain';
import { formatSize } from '../format';
import { t } from '../strings';

/** One unbreakable value ("1.9 GB"): the line breaks at its middots, never inside a value (design-spec 4). */
const bound = (s: string): string => s.replace(/ /g, ' ');

function tally(items: readonly LibraryItem[]): { pdf: number; video: number; bytes: number } {
  let pdf = 0;
  let bytes = 0;
  for (const i of items) {
    if (i.type === 'pdf') pdf++;
    bytes += i.size;
  }
  return { pdf, video: items.length - pdf, bytes };
}

/**
 * Nothing selected: "분자생물학 · 자료 48개(PDF 35 · 동영상 13) · 1.9 GB" (the view's name, then its items); a kind without
 * items is left out, and a view without items says only "자료 0개".
 */
export function libraryStats(scope: string, items: readonly LibraryItem[]): string {
  if (items.length === 0) return t.inspector.statsNone(scope);
  const k = tally(items);
  const kinds = [k.pdf ? t.inspector.kindCount(t.library.type.pdf, k.pdf) : '', k.video ? t.inspector.kindCount(t.library.type.video, k.video) : ''].filter(Boolean);
  return t.inspector.stats(scope, items.length, kinds.join('\u00a0· '), bound(formatSize(k.bytes)));
}

/** Several selected: "PDF 2개 · 동영상 1개 · 합계 9.8 MB". */
export function multiSummary(items: readonly LibraryItem[]): string {
  const k = tally(items);
  return [
    k.pdf ? t.inspector.kindItems(t.library.type.pdf, k.pdf) : '',
    k.video ? t.inspector.kindItems(t.library.type.video, k.video) : '',
    t.inspector.total(bound(formatSize(k.bytes))),
  ]
    .filter(Boolean)
    .join('\u00a0· ');
}
