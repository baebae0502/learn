import { describe, expect, it, vi } from 'vitest';
import type { ImportOutcome, LibraryItem } from '@learn/domain';
import { LIST_REFRESH_WAIT_MS, failureLines, importToast, settleImport, settledWithin, type ImportFlowDeps, type ImportReport } from './import-flow';

const item = (id: string) => ({ id }) as LibraryItem;
const imported = (path: string, id: string): ImportOutcome => ({ status: 'imported', path, item: item(id) });
const dup = (path: string, existingItemId: string): ImportOutcome => ({ status: 'duplicate', path, existingItemId });
const failed = (path: string, message: string): ImportOutcome => ({ status: 'failed', path, code: 'UNSUPPORTED_TYPE', message });
const filedIn = (path: string, id: string, collectionId: string): ImportOutcome => ({ status: 'imported', path, item: item(id), collectionId });
const flow = (over: Partial<ImportFlowDeps> = {}): ImportFlowDeps => ({
  confirm: async () => 'skip',
  importAgain: vi.fn().mockResolvedValue([]),
  fileExisting: vi.fn().mockResolvedValue(0),
  ...over,
});

const UNSUPPORTED = '지원하지 않는 형식입니다. 지금은 PDF와\u00a0동영상(MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM)을 가져올\u00a0수 있습니다.';

describe('settleImport', () => {
  it('counts imports and failures and asks about each duplicate in order', async () => {
    const confirm = vi.fn().mockResolvedValueOnce('skip').mockResolvedValueOnce('add');
    const importAgain = vi.fn().mockResolvedValue([imported('/b.pdf', 'n2')]);
    const report = await settleImport([imported('/a.pdf', 'n1'), dup('/x.pdf', 'e1'), dup('/b.pdf', 'e2'), failed('/dir/notes.txt', '지원하지 않는 형식입니다.')], 'managed', flow({ confirm, importAgain }));
    expect(confirm.mock.calls.map((c) => c[0])).toEqual([{ path: '/x.pdf', existingItemId: 'e1' }, { path: '/b.pdf', existingItemId: 'e2' }]);
    expect(importAgain).toHaveBeenCalledExactlyOnceWith('/b.pdf', 'managed', null);
    expect(report).toEqual({ imported: 2, filed: 0, filedExisting: 0, failed: [{ name: 'notes.txt', message: '지원하지 않는 형식입니다.' }], openItemId: null });
  });
  it('remembers the existing item to open', async () => {
    const report = await settleImport([dup('/x.pdf', 'e1')], 'linked', flow({ confirm: async () => 'open' }));
    expect(report.openItemId).toBe('e1');
    expect(report.imported).toBe(0);
  });
  it('a re-import that throws is one failed file; what was imported before and after still counts', async () => {
    const importAgain = vi
      .fn()
      .mockRejectedValueOnce(new Error('원본 파일을 읽지 못했습니다. 파일을 확인하세요.'))
      .mockResolvedValueOnce([imported('/c.pdf', 'n3')]);
    const report = await settleImport([imported('/a.pdf', 'n1'), dup('/dir/b.pdf', 'e2'), dup('/c.pdf', 'e3')], 'managed', flow({ confirm: async () => 'add', importAgain }));
    expect(report).toEqual({ imported: 2, filed: 0, filedExisting: 0, failed: [{ name: 'b.pdf', message: '원본 파일을 읽지 못했습니다. 파일을 확인하세요.' }], openItemId: null });
  });

  it('counts the items that went into the collection asked for (an outcome carries collectionId only when it did)', async () => {
    const report = await settleImport([filedIn('/a.pdf', 'n1', 'c1'), filedIn('/b.pdf', 'n2', 'c1'), imported('/c.pdf', 'n3')], 'managed', flow(), 'c1');
    expect([report.imported, report.filed]).toEqual([3, 2]);
  });
  it('files the existing items of the duplicates left out ("가져오지 않음") into the collection: one call, and the count it answers', async () => {
    const fileExisting = vi.fn().mockResolvedValue(1);
    const confirm = vi.fn().mockResolvedValueOnce('skip').mockResolvedValueOnce('open').mockResolvedValueOnce('skip');
    const report = await settleImport([dup('/x.pdf', 'e1'), dup('/y.pdf', 'e2'), dup('/z.pdf', 'e3')], 'managed', flow({ confirm, fileExisting }), 'c1');
    expect(fileExisting).toHaveBeenCalledExactlyOnceWith('c1', ['e1', 'e3']);
    expect(report.filedExisting).toBe(1); // e3 was in already: only the new filing counts
    expect(report.openItemId).toBe('e2');
  });
  it('files nothing when no collection was asked for; "새 자료로 추가" carries the collection; a refused filing is not a failed import', async () => {
    const quiet = flow();
    await settleImport([dup('/x.pdf', 'e1')], 'managed', quiet);
    expect(quiet.fileExisting).not.toHaveBeenCalled();
    const again = flow({ confirm: async () => 'add', importAgain: vi.fn().mockResolvedValue([filedIn('/x.pdf', 'n9', 'c1')]) });
    const added = await settleImport([dup('/x.pdf', 'e1')], 'managed', again, 'c1');
    expect(again.importAgain).toHaveBeenCalledExactlyOnceWith('/x.pdf', 'managed', 'c1');
    expect([added.imported, added.filed]).toEqual([1, 1]);
    const refused = flow({ fileExisting: vi.fn().mockRejectedValue(new Error('x')) });
    const report = await settleImport([dup('/x.pdf', 'e1')], 'managed', refused, 'c1');
    expect(report).toMatchObject({ imported: 0, filedExisting: 0, failed: [] });
  });
});

describe('importToast (spec 3.7)', () => {
  const report = (over: Partial<ImportReport> = {}): ImportReport => ({ imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null, ...over });
  const into = { name: '학회 준비' };
  it('is the plain copy or link sentence, as before, for no collection', () => {
    expect(importToast(report({ imported: 2 }), 'managed', null)).toEqual({ kind: 'success', title: '자료 2개를 가져왔습니다', testId: 'import-done' });
    expect(importToast(report({ imported: 1 }), 'linked', null)).toEqual({ kind: 'success', title: '자료 1개를 연결했습니다', testId: 'import-done' });
  });
  it('names the collection when every imported item went in', () => {
    expect(importToast(report({ imported: 2, filed: 2 }), 'managed', into)?.title).toBe('‘학회 준비’\u2060에 자료 2개를 가져왔습니다');
    expect(importToast(report({ imported: 1, filed: 1 }), 'linked', into)?.title).toBe('‘학회 준비’\u2060에 자료 1개를 연결했습니다');
  });
  it('does not when some did not (the collection was deleted meanwhile): the library\'s plain sentence', () => {
    expect(importToast(report({ imported: 2, filed: 1 }), 'managed', into)?.title).toBe('자료 2개를 가져왔습니다');
  });
  it('adds the existing items it filed as a line under the title; with nothing imported that sentence is the title', () => {
    expect(importToast(report({ imported: 1, filed: 1, filedExisting: 2 }), 'managed', into)).toEqual({
      kind: 'success', title: '‘학회 준비’\u2060에 자료 1개를 가져왔습니다', lines: ['이미 있는 자료 2개를 ‘학회 준비’\u2060에 넣었습니다'], testId: 'import-done',
    });
    expect(importToast(report({ filedExisting: 1 }), 'managed', into)).toEqual({ kind: 'success', title: '이미 있는 자료 1개를 ‘학회 준비’\u2060에 넣었습니다', testId: 'import-done' });
  });
  it('says nothing for nothing', () => {
    expect(importToast(report(), 'managed', into)).toBeNull();
    expect(importToast(report({ failed: [{ name: 'a', message: 'x' }] }), 'managed', null)).toBeNull();
  });
});

describe('failureLines', () => {
  it('lists up to three files as name + cause (the name may be cut, the cause stays) and counts the rest', () => {
    const f = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.txt`, message: '지원하지 않는 형식입니다.' }));
    const cause = '지원하지 않는 형식입니다.';
    expect(failureLines(f)).toEqual({ lines: [{ name: 'a.txt', cause }, { name: 'b.txt', cause }, { name: 'c.txt', cause }, '외 2개'], hints: [] });
    expect(failureLines(f.slice(0, 1))).toEqual({ lines: [{ name: 'a.txt', cause }], hints: [] });
  });
  it('gives each next step once, after the list (cause + next step, design-spec 9)', () => {
    const f = [
      ...['a', 'b', 'c', 'd'].map((n) => ({ name: `${n}.txt`, message: UNSUPPORTED })),
      { name: 'dir', message: '일반 파일만 가져올\u00a0수 있습니다.' },
      { name: 'x.pdf', message: '파일을 읽지 못했습니다. 다시 가져오세요.' },
    ];
    expect(failureLines(f)).toEqual({
      lines: [...['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, cause: '지원하지 않는 형식입니다.' })), '외 3개'],
      hints: ['지금은 PDF와\u00a0동영상(MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM)을 가져올\u00a0수 있습니다.', '다시 가져오세요.'],
    });
  });
});

describe('settledWithin (the list refresh at the end of an import)', () => {
  it('resolves with the work, whether it succeeds or fails', async () => {
    await expect(settledWithin(Promise.resolve(1), 1000)).resolves.toBeUndefined();
    await expect(settledWithin(Promise.reject(new Error('read failed')), 1000)).resolves.toBeUndefined();
  });
  it('resolves after the limit when the work never answers (3 s for the list)', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void settledWithin(new Promise(() => {}), LIST_REFRESH_WAIT_MS).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(LIST_REFRESH_WAIT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(LIST_REFRESH_WAIT_MS).toBe(3000);
  });
});
