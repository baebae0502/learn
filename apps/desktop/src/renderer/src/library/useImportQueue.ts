import { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';
import { afterEditing } from '../inspector/editGuard';
import { useJobProgress } from '../jobs/jobProgress';
import { createProgressToast } from '../jobs/progressToast';
import { useShell } from '../state/shell-store';
import { afterPaintOr } from '../ui/afterPaint';
import { clearImportMarks, perfMark } from '../ui/perfMarks';
import { closeToast, showJobToast, showToast } from '../ui/toasts';
import { BUSY_MIN_MS, busyScreenSettled } from './busyScreen';
import { LIST_REFRESH_WAIT_MS, settledWithin } from './import-flow';
import { createImportRunner, type ImportRunner } from './importRunner';

declare global {
  interface Window {
    /** E2E only: tests/e2e/helpers.ts importPaths counts here the runs it starts; each runs with no busy screen or toast (Q-4b). */
    __learnQuietImports?: number;
  }
}

/** Whether the run that begins now is one of importPaths' (a normal run never finds the counter). */
function takeQuietImport(): boolean {
  const n = window.__learnQuietImports ?? 0;
  if (n <= 0) return false;
  window.__learnQuietImports = n - 1;
  return true;
}

/** The import's progress toast in this window: one controller, as there is one toast queue. */
const importProgressToast = createProgressToast('import', {
  add: (job) => showJobToast(job),
  close: closeToast,
  show: (data) => void showToast(data),
  setView: (key, view) => useJobProgress.getState().setView(key, view),
});

/**
 * Main's import queue for the main window (spec 3): its notices into the job store and the runner, 기존 자료 열기 into
 * the reader. `panelOpen`: 파일 가져오기…'s open panel is up (it holds the window, as 다시 연결…'s does).
 */
export function useImportQueue(collectionName: (id: string) => string | null): { runner: ImportRunner; panelOpen: boolean } {
  const [panelOpen, setPanel] = useState(false);
  const names = useRef(collectionName);
  names.current = collectionName;
  const setView = useShell((s) => s.setView);
  const runner = useMemo(
    () =>
      createImportRunner({
        importPaths: (input) => api().library.import(input),
        pickAndImport: (input) => api().library.pickAndImport(input),
        sending: (delta) => useJobProgress.getState().addSending(delta),
        settling: (delta) => useJobProgress.getState().addSettling(delta),
        setQuiet: (quiet) => useJobProgress.getState().setQuiet(quiet),
        setPanel,
        showToast: (data) => void showToast(data),
        // The read libraryChanged{import} started is awaited, not cancelled for a second one (cancelRefetch: false).
        refreshList: () => settledWithin(queryClient.refetchQueries({ queryKey: keys.items, type: 'active' }, { cancelRefetch: false }), LIST_REFRESH_WAIT_MS),
        screenSettled: async () => {
          // The busy text may have just turned and not yet painted: one frame first, so the toast never comes before it.
          await new Promise<void>((resolve) => afterPaintOr(100, resolve));
          await settledWithin(busyScreenSettled(), BUSY_MIN_MS + 200);
        },
        collectionName: (id) => names.current(id),
        takeQuiet: takeQuietImport,
        toast: importProgressToast,
        mark: perfMark,
        clearMarks: clearImportMarks,
      }),
    [],
  );
  useLearnEvent('import:progress', (state) => {
    useJobProgress.getState().setImport(state);
    runner.progress(state);
  });
  useLearnEvent('import:finished', ({ report }) => void runner.finished(report));
  // Not item.open through the registry: the question's sheet may still hold this window when the request comes.
  useLearnEvent('item:openRequested', ({ itemId }) => afterEditing(() => setView({ kind: 'reader', itemId })));
  return { runner, panelOpen };
}
