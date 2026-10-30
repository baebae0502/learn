import type { DuplicateChoice, ImportOutcome, StorageMode } from '@learn/domain';
import { t } from '../strings';
import type { ToastData } from '../ui/toasts';

export type { DuplicateChoice } from '@learn/domain';

export interface ImportReport {
  imported: number;
  /** Of `imported`, the items that went into the collection asked for (the outcome carries `collectionId` only then). */
  filed: number;
  /** Existing items put into that collection because 가져오지 않음 was chosen for their duplicates: the ones it did not have yet. */
  filedExisting: number;
  failed: Array<{ name: string; message: string }>;
  /** The user chose 기존 자료 열기 for this existing item (the last such choice wins). */
  openItemId: string | null;
}

export interface ImportFlowDeps {
  /** Ask about one duplicate (the native duplicate sheet, ui.confirmDuplicate). */
  confirm(dup: { path: string; existingItemId: string }): Promise<DuplicateChoice>;
  /** Import one path again with allowDuplicate (새 자료로 추가), into the collection when one was asked for. */
  importAgain(path: string, mode: StorageMode, collectionId: string | null): Promise<ImportOutcome[]>;
  /** collections.addItems: how many of these items the collection did not have yet. */
  fileExisting(collectionId: string, itemIds: readonly string[]): Promise<number>;
}

const fileName = (p: string) => p.split(/[\\/]/).pop() || p;

/**
 * One import's outcomes → questions about duplicates (in order) → a report for the toasts. With a collection asked for, an
 * existing item whose duplicate was left out ("가져오지 않음") goes into it too, in one call after the questions.
 */
export async function settleImport(outcomes: readonly ImportOutcome[], mode: StorageMode, deps: ImportFlowDeps, collectionId: string | null = null): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null };
  const take = (list: readonly ImportOutcome[]) => {
    for (const o of list) {
      if (o.status === 'imported') {
        report.imported++;
        if (o.collectionId !== undefined) report.filed++;
      } else if (o.status === 'failed') report.failed.push({ name: fileName(o.path), message: o.message });
    }
  };
  take(outcomes);
  const left: string[] = [];
  for (const o of outcomes) {
    if (o.status !== 'duplicate') continue;
    const choice = await deps.confirm({ path: o.path, existingItemId: o.existingItemId });
    if (choice === 'open') report.openItemId = o.existingItemId;
    if (choice === 'skip') left.push(o.existingItemId);
    if (choice !== 'add') continue;
    try {
      take(await deps.importAgain(o.path, mode, collectionId));
    } catch (e) {
      // One failed re-import is one failed file: what was imported before it is still reported.
      report.failed.push({ name: fileName(o.path), message: (e as Error).message });
    }
  }
  if (collectionId !== null && left.length > 0) {
    try {
      report.filedExisting = await deps.fileExisting(collectionId, left);
    } catch (e) {
      // The files were handled as asked; only the sentence about the collection is left unsaid.
      console.warn(`[import] filing the existing items failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`);
    }
  }
  return report;
}

/**
 * The success toast of an import (spec 3.7): the plain sentence, or — when every imported item went into the collection asked
 * for — the sentence naming it, and under it the existing items 가져오지 않음 put there. Null when there is nothing to say.
 */
export function importToast(report: ImportReport, mode: StorageMode, into: { name: string } | null): ToastData | null {
  const filedInto = into !== null && report.imported > 0 && report.filed === report.imported ? into : null;
  const title =
    report.imported === 0
      ? null
      : filedInto
        ? (mode === 'linked' ? t.toast.linkedInto : t.toast.importedInto)(filedInto.name, report.imported)
        : (mode === 'linked' ? t.toast.linked : t.toast.imported)(report.imported);
  const existing = into !== null && report.filedExisting > 0 ? t.toast.filedExisting(into.name, report.filedExisting) : null;
  if (title === null && existing === null) return null;
  return { kind: 'success', title: title ?? existing!, ...(title !== null && existing !== null ? { lines: [existing] } : {}), testId: 'import-done' };
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

/** How long an import waits for the list to show what it brought before it ends anyway (re-review minor 2). */
export const LIST_REFRESH_WAIT_MS = 3000;

/**
 * Resolves when `work` settles (either way) or after `ms`, whichever is first: a list read that never answers cannot
 * hold the import, and with it the window's commands, for good.
 */
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
