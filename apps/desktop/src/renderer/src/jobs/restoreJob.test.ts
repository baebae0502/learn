import { describe, expect, it, vi } from 'vitest';
import { IDLE_BACKUP_PROGRESS, IDLE_RESTORE_PROGRESS, LearnError, type JobProgress } from '@learn/domain';
import { followJob } from './followJob';
import { restoreRefused, restoreResult } from './restoreJob';

const p = (over: Partial<JobProgress>): JobProgress => ({ ...IDLE_RESTORE_PROGRESS, ...over });

describe('the restore in this window (spec 9.1, P-3)', () => {
  it('cancelled is an info toast; failed — or refused before it ran — an error toast with the cause and what to do; done has none, its sheet says it', () => {
    expect(restoreResult(p({ outcome: 'cancelled' }))).toEqual({ kind: 'info', title: '복원을 취소했습니다', body: '만들던 라이브러리 폴더는 남기지 않았습니다.', testId: 'restore-cancelled' });
    expect(restoreResult(p({ outcome: 'failed', error: { code: 'DISK_FULL', message: '원인. 다음 행동.' } }))).toEqual({
      kind: 'error', title: '복원하지 못했습니다', body: '원인. 다음 행동.', testId: 'restore-failed',
    });
    expect(restoreResult(p({ outcome: 'done' }))).toBeNull();
    expect(restoreRefused(new LearnError('VALIDATION_FAILED', '원인. 다음 행동.'))).toEqual({ kind: 'error', title: '복원하지 못했습니다', body: '원인. 다음 행동.', testId: 'restore-failed' });
  });

  it('followJob: its own job\'s run begins the toast once, its end freezes the toast at the last state and settles it; another job\'s notices pass by', () => {
    let stored = p({});
    const toast = { begin: vi.fn(), end: vi.fn((): string | null => 'k9'), settle: vi.fn() };
    const follow = followJob('restore', restoreResult, toast, () => stored, (next) => (stored = next));
    follow({ ...IDLE_BACKUP_PROGRESS, state: 'running' });
    expect(toast.begin).not.toHaveBeenCalled();
    const running = p({ state: 'running', name: 'Learn 복원 2026-10-31 2141', done: 1, total: 3 });
    follow(p({ state: 'waiting-job' }));
    follow(running);
    follow(p({ outcome: 'cancelled' }));
    expect(toast.begin.mock.calls).toEqual([[false]]);
    expect(toast.end.mock.calls).toEqual([[running]]);
    expect(toast.settle.mock.calls).toEqual([['k9', restoreResult(p({ outcome: 'cancelled' }))]]);
    expect(stored).toEqual(p({ outcome: 'cancelled' }));
  });
});
