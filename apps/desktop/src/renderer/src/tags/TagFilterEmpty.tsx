import { Tag } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';
import { currentPlatform } from '../ui/platform';
import { filterEmptyBody } from './filterEmptyBody';
import { focusTagStop } from './TagSelector';

/**
 * The table body when the chosen tags leave no item and nothing is typed in the search (spec 3.6): the registry's
 * 태그 선택 해제 as its one button. The button goes with the state, so the focus moves to the selector's chips.
 */
export function TagFilterEmpty() {
  const { run, isEnabled } = useCommands();
  const { model } = useOrganize();
  const filter = useLibrary((s) => s.tagFilter);
  const names = (model?.tags ?? []).filter((tag) => filter.has(tag.id)).map((tag) => tag.name);
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
