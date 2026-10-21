import { ChevronLeft } from 'lucide-react';
import { commandById, type LibraryItem } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useItem } from '../data/queries';
import { formatSize } from '../format';
import { Toolbar } from '../shell/Toolbar';
import { t } from '../strings';
import { IconButton } from '../ui/Button';

/** "PDF · 4.2 MB · 외부 연결": the toolbar's count while reading (no tab strip, no pane header until M7). */
const readerMeta = (item: LibraryItem): string =>
  [t.library.type[item.type], formatSize(item.size), item.storageMode === 'linked' ? t.reader.linkedMeta : null].filter(Boolean).join(' · ');

/** Unified toolbar while reading (no tab strip until M7): back to the library (⌘1), title, kind · size. */
export function ReaderToolbar({ itemId }: { itemId: string }) {
  const item = useItem(itemId).data;
  const { run } = useCommands();
  const back = commandById('nav.back');
  return (
    <Toolbar
      title={item?.title ?? ''}
      titleTestId="viewer-title"
      count={item ? readerMeta(item) : undefined}
      leading={<IconButton icon={ChevronLeft} label={back.label} accelerator={back.accelerator} testId="viewer-back" onPress={() => run('nav.back')} />}
    />
  );
}
