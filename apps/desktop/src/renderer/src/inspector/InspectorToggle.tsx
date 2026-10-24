import { PanelRight } from 'lucide-react';
import { commandById, commandLabel } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { INSPECTOR_TOGGLE_ID } from '../shell/useInspector';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { currentPlatform } from '../ui/platform';

/**
 * The toolbar's last control (design-spec 2.4, library.html libraryHeader): on = --fill-pressed. Named by what a press
 * does now, as the 보기 menu says it (항목 패널 가리기 / 항목 패널 보기); disabled with the reason while work holds the window.
 */
export function InspectorToggle() {
  const { env, run, isEnabled } = useCommands();
  const shown = env.inspector === 'shown';
  const command = commandById('view.toggleInspector');
  return (
    <IconButton
      id={INSPECTOR_TOGGLE_ID}
      icon={PanelRight}
      label={commandLabel(command, currentPlatform(), { inspector: shown ? 'shown' : 'hidden' })}
      accelerator={command.accelerator}
      isOn={shown}
      onPress={() => run('view.toggleInspector')}
      isDisabled={!isEnabled('view.toggleInspector')}
      disabledReason={t.common.busy}
      aria-expanded={shown}
      aria-controls="inspector"
      testId={INSPECTOR_TOGGLE_ID}
    />
  );
}
