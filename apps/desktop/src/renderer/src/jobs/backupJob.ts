import type { JobProgress } from '@learn/domain';
import { useLearnEvent } from '../events';
import { t } from '../strings';
import { closeToast, showJobToast, showToast, type ToastData } from '../ui/toasts';
import { useJobProgress } from './jobProgress';
import { createProgressToast, type ProgressToast } from './progressToast';

/** How a backup run ends in its toast (spec 8.1); the result sheet speaks for a done one, so it has none here. */
export function backupResult(p: JobProgress): ToastData | null {
  if (p.outcome === 'cancelled') return { kind: 'info', title: t.jobs.backupCancelled, body: t.jobs.backupCancelledBody, testId: 'backup-cancelled' };
  if (p.outcome === 'failed') return { kind: 'error', title: t.jobs.backupFailed, ...(p.error ? { body: p.error.message } : {}), testId: 'backup-failed' };
  return null;
}

/**
 * The backup's notices into the store and its one toast (P-3): a run's first busy notice begins the toast, its end
 * freezes the toast at the last state it showed and settles it — the same <Toast> becomes the cancelled or failed one.
 */
export function followBackup(toast: Pick<ProgressToast, 'begin' | 'end' | 'settle'>, get: () => JobProgress, set: (p: JobProgress) => void): (p: JobProgress) => void {
  return (p) => {
    if (p.kind !== 'backup') return;
    const before = get();
    set(p);
    if (before.state === 'idle' && p.state !== 'idle') toast.begin(false);
    else if (before.state !== 'idle' && p.state === 'idle') toast.settle(toast.end(before), backupResult(p));
  };
}

/** The backup's progress toast in this window: one controller, as there is one toast queue (as the import's). */
const backupToast = createProgressToast('backup', {
  add: (job) => showJobToast(job),
  close: closeToast,
  show: (data) => void showToast(data),
  setView: (key, view) => useJobProgress.getState().setView(key, view),
});
const follow = followBackup(backupToast, () => useJobProgress.getState().backup, (p) => useJobProgress.getState().setBackup(p));

/** main's backup on the work line (job:progress), followed into the store and the toast. */
export function useBackupJob(): void {
  useLearnEvent('job:progress', follow);
}
