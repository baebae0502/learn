import type { JobProgress } from '@learn/domain';
import { useLearnEvent } from '../events';
import { t } from '../strings';
import { closeToast, showJobToast, showToast, type ToastData } from '../ui/toasts';
import { followJob } from './followJob';
import { useJobProgress } from './jobProgress';
import { createProgressToast } from './progressToast';

/** How a restore run ends in its toast (spec 9.3 실패); the result sheet speaks for a done one, so it has none here. */
export function restoreResult(p: JobProgress): ToastData | null {
  if (p.outcome === 'cancelled') return { kind: 'info', title: t.jobs.restoreCancelled, body: t.jobs.restoreCancelledBody, testId: 'restore-cancelled' };
  if (p.outcome === 'failed') return { kind: 'error', title: t.jobs.restoreFailed, ...(p.error ? { body: p.error.message } : {}), testId: 'restore-failed' };
  return null;
}

/** A restore refused before it ran (not a backup, a newer one, a place it cannot use): the same toast as one that failed. */
export function restoreRefused(e: unknown): ToastData {
  return { kind: 'error', title: t.jobs.restoreFailed, ...(e instanceof Error ? { body: e.message } : {}), testId: 'restore-failed' };
}

/** The restore's progress toast in this window: one controller, as there is one toast queue (as the backup's). */
const restoreToast = createProgressToast('restore', {
  add: (job) => showJobToast(job),
  close: closeToast,
  show: (data) => void showToast(data),
  setView: (key, view) => useJobProgress.getState().setView(key, view),
});
const follow = followJob('restore', restoreResult, restoreToast, () => useJobProgress.getState().restore, (p) => useJobProgress.getState().setRestore(p));

/** main's restore on the work line (job:progress), followed into the store and the toast. */
export function useRestoreJob(): void {
  useLearnEvent('job:progress', follow);
}
