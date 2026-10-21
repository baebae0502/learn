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
    if (choice === 'add') take(await deps.importAgain(o.path, mode));
  }
  return report;
}

/** Toast body: one "name: reason" line per file, at most `max`, then "외 N개". */
export function failureLines(failed: ImportReport['failed'], max = 3): string {
  const lines = failed.slice(0, max).map((f) => `${f.name}: ${f.message}`);
  if (failed.length > max) lines.push(t.toast.more(failed.length - max));
  return lines.join('\n');
}
