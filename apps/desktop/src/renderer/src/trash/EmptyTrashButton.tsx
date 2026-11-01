import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Button } from '../ui/Button';

/** The trash view's head button (library.html?state=trash): the registry's 휴지통 비우기… (⇧⌘⌫), a secondary button — the sheet carries the danger. */
export function EmptyTrashButton() {
  const { run, isEnabled } = useCommands();
  return (
    <Button testId="trash-empty" isDisabled={!isEnabled('trash.empty')} disabledReason={t.common.busy} onPress={() => void run('trash.empty')}>
      {commandById('trash.empty').label}
    </Button>
  );
}
