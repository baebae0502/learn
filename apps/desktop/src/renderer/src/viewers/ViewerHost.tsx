import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commandById, type LibraryItem } from '@learn/domain';
import { FileX } from 'lucide-react';
import { api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { keys, useItem } from '../data/queries';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { PdfViewer } from './PdfViewer';
import { MissingNotice } from './ReaderNotices';
import { VideoViewer } from './VideoViewer';

/** Picks the reader or the notice for one item. Relink and back go through the registry; the cache follows libraryChanged. */
export function ViewerHost({ itemId }: { itemId: string }) {
  // Every open re-checks the file (as M2 did), and nothing is decided from the cache until that read lands: a cached
  // item can be stale (invalidated since, or the file vanished without any libraryChanged), and deciding from it
  // would flash the reader's error or a missing notice before the fresh answer (review minor 1).
  const item = useItem(itemId, true);
  const { run, isEnabled } = useCommands();
  // The path a linked file was last seen at (the notice's file line); a managed copy's path means nothing to the user.
  const linkedMissing = item.data?.availability === 'missing' && item.data.storageMode === 'linked';
  const detail = useQuery({ queryKey: keys.detail(itemId), queryFn: () => unwrap(api().library.detail({ itemId })), enabled: linkedMissing });
  // Only the kind is taken from the list while the fresh read is on its way: a kind never changes, so the reader's own
  // frame can paint at once (the dark video stage, the PDF reader's strip and sunken stage) instead of the empty white
  // column (T13-m6). Nothing else is decided from the cache.
  const cachedType = useQueryClient().getQueryData<LibraryItem[]>(keys.items)?.find((x) => x.id === itemId)?.type;
  if (!item.isFetchedAfterMount) return <ReaderFrame type={cachedType} />; // transient: one IPC round trip
  if (item.isError) {
    // The item itself could not be read (deleted meanwhile, or the library went away): main's message is Korean.
    return (
      <div className="reader-stage">
        <div className="stage-center">
          <Notice
            icon={FileX}
            title={t.reader.openFailedTitle}
            testId="open-failed"
            actions={
              <Button testId="open-failed-back" isDisabled={!isEnabled('nav.back')} disabledReason={t.common.busy} onPress={() => run('nav.back')}>
                {commandById('nav.back').label}
              </Button>
            }
          >
            {item.error.message}
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
  return item.data.type === 'pdf' ? <PdfViewer key={item.data.id} item={item.data} /> : <VideoViewer key={item.data.id} item={item.data} />;
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
