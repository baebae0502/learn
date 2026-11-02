import type { ImportReport } from '@learn/domain';
import { t } from '../strings';
import type { ToastData } from '../ui/toasts';

/**
 * The result toast of an import run (spec 3.3, 3.7), from main's report: the plain sentence; when every imported item went
 * into the collection the run asked for, the sentence naming it, with the existing items 건너뛰기 filed there as a line; a
 * run stopped by 취소 says how many of the files put in came in and how many it left out. Null when there is nothing to say.
 */
export function importToast(report: ImportReport, into: { name: string } | null): ToastData | null {
  const linked = report.mode === 'linked';
  const existing = into !== null && report.filedExisting > 0 ? t.toast.filedExisting(into.name, report.filedExisting) : null;
  let title: string | null = null;
  let body: string | undefined;
  if (report.cancelled) {
    if (report.imported > 0) {
      title = (linked ? t.toast.linkedOf : t.toast.importedOf)(report.requested, report.imported);
      if (report.untouched > 0) body = (linked ? t.toast.cancelledRestLinked : t.toast.cancelledRest)(report.untouched);
    } else {
      title = t.toast.importCancelled;
      if (report.untouched > 0) body = t.toast.cancelledNone(report.untouched);
    }
  } else if (report.imported > 0) {
    const filedInto = into !== null && report.filed === report.imported ? into : null;
    title = filedInto ? (linked ? t.toast.linkedInto : t.toast.importedInto)(filedInto.name, report.imported) : (linked ? t.toast.linked : t.toast.imported)(report.imported);
  }
  if (title === null && existing === null) return null;
  // Stopped with nothing in: said plainly, not as a success (Q-4j).
  const kind = report.cancelled && report.imported === 0 ? 'info' : 'success';
  return { kind, title: title ?? existing!, ...(title !== null && existing !== null ? { lines: [existing] } : {}), ...(body !== undefined ? { body } : {}), testId: 'import-done' };
}

/** "원인. 다음 행동." → [cause, next step]; a message without a second sentence has no next step. */
const splitMessage = (m: string): [string, string] => {
  const i = m.indexOf('. ');
  return i < 0 ? [m, ''] : [m.slice(0, i + 1), m.slice(i + 2)];
};

/** A failure toast row: the file name (cut first when the row is too long) and its cause (kept visible). */
export interface FailureLine {
  name: string;
  cause: string;
}

/**
 * Failure toast body: one name + cause row per file (at most `max`, then the plain line "외 N개"), and the next steps
 * once each after the list, so five files with the same cause do not repeat the same advice five times.
 */
export function failureLines(failed: ImportReport['failed'], max = 3): { lines: Array<FailureLine | string>; hints: string[] } {
  const lines: Array<FailureLine | string> = failed.slice(0, max).map((f) => ({ name: f.name, cause: splitMessage(f.message)[0] }));
  if (failed.length > max) lines.push(t.toast.more(failed.length - max));
  const hints = [...new Set(failed.map((f) => splitMessage(f.message)[1]).filter(Boolean))];
  return { lines, hints };
}

/** How long a run's end waits for the list to show what it brought before its toast comes anyway (re-review minor 2). */
export const LIST_REFRESH_WAIT_MS = 3000;

/** Resolves when `work` settles (either way) or after `ms`, whichever is first: a list read that never answers holds nothing. */
export async function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    await Promise.race([settled, limit]);
  } finally {
    clearTimeout(timer);
  }
}
