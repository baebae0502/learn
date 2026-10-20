import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, ImportOutcome, LibraryItem, Result, StorageMode } from '@learn/domain';
import { ApiError, api, unwrap } from './api';
import { DuplicateDialog } from './components/DuplicateDialog';
import { FatalScreen } from './components/FatalScreen';
import { LibraryView } from './components/LibraryView';
import { Sidebar } from './components/Sidebar';
import { TopBar, type SaveStatus } from './components/TopBar';
import { TutorPanel } from './components/TutorPanel';
import { t } from './strings';
import { ViewerHost } from './viewers/ViewerHost';

interface PendingDuplicate {
  path: string;
  existingItemId: string;
  mode: StorageMode;
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<PendingDuplicate[]>([]);
  const [failures, setFailures] = useState<Array<{ path: string; message: string }>>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [tutorOpen, setTutorOpen] = useState(true);
  const [bootError, setBootError] = useState<{ code: string; message: string } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => setItems(await unwrap(api().library.list())), []);

  const refreshSafe = useCallback(async () => {
    try {
      await refresh();
      setListError(null);
    } catch (e) {
      setListError(t.listRefreshFailed((e as Error).message));
      setStatus('error');
    }
  }, [refresh]);

  useEffect(() => {
    void (async () => {
      try {
        const i = await unwrap(api().app.info());
        setInfo(i);
        if (!i.libraryError) await refresh();
      } catch (e) {
        setBootError({ code: e instanceof ApiError ? e.code : 'INTERNAL', message: (e as Error).message });
      }
      setReady(true);
    })();
  }, [refresh]);

  const runImport = useCallback(
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode) => {
      setStatus('busy');
      let outcomes: ImportOutcome[];
      try {
        outcomes = await unwrap(request());
      } catch (e) {
        setFailures([{ path: '', message: (e as Error).message }]);
        setStatus('error');
        return;
      }
      {
        setDuplicates((q) => [
          ...q,
          ...outcomes.flatMap((o) => (o.status === 'duplicate' ? [{ path: o.path, existingItemId: o.existingItemId, mode }] : [])),
        ]);
        setFailures(outcomes.flatMap((o) => (o.status === 'failed' ? [{ path: o.path, message: o.message }] : [])));
        setStatus('idle');
        await refreshSafe();
      }
    },
    [refreshSafe],
  );

  if (bootError) return <FatalScreen code={bootError.code} message={bootError.message} libraryRoot={info?.libraryRoot ?? null} />;
  if (!info) return null;
  if (info.libraryError) return <FatalScreen code={info.libraryError.code} message={info.libraryError.message} libraryRoot={info.libraryRoot} />;

  const current = duplicates[0];
  const resolveDuplicate = (action: 'open' | 'add' | 'cancel') => {
    if (!current) return;
    setDuplicates((q) => q.slice(1));
    if (action === 'open') setOpenId(current.existingItemId);
    if (action === 'add') void runImport(() => api().library.import({ paths: [current.path], mode: current.mode, allowDuplicate: true }), current.mode);
  };

  return (
    <div className={`shell${tutorOpen ? '' : ' no-tutor'}`}>
      <TopBar status={status} />
      <Sidebar count={items.length} active={openId === null} onShowLibrary={() => setOpenId(null)} />
      <main className="center">
        {listError && <p className="error" role="alert" data-testid="list-error">{listError}</p>}
        {openId ? (
          <ViewerHost key={openId} itemId={openId} onBack={() => setOpenId(null)} onChanged={() => void refreshSafe()} />
        ) : (
          <LibraryView
            items={items}
            failures={failures}
            busy={status === 'busy'}
            onPick={(mode) => void runImport(() => api().library.pickAndImport({ mode }), mode)}
            onImportPaths={(paths, mode) => void runImport(() => api().library.import({ paths, mode }), mode)}
            onOpen={setOpenId}
          />
        )}
      </main>
      {tutorOpen ? (
        <TutorPanel onClose={() => setTutorOpen(false)} />
      ) : (
        <button className="tutor-toggle" data-testid="tutor-open" onClick={() => setTutorOpen(true)}>{t.openTutor}</button>
      )}
      {current && (
        <DuplicateDialog
          path={current.path}
          onOpenExisting={() => resolveDuplicate('open')}
          onAddAnyway={() => resolveDuplicate('add')}
          onCancel={() => resolveDuplicate('cancel')}
        />
      )}
      {ready && <div data-testid="app-ready" hidden />}
    </div>
  );
}
