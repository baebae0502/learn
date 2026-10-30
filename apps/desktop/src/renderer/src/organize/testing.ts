import type { LibraryItem } from '@learn/domain';

/** A complete list row for pure-module tests; `over` changes what the test is about. */
export const item = (id: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id, title: id, type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed', availability: 'available', assetId: `a-${id}`, revisionId: `r-${id}`,
  originalName: `${id}.pdf`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, publisher: null,
  progress: null, openedAt: null, ...over,
});
