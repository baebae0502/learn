import { useCallback } from 'react';
import type { ImportOutcome, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { showToast } from '../ui/toasts';
import { failureLines, settleImport, type ImportFlowDeps } from './import-flow';

/** Runs one import end to end: dialog/copy in main, duplicate questions, result toasts; commands stay disabled meanwhile. */
export function useImport(confirm: ImportFlowDeps['confirm']) {
  const setImporting = useShell((s) => s.setImporting);
  const setView = useShell((s) => s.setView);
  return useCallback(
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode) => {
      setImporting(true);
      try {
        const outcomes = await unwrap(request());
        const report = await settleImport(outcomes, mode, {
          confirm,
          importAgain: (path, m) => unwrap(api().library.import({ paths: [path], mode: m, allowDuplicate: true })),
        });
        if (report.imported > 0) showToast({ kind: 'success', title: (mode === 'linked' ? t.toast.linked : t.toast.imported)(report.imported), testId: 'import-done' });
        if (report.failed.length > 0) showToast({ kind: 'error', title: t.toast.failedTitle(report.failed.length), body: failureLines(report.failed), testId: 'import-failures' });
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
