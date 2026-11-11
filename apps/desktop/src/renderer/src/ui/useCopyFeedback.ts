import { useEffect, useState } from 'react';
import { t } from '../strings';
import { showToast } from './toasts';

/** How long a copy button says 복사했습니다 (spec §5.3). */
export const COPIED_MS = 1500;

/**
 * Copy to the clipboard with the tooltip's confirmation: `copied` is true for 1.5 s after a copy, and no toast. A refusal of the
 * clipboard logs its error name only and says so in a toast.
 */
export function useCopyFeedback(logTag: string): { copied: boolean; copy(value: string): void } {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (value: string): void => {
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      (e: unknown) => {
        console.warn(`[${logTag}] copy failed: ${(e as Error)?.name ?? 'Error'}`);
        showToast({ kind: 'error', title: t.inspector.copyFailedTitle, body: t.inspector.copyFailedBody, testId: 'copy-failed' });
      },
    );
  };
  return { copied, copy };
}
