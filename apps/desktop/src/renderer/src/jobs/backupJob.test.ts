import { describe, expect, it, vi } from 'vitest';
import { IDLE_BACKUP_PROGRESS, type JobProgress } from '@learn/domain';
import { backupResult, followBackup } from './backupJob';

const p = (over: Partial<JobProgress>): JobProgress => ({ ...IDLE_BACKUP_PROGRESS, ...over });
function harness() {
  let stored = p({});
  const toast = { begin: vi.fn(), end: vi.fn((): string | null => 'k1'), settle: vi.fn() };
  const follow = followBackup(toast, () => stored, (next) => (stored = next));
  return { toast, follow, stored: () => stored };
}

describe('the backup in this window (spec 8.1, P-3)', () => {
  it('a run begins its toast once; its end freezes the toast at its last state and settles it — done closes it (the sheet says it)', () => {
    const h = harness();
    const named = p({ state: 'running', name: 'Learn 백업 2026-10-30 2141', done: 1, total: 2 });
    h.follow(p({ state: 'waiting-job' }));
    h.follow(p({ state: 'running', name: 'Learn 백업 2026-10-30 2141' }));
    h.follow(named);
    expect(h.toast.begin.mock.calls).toEqual([[false]]);
    h.follow(p({ outcome: 'done' }));
    expect(h.toast.end.mock.calls).toEqual([[named]]);
    expect(h.toast.settle.mock.calls).toEqual([['k1', null]]);
    expect(h.stored()).toEqual(p({ outcome: 'done' }));
  });
  it('cancelled is an info toast; failed an error toast with the cause and the next step; done has none', () => {
    expect(backupResult(p({ outcome: 'cancelled' }))).toEqual({ kind: 'info', title: '백업을 취소했습니다', body: '만들던 백업 폴더는 남기지 않았습니다.', testId: 'backup-cancelled' });
    expect(backupResult(p({ outcome: 'failed', error: { code: 'DISK_FULL', message: '원인. 다음 행동.' } }))).toEqual({ kind: 'error', title: '백업을 만들지 못했습니다', body: '원인. 다음 행동.', testId: 'backup-failed' });
    expect(backupResult(p({ outcome: 'done' }))).toBeNull();
  });
  it('a restore\'s notice, or an idle one with nothing running, changes nothing here', () => {
    const h = harness();
    h.follow({ ...p({ state: 'running' }), kind: 'restore' });
    h.follow(p({}));
    expect([h.toast.begin, h.toast.end, h.toast.settle].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    expect(h.stored()).toEqual(p({}));
  });
});
