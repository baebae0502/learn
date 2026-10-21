import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppInfo, ImportOutcome, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { CommandProvider } from '../commands/CommandProvider';
import { runPicked, type CommandEnv } from '../commands/registry';
import { useReportContext } from '../commands/useReportContext';
import { useMenuCommands } from '../commands/useMenuCommands';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { LibraryView } from '../components/LibraryView';
import { keys, useItem, useItems, useLibrarySync } from '../data/queries';
import { queryClient } from '../data/query-client';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { Shell } from '../shell/Shell';
import { Toolbar } from '../shell/Toolbar';
import { usePanePersistence, useToggleSidebar } from '../shell/useSidebar';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { ViewerHost } from '../viewers/ViewerHost';

interface PendingDuplicate {
  path: string;
  existingItemId: string;
  mode: StorageMode;
}

function ReaderTitle({ itemId }: { itemId: string }) {
  const item = useItem(itemId);
  return <Toolbar title={item.data?.title ?? ''} />;
}

export function MainWindow(_props: { info: AppInfo }) {
  useLibrarySync();
  usePanePersistence();
  const items = useItems();
  const view = useShell((s) => s.view);
  const setView = useShell((s) => s.setView);
  const importing = useShell((s) => s.importing);
  const setImporting = useShell((s) => s.setImporting);
  const toggleSidebar = useToggleSidebar();
  const [duplicates, setDuplicates] = useState<PendingDuplicate[]>([]);
  const [failures, setFailures] = useState<Array<{ path: string; message: string }>>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  // Cold-start mark (Task 13 perf): the first render in which the library list has settled, not the mount (R-18).
  const readyAt = useRef(0);
  if (readyAt.current === 0 && (items.isSuccess || items.isError)) readyAt.current = Date.now();

  const runImport = useCallback(
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode) => {
      setImporting(true);
      try {
        const outcomes = await unwrap(request());
        setDuplicates((q) => [...q, ...outcomes.flatMap((o) => (o.status === 'duplicate' ? [{ path: o.path, existingItemId: o.existingItemId, mode }] : []))]);
        setFailures(outcomes.flatMap((o) => (o.status === 'failed' ? [{ path: o.path, message: o.message }] : [])));
      } catch (e) {
        setFailures([{ path: '', message: (e as Error).message }]);
      } finally {
        setImporting(false);
      }
    },
    [setImporting],
  );

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
      setActionError((e as Error).message);
    }
  }, []);

  const list = items.data ?? [];
  const env: CommandEnv = {
    view: view.kind === 'reader' ? 'viewer' : 'library',
    blocked: importing || duplicates.length > 0,
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
    setActionError(null);
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'item', itemIds: [itemId], x, y }));
      if (picked) runPicked(picked.commandId, envRef.current, [itemId]);
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  const current = duplicates[0];
  const resolveDuplicate = (action: 'open' | 'add' | 'cancel') => {
    if (!current) return;
    setDuplicates((q) => q.slice(1));
    if (action === 'open') setView({ kind: 'reader', itemId: current.existingItemId });
    if (action === 'add') void runImport(() => api().library.import({ paths: [current.path], mode: current.mode, allowDuplicate: true }), current.mode);
  };

  const count = items.data?.length ?? 0;
  const toolbar = view.kind === 'reader' ? <ReaderTitle itemId={view.itemId} /> : <Toolbar title={t.shell.myLibrary} count={count > 0 ? t.shell.count(count) : undefined} />;

  return (
    <CommandProvider env={env}>
      <Shell sidebar={<LibrarySidebar count={count} />} toolbar={toolbar}>
        {items.isError && <p className="error" role="alert" data-testid="list-error">{t.shell.listFailed}</p>}
        {actionError && <p className="error" role="alert" data-testid="action-error">{actionError}</p>}
        {view.kind === 'reader' ? (
          <ViewerHost key={view.itemId} itemId={view.itemId} onBack={() => setView({ kind: 'library' })} />
        ) : (
          <LibraryView
            items={items.data ?? []}
            failures={failures}
            busy={importing}
            onPick={(mode) => void runImport(() => api().library.pickAndImport({ mode }), mode)}
            onImportPaths={(paths, mode) => void runImport(() => api().library.import({ paths, mode }), mode)}
            onOpen={(itemId) => setView({ kind: 'reader', itemId })}
            onItemContextMenu={(itemId, x, y) => void showItemMenu(itemId, x, y)}
          />
        )}
      </Shell>
      {current && (
        <DuplicateDialog path={current.path} onOpenExisting={() => resolveDuplicate('open')} onAddAnyway={() => resolveDuplicate('add')} onCancel={() => resolveDuplicate('cancel')} />
      )}
      {(items.isSuccess || items.isError) && <div data-testid="app-ready" data-at={readyAt.current} hidden />}
    </CommandProvider>
  );
}
