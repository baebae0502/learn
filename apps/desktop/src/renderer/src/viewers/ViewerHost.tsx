import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commandById, type LibraryItem } from '@learn/domain';
import { FileX } from 'lucide-react';
import { ApiError, api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { keys, useItem } from '../data/queries';
import { useLearnEvent } from '../events';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { MissingNotice } from './ReaderNotices';
import { readerLost, trashedAfter, type TrashedState } from './readerState';
import { TrashedNotice } from './TrashedNotice';
import { PdfReader } from './pdf/PdfReader';
import { type NoPages } from './pdf/readerStore';
import { ReaderScopeProvider, readerScopes, useReaderScope, useReaderShown } from './readerScope';
import { VideoViewer } from './VideoViewer';

/** One tab's reader: the document's scope shown to everything the reader mounts; `active` says whether the tab has the screen. */
export function ViewerHost({ itemId, active }: { itemId: string; active: boolean }) {
  const scope = readerScopes.get(itemId);
  return (
    <ReaderScopeProvider scope={scope} shown={active}>
      <Viewer itemId={itemId} />
    </ReaderScopeProvider>
  );
}

/** Picks the reader or the notice for one item. Relink and back go through the registry; the cache follows libraryChanged. */
function Viewer({ itemId }: { itemId: string }) {
  const scope = useReaderScope();
  // Every open re-checks the file (as M2 did), and nothing is decided from the cache until that read lands: a cached
  // item can be stale (invalidated since, or the file vanished without any libraryChanged), and deciding from it
  // would flash the reader's error or a missing notice before the fresh answer (review minor 1).
  const item = useItem(itemId, true);
  // A kept tab shown again re-checks the file as an open does (the file can vanish without any announcement); what the tab shows
  // stays until the answer, which only changes it when the file is gone or back.
  const shown = useReaderShown();
  const wasShown = useRef(shown);
  const { refetch } = item;
  useEffect(() => {
    if (shown && !wasShown.current) void refetch();
    wasShown.current = shown;
  }, [shown, refetch]);
  // Spec 4.6: moved to the trash while open — the notice; restored, it stays until the item reads again, then the reader opens here.
  const [trashed, setTrashed] = useState<TrashedState>('no');
  useLearnEvent('libraryChanged', (change) => setTrashed((s) => trashedAfter(s, change, itemId)));
  // Only the read this tab opens with counts (one moved to the trash while open reads as gone afterwards too). library.get
  // hides the trash, so a NOT_FOUND is asked again where the trash is visible: an item there keeps its tab and shows
  // the trash notice; one gone for good takes its tab with it.
  const removeTab = useShell((s) => s.removeTab);
  const firstReadSeen = useRef(false);
  // Cancelled only when this host goes away: a re-render while the answer is on its way must not drop it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (firstReadSeen.current || !item.isFetchedAfterMount) return;
    firstReadSeen.current = true;
    if (!(item.isError && item.error instanceof ApiError && item.error.code === 'NOT_FOUND')) return;
    api().library.detail({ itemId }).then(
      (r) => {
        if (!mounted.current) return;
        if (r.ok) setTrashed('yes');
        else if (r.code === 'NOT_FOUND') removeTab(itemId);
      },
      () => {},
    );
  }, [item.isFetchedAfterMount, item.isError, item.error, itemId, removeTab]);
  const readAgain = trashed === 'back' && item.isSuccess && !item.isFetching;
  useEffect(() => {
    if (readAgain) setTrashed('no');
  }, [readAgain]);
  const { run, isEnabled } = useCommands();
  // The path a linked file was last seen at (the notice's file line); a managed copy's path means nothing to the user.
  const linkedMissing = item.data?.availability === 'missing' && item.data.storageMode === 'linked';
  const detail = useQuery({ queryKey: keys.detail(itemId), queryFn: () => unwrap(api().library.detail({ itemId })), enabled: linkedMissing });
  // Only the kind is taken from the list while the fresh read is on its way: a kind never changes, so the reader's own
  // frame can paint at once (the dark video stage, the PDF reader's strip and sunken stage) instead of the empty white
  // column (T13-m6). Nothing else is decided from the cache.
  const cachedType = useQueryClient().getQueryData<LibraryItem[]>(keys.items)?.find((x) => x.id === itemId)?.type;
  // What the reader's sidebar says about the pages: gone with the trash, or nothing to show here (a video, a lost or missing file).
  const noPages: NoPages | null =
    trashed !== 'no' ? 'trashed' : !item.isFetchedAfterMount ? null : readerLost(item) || !item.data || item.data.availability === 'missing' || item.data.type !== 'pdf' ? 'none' : null;
  useEffect(() => {
    scope.reader.getState().setNoPages('host', noPages);
    return () => scope.reader.getState().setNoPages('host', null);
  }, [noPages, scope]);
  if (trashed !== 'no') return <TrashedNotice itemId={itemId} />;
  if (!item.isFetchedAfterMount) return <ReaderFrame type={cachedType} />; // transient: one IPC round trip
  if (readerLost(item)) {
    // The item itself could not be read (deleted meanwhile, or the library went away): main's message is Korean. A re-read
    // that failed otherwise keeps the reader (spec 4.6).
    return (
      <div className="reader-stage">
        <div className="stage-center">
          <Notice
            icon={FileX}
            title={t.reader.openFailedTitle}
            testId="open-failed"
            actions={
              <Button testId="open-failed-back" isDisabled={!isEnabled('nav.back')} disabledReason={t.common.busy} onPress={() => run('nav.back')}>
                {t.reader.backToLibrary}
              </Button>
            }
          >
            {item.error?.message}
          </Notice>
        </div>
      </div>
    );
  }
  if (!item.data) return null;
  if (item.data.availability === 'missing') {
    // One IPC round trip: the notice appears with its file line, no shift, on the stage it will have.
    if (linkedMissing && detail.isPending) return <div className="reader-stage" aria-hidden="true" />;
    return <MissingNotice item={item.data} externalPath={detail.data?.file.externalPath ?? null} />;
  }
  return item.data.type === 'pdf' ? <PdfReader key={item.data.id} item={item.data} /> : <VideoViewer key={item.data.id} item={item.data} />;
}

/**
 * The reader's empty frame for a kind while its item is being read: the same stage colours and the same 44 px strip as
 * the reader that follows, with no controls in it (nothing to press yet). Unknown kind: nothing.
 */
function ReaderFrame({ type }: { type: LibraryItem['type'] | undefined }) {
  if (type === 'video') return <div className="video-stage" aria-hidden="true" />;
  if (type === 'pdf') {
    return (
      <div className="reader" aria-hidden="true">
        <div className="reader-toolbar" />
        <div className="pdf-stage" />
      </div>
    );
  }
  return null;
}
