import { useMemo } from 'react';
import { useCommands } from '../commands/CommandProvider';
import { useOrganize } from '../organize/useOrganize';
import { t } from '../strings';
import { MenuButton } from '../ui/MenuButton';
import { addToCollectionEntries, collectionOfKey } from './addToCollectionMenu';

/**
 * 컬렉션에 추가 ▾ (spec 6.2, design-spec 7.3): the web menu in the head of a several-item selection. Every row is the
 * registry command 컬렉션에 추가 with a value (the collection, or a new one), run on the whole selection.
 */
export function AddToCollectionButton({ ids }: { ids: readonly string[] }) {
  const { model } = useOrganize();
  const { run, isEnabled } = useCommands();
  const entries = useMemo(() => (model ? addToCollectionEntries(model, ids) : []), [model, ids]);
  if (!model) return null;
  const enabled = isEnabled('collection.addItems', { itemIds: ids });
  return (
    <div className="actions">
      <MenuButton
        label={t.organize.panel.addToCollection}
        items={entries}
        testId="add-to-collection"
        isDisabled={!enabled}
        disabledReason={t.common.busy}
        onAction={(key) => {
          const collectionId = collectionOfKey(key);
          run('collection.addItems', { itemIds: ids, args: collectionId === null ? { addSelection: true } : { collectionId } });
        }}
      />
    </div>
  );
}
