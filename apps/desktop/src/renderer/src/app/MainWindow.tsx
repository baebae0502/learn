import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { AppInfo, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { CommandProvider } from '../commands/CommandProvider';
import { runCommand, runPicked, type CommandEnv } from '../commands/registry';
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
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
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
    (paths: string[], mode: StorageMode, unresolved: number) => {
      // Files without a location on disk are named in a toast; the others are still imported.
      if (unresolved > 0) showToast({ kind: 'error', title: t.toast.dropNoPathTitle(unresolved), body: t.toast.dropNoPathBody, testId: 'drop-failed' });
      if (paths.length > 0) void runImport(() => api().library.import({ paths, mode }), mode);
    },
    [runImport],
  );
  useWindowDrop(view.kind === 'library' && !importing, onDrop);

  // A failed refresh keeps the last list on screen and says so once (a StrictMode re-run sees the same error object).
  // A failed first read has no list to keep: the content column shows the list-failed notice instead (below).
  const shownListError = useRef<unknown>(null);
  const refreshFailed = items.isError && items.data !== undefined;
  useEffect(() => {
    if (!refreshFailed || shownListError.current === items.error) return;
    shownListError.current = items.error;
    showToast({ kind: 'error', title: t.shell.listFailed, body: items.error!.message, testId: 'list-error' });
  }, [refreshFailed, items.error]);

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

  /** Open from the list through the registry: refused while an import or a sheet holds the window (blocked). */
  const openFromList = useCallback((itemId: string) => runCommand('item.open', envRef.current, { itemIds: [itemId] }), []);

  const count = list.length;
  // First import from the first-run screen: focus was on its button, which left with the screen (focus fell to
  // <body>). Hand it to the first title, where the list continues; keyboard users keep their place.
  const emptyHadFocus = useRef(false);
  useLayoutEffect(() => {
    const hadFocus = emptyHadFocus.current;
    emptyHadFocus.current = false;
    if (!hadFocus || view.kind !== 'library' || count === 0) return;
    if (document.activeElement === null || document.activeElement === document.body) document.querySelector<HTMLElement>('[data-testid="open-item"]')?.focus();
  }, [view.kind, count]);

  const toolbar =
    view.kind === 'reader' ? (
      <ReaderTitle itemId={view.itemId} />
    ) : (
      <Toolbar title={t.shell.myLibrary} count={count > 0 ? t.shell.count(count) : undefined} actions={<ImportMenuButton />} />
    );
  // N-5: until the first list has arrived the count is unknown, not 0 — show neither the first-run screen nor the
  // list (no empty-library flash). A first read that failed says so where the list would be, with a retry.
  const library =
    items.data === undefined ? (
      items.isError ? (
        <div className="library-state">
          <Notice
            icon={CircleAlert}
            title={t.library.listFailed}
            testId="list-failed"
            actions={
              <Button variant="primary" testId="list-retry" onPress={() => void items.refetch()}>
                {t.common.retry}
              </Button>
            }
          >
            {items.error.message}
          </Notice>
        </div>
      ) : null
    ) : count === 0 ? (
      <EmptyLibrary focusOnLeave={emptyHadFocus} />
    ) : (
      <LibraryTable items={list} onOpen={openFromList} onContextMenu={(itemId, x, y) => void showItemMenu(itemId, x, y)} />
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
