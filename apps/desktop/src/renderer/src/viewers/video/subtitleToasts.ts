import type { AttachFailureReason, AttachResult } from '@learn/domain';
import { t } from '../../strings';
import type { ToastData } from '../../ui/toasts';

/** What tells a person to try elsewhere: a subtitle with no video beside it. A file that is no subtitle only shows up where the person is already at a video (a drop or the picker), so its row's reason is the whole advice. */
const WRONG_PLACE: ReadonlySet<AttachFailureReason> = new Set(['unpaired']);

/** The next action under the failure rows, by what failed (spec 12); none for a failure that has no step of the person's. */
export function attachNextSteps(reasons: ReadonlySet<AttachFailureReason>): string | undefined {
  const unreadable = reasons.has('unreadable');
  const noCues = reasons.has('no-cues');
  const steps: string[] = [];
  if (unreadable && noCues) steps.push(t.video.nextBoth);
  else if (unreadable) steps.push(t.video.nextEncoding);
  else if (noCues) steps.push(t.video.nextFormat);
  if ([...reasons].some((r) => WRONG_PLACE.has(r))) steps.push(t.video.nextWhere);
  return steps.length > 0 ? steps.join(' ') : undefined;
}

/** The toasts of one attach (spec 5.4, 12): what was attached, a file that was on already, and the failures in one toast with a row each. */
export function attachToasts(result: AttachResult): ToastData[] {
  const toasts: ToastData[] = [];
  if (result.added.length > 0) toasts.push({ kind: 'success', title: t.video.attached(result.added.length), testId: 'subtitle-attached' });
  if (result.already.length > 0) toasts.push({ kind: 'info', title: t.video.alreadyAttached, testId: 'subtitle-already' });
  if (result.failed.length > 0) {
    const body = attachNextSteps(new Set(result.failed.map((f) => f.reason)));
    toasts.push({
      kind: 'error',
      title: t.video.attachFailedTitle(result.failed.length),
      lines: result.failed.map((f) => ({ name: f.name, cause: t.video.attachFailed[f.reason] })),
      ...(body !== undefined ? { body } : {}),
      testId: 'subtitle-failed',
    });
  }
  return toasts;
}
