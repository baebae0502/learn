import type { LibraryItem } from '@learn/domain';
import { t } from '../strings';

/** What the drag image of rows shows: the first row's kind and title, and how many rows go with it. */
export interface PreviewFacts {
  title: string;
  type: LibraryItem['type'];
  count: number;
}

export function previewFacts(itemIds: readonly string[], items: readonly LibraryItem[] | undefined): PreviewFacts {
  const first = items?.find((i) => i.id === itemIds[0]);
  return { title: first?.title ?? t.organize.dnd.plain(itemIds.length), type: first?.type ?? 'pdf', count: itemIds.length };
}
