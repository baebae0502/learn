import { useCallback } from 'react';
import type { ImportOutcome, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { afterEditing } from '../inspector/editGuard';
import { inChunks } from '../organize/membership';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import type { ImportTarget } from '../sidebar/importTarget';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { afterPaintOr } from '../ui/afterPaint';
import { clearImportMarks, perfMark } from '../ui/perfMarks';
import { showToast } from '../ui/toasts';
import { BUSY_MIN_MS, busyScreenSettled } from './busyScreen';
import { LIST_REFRESH_WAIT_MS, failureLines, importToast, settleImport, settledWithin, type ImportFlowDeps } from './import-flow';

/** Runs one import end to end: dialog/copy in main, duplicate questions, result toasts; commands stay disabled meanwhile. */
export function useImport(confirm: ImportFlowDeps['confirm']) {
  const setImporting = useShell((s) => s.setImporting);
  const setView = useShell((s) => s.setView);
  return useCallback(
    /** `count`: how many files the request brings in, when known before it runs (a drop). `into`: the collection the request files into. */
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode, count?: number, into: ImportTarget | null = null) => {
      clearImportMarks();
      perfMark('import:start');
      setImporting(true, count ?? null);
      try {
        const outcomes = await unwrap(request());
        perfMark('import:answered');
        const report = await settleImport(
          outcomes,
          mode,
          {
            confirm,
            importAgain: (path, m, collectionId) => unwrap(api().library.import({ paths: [path], mode: m, allowDuplicate: true, ...(collectionId ? { collectionId } : {}) })),
            fileExisting: async (collectionId, itemIds) => {
              let filed = 0;
              for (const chunk of inChunks([...itemIds])) filed += (await unwrap(api().collections.addItems({ collectionId, itemIds: chunk }))).length;
              return filed;
            },
          },
          into?.id ?? null,
        );
        // The import ends when the list shows what it brought: otherwise the empty library's own screen (with its
        // buttons) flashes between the busy screen and the first rows (critique T13R2-m1).
        // At most LIST_REFRESH_WAIT_MS: a wedged list read must never hold the import (and the window) for good.
        if (report.imported > 0) await settledWithin(queryClient.invalidateQueries({ queryKey: keys.items }), LIST_REFRESH_WAIT_MS);
        perfMark('import:listed');
        // A busy text that has just appeared holds the rows its minimum time: the toast waits with them (busyScreen.ts).
        // A drop's busy screen may have just turned to its text, not yet committed: one painted frame first, so the
        // toast never comes a frame before the text (re-review m-N4).
        if (count !== undefined) await new Promise<void>((resolve) => afterPaintOr(100, resolve));
        await settledWithin(busyScreenSettled(), BUSY_MIN_MS + 200);
        const done = importToast(report, mode, into);
        if (done) showToast(done);
        if (report.failed.length > 0) {
          const { lines, hints } = failureLines(report.failed);
          showToast({ kind: 'error', title: t.toast.failedTitle(report.failed.length), lines, body: hints.join(' ') || undefined, testId: 'import-failures' });
        }
        // Not item.open through the registry: the user picked 기존 자료 열기 inside this import's own question, while the
        // import still holds the window (blocked), so the command would refuse. It is the import's result, not a new command.
        if (report.openItemId) {
          const itemId = report.openItemId;
          // An open 정보 편집 is asked first, as for every way into the reader.
          afterEditing(() => setView({ kind: 'reader', itemId }));
        }
      } catch (e) {
        showToast({ kind: 'error', title: t.toast.importFailed, body: (e as Error).message, testId: 'import-failures' });
      } finally {
        perfMark('import:end');
        setImporting(false);
      }
    },
    [confirm, setImporting, setView],
  );
}
