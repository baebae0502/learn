import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { currentPlatform } from '../ui/platform';

/**
 * 중복 N묶음 모두 정리 (M6 spec 5, 11.1): the 중복 항목 view's own button, left of 가져오기 (design-spec 2.4: the pane
 * header's actions are secondary buttons), while two groups or more are left — one group is the row menu's. It runs the
 * registry command, as the palette does.
 */
export function KeepAllDuplicatesButton() {
  const { env, run, isEnabled } = useCommands();
  const groups = env.duplicateGroups ?? 0;
  if (env.view !== 'library' || env.scope !== 'duplicates' || groups < 2) return null;
  return (
    <Button testId="keep-all-duplicates" isDisabled={!isEnabled('duplicates.keepOneAll')} disabledReason={t.common.busy} onPress={() => void run('duplicates.keepOneAll')}>
      {commandLabel(commandById('duplicates.keepOneAll'), currentPlatform(), { duplicateGroups: groups })}
    </Button>
  );
}
