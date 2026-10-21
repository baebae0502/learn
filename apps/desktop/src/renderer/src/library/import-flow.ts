import type { ImportOutcome, StorageMode } from '@learn/domain';
import { t } from '../strings';

export type DuplicateChoice = 'open' | 'add' | 'skip';

export interface ImportReport {
  imported: number;
  failed: Array<{ name: string; message: string }>;
  /** The user chose 기존 자료 열기 for this existing item (the last such choice wins). */
  openItemId: string | null;
}

export interface ImportFlowDeps {
  /** Ask about one duplicate: Task 5 in-window dialog, Task 6 native sheet. */
  confirm(dup: { path: string; existingItemId: string }): Promise<DuplicateChoice>;
  /** Import one path again with allowDuplicate (새 자료로 추가). */
  importAgain(path: string, mode: StorageMode): Promise<ImportOutcome[]>;
}

const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

/** One import's outcomes → questions about duplicates (in order) → a report for the toasts. */
export async function settleImport(outcomes: readonly ImportOutcome[], mode: StorageMode, deps: ImportFlowDeps): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, failed: [], openItemId: null };
  const take = (list: readonly ImportOutcome[]) => {
    for (const o of list) {
      if (o.status === 'imported') report.imported++;
      else if (o.status === 'failed') report.failed.push({ name: fileName(o.path), message: o.message });
    }
  };
  take(outcomes);
  for (const o of outcomes) {
    if (o.status !== 'duplicate') continue;
    const choice = await deps.confirm({ path: o.path, existingItemId: o.existingItemId });
    if (choice === 'open') report.openItemId = o.existingItemId;
    if (choice !== 'add') continue;
    try {
      take(await deps.importAgain(o.path, mode));
    } catch (e) {
      // One failed re-import is one failed file: what was imported before it is still reported.
      report.failed.push({ name: fileName(o.path), message: (e as Error).message });
    }
  }
  return report;
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
