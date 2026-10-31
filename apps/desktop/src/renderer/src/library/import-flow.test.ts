import { describe, expect, it, vi } from 'vitest';
import type { ImportReport } from '@learn/domain';
import { LIST_REFRESH_WAIT_MS, failureLines, importToast, settledWithin } from './import-flow';

const UNSUPPORTED = '지원하지 않는 형식입니다. 지금은 PDF와 동영상(MP4 · MOV · WebM)을 가져올 수 있습니다.';
const report = (over: Partial<ImportReport> = {}): ImportReport => ({
  imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: 0, cancelled: false, mode: 'managed', collectionId: null, ...over,
});
const into = { name: '학회 준비' };

describe('importToast: the result of a run, from main\'s report (spec 3.3, 3.7)', () => {
  it('is the plain copy or link sentence for no collection; a run of mixed modes says 가져왔습니다', () => {
    expect(importToast(report({ imported: 2, requested: 2 }), null)).toEqual({ kind: 'success', title: '자료 2개를 가져왔습니다', testId: 'import-done' });
    expect(importToast(report({ imported: 1, requested: 1, mode: 'linked' }), null)).toEqual({ kind: 'success', title: '자료 1개를 연결했습니다', testId: 'import-done' });
    expect(importToast(report({ imported: 3, requested: 3, mode: null }), null)?.title).toBe('자료 3개를 가져왔습니다');
  });
  it('names the collection when every imported item went in, not when some did not (it was deleted meanwhile)', () => {
    expect(importToast(report({ imported: 2, filed: 2 }), into)?.title).toBe('‘학회 준비’⁠에 자료 2개를 가져왔습니다');
    expect(importToast(report({ imported: 1, filed: 1, mode: 'linked' }), into)?.title).toBe('‘학회 준비’⁠에 자료 1개를 연결했습니다');
    expect(importToast(report({ imported: 2, filed: 1 }), into)?.title).toBe('자료 2개를 가져왔습니다');
  });
  it('adds the existing items 건너뛰기 filed as a line; with nothing imported that sentence is the title', () => {
    expect(importToast(report({ imported: 1, filed: 1, filedExisting: 2 }), into)).toEqual({
      kind: 'success', title: '‘학회 준비’⁠에 자료 1개를 가져왔습니다', lines: ['이미 있는 자료 2개를 ‘학회 준비’⁠에 넣었습니다'], testId: 'import-done',
    });
    expect(importToast(report({ filedExisting: 1 }), into)).toEqual({ kind: 'success', title: '이미 있는 자료 1개를 ‘학회 준비’⁠에 넣었습니다', testId: 'import-done' });
  });
  it('a run stopped by 취소 says how many of the files put in came in; with none, plainly (info, not success)', () => {
    expect(importToast(report({ imported: 7, requested: 12, cancelled: true }), null)).toEqual({ kind: 'success', title: '12개 중 7개를 가져왔습니다', testId: 'import-done' });
    expect(importToast(report({ imported: 1, requested: 3, cancelled: true, mode: 'linked' }), null)?.title).toBe('3개 중 1개를 연결했습니다');
    expect(importToast(report({ imported: 0, requested: 2, cancelled: true }), null)).toEqual({ kind: 'info', title: '2개 중 0개를 가져왔습니다', testId: 'import-done' });
  });
  it('says nothing for nothing (failures have their own toast)', () => {
    expect(importToast(report(), into)).toBeNull();
    expect(importToast(report({ failed: [{ name: 'a', message: 'x' }], requested: 1 }), null)).toBeNull();
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
      { name: 'dir', message: '일반 파일만 가져올 수 있습니다.' },
      { name: 'x.pdf', message: '파일을 읽지 못했습니다. 다시 가져오세요.' },
    ];
    expect(failureLines(f)).toEqual({
      lines: [...['a.txt', 'b.txt', 'c.txt'].map((name) => ({ name, cause: '지원하지 않는 형식입니다.' })), '외 3개'],
      hints: ['지금은 PDF와 동영상(MP4 · MOV · WebM)을 가져올 수 있습니다.', '다시 가져오세요.'],
    });
  });
});

describe('settledWithin (the list read at the end of a run)', () => {
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
  });
});
