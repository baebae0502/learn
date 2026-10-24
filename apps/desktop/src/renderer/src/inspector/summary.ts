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

/** Nothing selected: "내 라이브러리 · 자료 48개(PDF 35 · 동영상 13) · 1.9 GB"; a kind without items is left out. */
export function libraryStats(items: readonly LibraryItem[]): string {
  const k = tally(items);
  const kinds = [k.pdf ? t.inspector.kindCount(t.library.type.pdf, k.pdf) : '', k.video ? t.inspector.kindCount(t.library.type.video, k.video) : ''].filter(Boolean);
  return t.inspector.stats(t.shell.myLibrary, items.length, kinds.join(' · '), bound(formatSize(k.bytes)));
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
    .join(' · ');
}
