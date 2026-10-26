import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { libraryStats, multiSummary } from './summary';

let n = 0;
const item = (type: LibraryItem['type'], size: number): LibraryItem => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, title: `t${n}`, type, mime: type === 'pdf' ? 'application/pdf' : 'video/mp4', size,
  storageMode: 'managed', availability: 'available', assetId: 'a', revisionId: 'r', originalName: 'x', createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, tagIds: [], progress: null, openedAt: null, publisher: null,
});

describe('item panel summaries (spec §5.4, library.html none / multi)', () => {
  it('states the library: count, kinds that have items, total size; breaks only at the middots', () => {
    expect(libraryStats([item('pdf', 1_000_000), item('pdf', 1_000_000), item('video', 900_000)])).toBe('내 라이브러리 · 자료 3개(PDF 2 · 동영상 1) · 2.9 MB');
    expect(libraryStats([item('pdf', 1761)])).toBe('내 라이브러리 · 자료 1개(PDF 1) · 1.8 KB');
  });
  it('sums up a multiple selection: kinds with 개, then 합계', () => {
    expect(multiSummary([item('pdf', 4_000_000), item('pdf', 5_000_000), item('video', 800_000)])).toBe('PDF 2개 · 동영상 1개 · 합계 9.8 MB');
    expect(multiSummary([item('video', 500), item('video', 500)])).toBe('동영상 2개 · 합계 1.0 KB');
  });
});
