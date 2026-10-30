import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useItems } from '../data/queries';
import { useOrganize } from '../organize/useOrganize';
import { useScopeView } from '../library/useScopeView';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { currentPlatform } from '../ui/platform';
import { chosenTagNames, filterEmptyBody } from './filterEmptyBody';
import { viewCounts } from './tagCloud';
import { focusTagStop } from './TagSelector';
import { useTagsSelector } from './useTagsSelector';

const NO_ITEMS: never[] = [];

/**
 * The table body when the chosen tags leave no item and nothing is typed in the search (spec 3.6): the registry's
 * 태그 선택 해제 as its one button. The button goes with the state, so the focus moves to the selector's chips.
 */
export function TagFilterEmpty() {
  const { run, isEnabled } = useCommands();
  const { model } = useOrganize();
  const filter = useLibrary((s) => s.tagFilter);
  const { scoped } = useScopeView(useItems().data ?? NO_ITEMS);
  const { selector } = useTagsSelector();
  // The cloud's own order (colour slots, then the sort setting), so the line reads like the chips above it.
  const names = useMemo(
    () => (model ? chosenTagNames({ tags: model.tags, counts: viewCounts(model.tags, (id) => model.tagItems(id), new Set(scoped.map((i) => i.id))), filter, selector }) : []),
    [model, scoped, filter, selector],
  );
  return (
    <PaneEmpty
      icon={Tag}
      title={t.organize.tags.filterEmpty}
      top
      testId="tag-filter-empty"
      action={
        <Button
          testId="tag-filter-empty-clear"
          isDisabled={!isEnabled('tags.clearFilter')}
          disabledReason={t.common.busy}
          onPress={() => {
            run('tags.clearFilter');
            requestAnimationFrame(focusTagStop);
          }}
        >
          {commandLabel(commandById('tags.clearFilter'), currentPlatform())}
        </Button>
      }
    >
      {filterEmptyBody(names)}
    </PaneEmpty>
  );
}
