import { FileX, Image, Lock, Trash2 } from 'lucide-react';
import { acceleratorLabel, commandById, type ReaderNav } from '@learn/domain';
import { saveSetting } from '../../data/saveSetting';
import { t } from '../../strings';
import { currentPlatform } from '../../ui/platform';
import { PaneEmpty } from '../../ui/PaneEmpty';
import { Segmented } from '../../ui/Segmented';
import { OutlineTree } from './OutlineTree';
import { useReader, type NoPages } from './readerStore';
import { ThumbnailList } from './ThumbnailList';
import { useReaderNav } from './useReaderNav';

const hint = (accelerator: string | undefined) => (accelerator ? acceleratorLabel(accelerator, currentPlatform()) : '');

const EMPTY: Record<NoPages, { icon: typeof FileX; title: string }> = {
  trashed: { icon: Trash2, title: t.reader.noPagesTrashed },
  locked: { icon: Lock, title: t.reader.noPagesLocked },
  none: { icon: FileX, title: t.reader.noPages },
  image: { icon: Image, title: t.reader.noPagesImage },
};

/**
 * The sidebar while an item is read (spec 4.7): thumbnails or the outline under a segment, in the library sidebar's place and
 * of its width. Without pages to list (trash, password, nothing to show) it says why instead.
 */
export function ReaderSidebar() {
  const nav = useReaderNav();
  const noPages = useReader((s) => s.noPages.host ?? s.noPages.reader);
  const ready = useReader((s) => s.pdf?.ready === true);
  const thumbnails = commandById('reader.showThumbnails');
  const outline = commandById('reader.showOutline');
  const empty = noPages ? EMPTY[noPages] : null;
  // Without pages there is nothing to choose between: the message alone (reader-pdf.html ?state=locked|trashed). While the
  // document opens the segment stays, disabled (?state=loading).
  if (empty) {
    return (
      <div className="reader-sidebar" data-testid="reader-sidebar">
        <PaneEmpty icon={empty.icon} title={empty.title} top testId="reader-sidebar-empty" />
      </div>
    );
  }
  return (
    <div className="reader-sidebar" data-testid="reader-sidebar">
      <div className="reader-nav-head" data-testid="reader-nav">
        <Segmented<ReaderNav>
          fill
          aria-label={t.reader.navLabel}
          value={nav}
          isDisabled={!ready || nav === null}
          onChange={(v) => saveSetting('reader.nav', v)}
          options={[
            { value: 'thumbnails', label: t.reader.thumbnails, title: `${thumbnails.label} ${hint(thumbnails.accelerator)}`, testId: 'reader-nav-thumbnails' },
            { value: 'outline', label: t.reader.outline, title: `${outline.label} ${hint(outline.accelerator)}`, testId: 'reader-nav-outline' },
          ]}
        />
      </div>
      {nav === 'outline' ? <OutlineTree /> : nav === 'thumbnails' ? <ThumbnailList /> : null}
    </div>
  );
}
