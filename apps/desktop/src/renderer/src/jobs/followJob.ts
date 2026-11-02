import type { JobProgress, JobProgressKind } from '@learn/domain';
import type { ToastData } from '../ui/toasts';
import type { ProgressToast } from './progressToast';

/**
 * A backup's or a restore's notices (job:progress) into the store and its one toast (P-3): a run's first busy notice
 * begins the toast, its end freezes the toast at the last state it showed and settles it with `result` — the same
 * <Toast> becomes the cancelled or failed one. Another job's notices pass by.
 */
export function followJob(
  kind: JobProgressKind,
  result: (p: JobProgress) => ToastData | null,
  toast: Pick<ProgressToast, 'begin' | 'end' | 'settle'>,
  get: () => JobProgress,
  set: (p: JobProgress) => void,
): (p: JobProgress) => void {
  return (p) => {
    if (p.kind !== kind) return;
    const before = get();
    set(p);
    if (before.state === 'idle' && p.state !== 'idle') toast.begin(false);
    else if (before.state !== 'idle' && p.state === 'idle') toast.settle(toast.end(before), result(p));
  };
}
