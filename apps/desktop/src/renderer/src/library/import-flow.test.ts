import { describe, expect, it, vi } from 'vitest';
import type { ImportOutcome, LibraryItem } from '@learn/domain';
import { LIST_REFRESH_WAIT_MS, failureLines, settleImport, settledWithin } from './import-flow';

const item = (id: string) => ({ id }) as LibraryItem;
const imported = (path: string, id: string): ImportOutcome => ({ status: 'imported', path, item: item(id) });
const dup = (path: string, existingItemId: string): ImportOutcome => ({ status: 'duplicate', path, existingItemId });
const failed = (path: string, message: string): ImportOutcome => ({ status: 'failed', path, code: 'UNSUPPORTED_TYPE', message });

const UNSUPPORTED = '지원하지 않는 형식입니다. 지금은 PDF와\u00a0동영상(MP4 · MOV · WebM)을 가져올\u00a0수 있습니다.';

describe('settleImport', () => {
  it('counts imports and failures and asks about each duplicate in order', async () => {
    const confirm = vi.fn().mockResolvedValueOnce('skip').mockResolvedValueOnce('add');
    const importAgain = vi.fn().mockResolvedValue([imported('/b.pdf', 'n2')]);
    const report = await settleImport([imported('/a.pdf', 'n1'), dup('/x.pdf', 'e1'), dup('/b.pdf', 'e2'), failed('/dir/notes.txt', '지원하지 않는 형식입니다.')], 'managed', { confirm, importAgain });
    expect(confirm.mock.calls.map((c) => c[0])).toEqual([{ path: '/x.pdf', existingItemId: 'e1' }, { path: '/b.pdf', existingItemId: 'e2' }]);
    expect(importAgain).toHaveBeenCalledExactlyOnceWith('/b.pdf', 'managed');
    expect(report).toEqual({ imported: 2, failed: [{ name: 'notes.txt', message: '지원하지 않는 형식입니다.' }], openItemId: null });
  });
  it('remembers the existing item to open', async () => {
    const report = await settleImport([dup('/x.pdf', 'e1')], 'linked', { confirm: async () => 'open', importAgain: vi.fn() });
    expect(report.openItemId).toBe('e1');
    expect(report.imported).toBe(0);
  });
  it('a re-import that throws is one failed file; what was imported before and after still counts', async () => {
    const importAgain = vi
      .fn()
      .mockRejectedValueOnce(new Error('원본 파일을 읽지 못했습니다. 파일을 확인하세요.'))
      .mockResolvedValueOnce([imported('/c.pdf', 'n3')]);
    const report = await settleImport([imported('/a.pdf', 'n1'), dup('/dir/b.pdf', 'e2'), dup('/c.pdf', 'e3')], 'managed', { confirm: async () => 'add', importAgain });
    expect(report).toEqual({ imported: 2, failed: [{ name: 'b.pdf', message: '원본 파일을 읽지 못했습니다. 파일을 확인하세요.' }], openItemId: null });
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
      hints: ['지금은 PDF와\u00a0동영상(MP4 · MOV · WebM)을 가져올\u00a0수 있습니다.', '다시 가져오세요.'],
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
