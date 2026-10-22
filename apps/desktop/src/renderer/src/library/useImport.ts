import { useCallback } from 'react';
import type { ImportOutcome, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { showToast } from '../ui/toasts';
import { failureLines, settleImport, type ImportFlowDeps } from './import-flow';

/** Runs one import end to end: dialog/copy in main, duplicate questions, result toasts; commands stay disabled meanwhile. */
export function useImport(confirm: ImportFlowDeps['confirm']) {
  const setImporting = useShell((s) => s.setImporting);
  const setView = useShell((s) => s.setView);
  return useCallback(
    /** `count`: how many files the request brings in, when known before it runs (a drop). */
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode, count?: number) => {
      setImporting(true, count ?? null);
      try {
        const outcomes = await unwrap(request());
        const report = await settleImport(outcomes, mode, {
          confirm,
          importAgain: (path, m) => unwrap(api().library.import({ paths: [path], mode: m, allowDuplicate: true })),
        });
        // The import ends when the list shows what it brought: otherwise the empty library's own screen (with its
        // buttons) flashes between the busy screen and the first rows (critique T13R2-m1).
        if (report.imported > 0) await queryClient.invalidateQueries({ queryKey: keys.items });
        if (report.imported > 0) showToast({ kind: 'success', title: (mode === 'linked' ? t.toast.linked : t.toast.imported)(report.imported), testId: 'import-done' });
        if (report.failed.length > 0) {
          const { lines, hints } = failureLines(report.failed);
          showToast({ kind: 'error', title: t.toast.failedTitle(report.failed.length), lines, body: hints.join(' ') || undefined, testId: 'import-failures' });
        }
        // Not item.open through the registry: the user picked 기존 자료 열기 inside this import's own question, while the
        // import still holds the window (blocked), so the command would refuse. It is the import's result, not a new command.
        if (report.openItemId) setView({ kind: 'reader', itemId: report.openItemId });
      } catch (e) {
        showToast({ kind: 'error', title: t.toast.importFailed, body: (e as Error).message, testId: 'import-failures' });
      } finally {
        setImporting(false);
      }
    },
    [confirm, setImporting, setView],
  );
}
