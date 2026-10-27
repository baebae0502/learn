import { FolderPlus } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { RootDropArea } from '../dnd/rootDrop';
import { t } from '../strings';
import { IconButton } from '../ui/Button';

/**
 * The "컬렉션" label with its one button (spec 3.3): the heading of the tree's second section while there are collections,
 * and — with none, when the tree has no such section — the same two elements on their own above the hint. The button is not
 * a Tab stop (the sidebar's Tab order is the tree, then the tag filter): its keys are ⇧⌘N and the palette.
 * `dropRoot`: the tree's heading takes a collection dropped on it (spec 8.3: it becomes top-level); the standalone one has nothing to take.
 */
export function CollectionsHeading({ dropRoot = false }: { dropRoot?: boolean }) {
  const { run, isEnabled } = useCommands();
  const body = (
    <>
      <span className="heading-label" data-testid="collections-heading">
        {t.organize.sidebar.collections}
      </span>
      <span className="spacer" />
      <IconButton
        icon={FolderPlus}
        size="small"
        label={t.organize.sidebar.newTip}
        accelerator={commandById('collection.new').accelerator}
        excludeFromTabOrder
        isDisabled={!isEnabled('collection.new')}
        testId="new-collection"
        onPress={() => void run('collection.new')}
      />
    </>
  );
  return dropRoot ? <RootDropArea>{body}</RootDropArea> : body;
}
