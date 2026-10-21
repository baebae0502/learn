import { useQuery } from '@tanstack/react-query';
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
  const item = useItem(itemId);
  const { run, isEnabled } = useCommands();
  // The path a linked file was last seen at (the notice's file line); a managed copy's path means nothing to the user.
  const linkedMissing = item.data?.availability === 'missing' && item.data.storageMode === 'linked';
  const detail = useQuery({ queryKey: keys.detail(itemId), queryFn: () => unwrap(api().library.detail({ itemId })), enabled: linkedMissing });
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
                {t.reader.showLibrary}
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
    if (linkedMissing && detail.isPending) return null; // one IPC round trip: the notice appears with its file line, no shift
    return <MissingNotice item={item.data} externalPath={detail.data?.file.externalPath ?? null} />;
  }
  return item.data.type === 'pdf' ? <PdfViewer key={item.data.id} item={item.data} /> : <VideoViewer key={item.data.id} item={item.data} />;
}
