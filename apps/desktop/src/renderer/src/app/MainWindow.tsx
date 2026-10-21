import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { CommandProvider } from '../commands/CommandProvider';
import { runPicked, type CommandEnv } from '../commands/registry';
import { useReportContext } from '../commands/useReportContext';
import { useMenuCommands } from '../commands/useMenuCommands';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { keys, useItem, useItems, useLibrarySync } from '../data/queries';
import { queryClient } from '../data/query-client';
import { EmptyLibrary } from '../library/EmptyLibrary';
import { ImportMenuButton } from '../library/ImportMenuButton';
import type { DuplicateChoice } from '../library/import-flow';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { LibraryTable } from '../library/LibraryTable';
import { useImport } from '../library/useImport';
import { Shell } from '../shell/Shell';
import { Toolbar } from '../shell/Toolbar';
import { usePanePersistence, useToggleSidebar } from '../shell/useSidebar';
import { useWindowDrop } from '../shell/useWindowDrop';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Toasts, showToast } from '../ui/toasts';
import { ViewerHost } from '../viewers/ViewerHost';

function ReaderTitle({ itemId }: { itemId: string }) {
  const item = useItem(itemId);
  return <Toolbar title={item.data?.title ?? ''} />;
}

/** A failed relink or context-menu call: the message comes from main and is already Korean (cause + next step). */
const actionFailed = (e: unknown) => showToast({ kind: 'error', title: t.toast.actionFailed, body: (e as Error).message, testId: 'action-error' });

export function MainWindow(_props: { info: AppInfo }) {
  useLibrarySync();
  usePanePersistence();
  const items = useItems();
  const view = useShell((s) => s.view);
  const setView = useShell((s) => s.setView);
  const importing = useShell((s) => s.importing);
  const toggleSidebar = useToggleSidebar();
  // Cold-start mark (Task 13 perf): the first render in which the library list has settled, not the mount (R-18).
  const readyAt = useRef(0);
  if (readyAt.current === 0 && (items.isSuccess || items.isError)) readyAt.current = Date.now();

  /** Task 5: the pre-M3 dialog, promise-based. Task 6 replaces it with the native duplicate sheet. */
  const [asking, setAsking] = useState<{ path: string; resolve(choice: DuplicateChoice): void } | null>(null);
  const confirm = useCallback((dup: { path: string; existingItemId: string }) => new Promise<DuplicateChoice>((resolve) => setAsking({ path: dup.path, resolve })), []);
  const answer = (choice: DuplicateChoice) => {
    asking?.resolve(choice);
    setAsking(null);
  };
  const runImport = useImport(confirm);

  const relink = useCallback(async (itemId: string) => {
    try {
      const item = await unwrap(api().library.get({ itemId }));
      if (item.storageMode !== 'linked') return;
      if (item.availability !== 'missing') {
        void queryClient.invalidateQueries({ queryKey: keys.items });
        return;
      }
      await unwrap(api().library.pickAndRelink({ assetId: item.assetId }));
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  const onDrop = useCallback(
    (paths: string[], mode: StorageMode) => {
      if (paths.length === 0) {
        showToast({ kind: 'error', title: t.toast.dropNoPathTitle, body: t.toast.dropNoPathBody, testId: 'drop-failed' });
        return;
      }
      void runImport(() => api().library.import({ paths, mode }), mode);
    },
    [runImport],
  );
  useWindowDrop(view.kind === 'library' && !importing, onDrop);

  // One toast per failed read (a StrictMode re-run of the effect sees the same error object).
  const shownListError = useRef<unknown>(null);
  useEffect(() => {
    if (!items.isError || shownListError.current === items.error) return;
    shownListError.current = items.error;
    showToast({ kind: 'error', title: t.shell.listFailed, body: items.error.message, testId: 'list-error' });
  }, [items.isError, items.error]);

  const list = items.data ?? [];
  const env: CommandEnv = {
    view: view.kind === 'reader' ? 'viewer' : 'library',
    // Duplicate questions wait inside the import, so `importing` covers them.
    blocked: importing,
    targetsOf: (ids) => ids.flatMap((id) => list.find((i) => i.id === id) ?? []),
    importFiles: (mode) => void runImport(() => api().library.pickAndImport({ mode }), mode),
    back: () => setView({ kind: 'library' }),
    open: (itemId) => setView({ kind: 'reader', itemId }),
    relink: (itemId) => void relink(itemId),
    toggleSidebar,
  };
  useMenuCommands(env);
  useReportContext(env);
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  });

  const showItemMenu = useCallback(async (itemId: string, x: number, y: number) => {
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'item', itemIds: [itemId], x, y }));
      if (picked) runPicked(picked.commandId, envRef.current, [itemId]);
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  const count = list.length;
  const toolbar =
    view.kind === 'reader' ? (
      <ReaderTitle itemId={view.itemId} />
    ) : (
      <Toolbar title={t.shell.myLibrary} count={count > 0 ? t.shell.count(count) : undefined} actions={<ImportMenuButton />} />
    );
  // N-5: until the first list has arrived the count is unknown, not 0 — show neither the first-run screen nor the
  // list (no empty-library flash). A first read that failed shows the list-error toast over the same blank column.
  const library =
    items.data === undefined ? null : count === 0 ? (
      <EmptyLibrary />
    ) : (
      <LibraryTable items={list} onOpen={(itemId) => setView({ kind: 'reader', itemId })} onContextMenu={(itemId, x, y) => void showItemMenu(itemId, x, y)} />
    );

  return (
    <CommandProvider env={env}>
      <Shell sidebar={<LibrarySidebar count={count} />} toolbar={toolbar} overlays={<Toasts />}>
        {view.kind === 'reader' ? <ViewerHost key={view.itemId} itemId={view.itemId} onBack={() => setView({ kind: 'library' })} /> : library}
      </Shell>
      {asking && <DuplicateDialog path={asking.path} onOpenExisting={() => answer('open')} onAddAnyway={() => answer('add')} onCancel={() => answer('skip')} />}
      {(items.isSuccess || items.isError) && <div data-testid="app-ready" data-at={readyAt.current} hidden />}
    </CommandProvider>
  );
}
