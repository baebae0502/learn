import { Search } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import { ariaKeyShortcuts, commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { useDisabledReason, withoutPresses } from '../ui/disabledReason';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { Tooltip } from '../ui/Tooltip';

/**
 * ⌘K launcher: a field-shaped button that opens the palette (design-spec 6 검색 필드·실행기). Layout B: sidebar y
 * 52–80, x 8–231, its glyph on the row-icon column (x 24); with the sidebar folded, the toolbar's right end (232 × 28).
 * While an import or a sheet holds the window it is disabled with the reason, like the toolbar's 가져오기.
 */
export function Launcher({ testId = 'launcher' }: { testId?: string }) {
  const { run, isEnabled } = useCommands();
  const command = commandById('app.palette');
  const accelerator = command.accelerator!;
  const reason = useDisabledReason(!isEnabled(command.id), t.common.busy);
  const keyShortcuts = ariaKeyShortcuts(accelerator, currentPlatform());
  return (
    <>
      <Tooltip label={t.common.busy} isDisabled={!reason.soft}>
        <AriaButton
          {...withoutPresses({ onPress: () => run(command.id) }, reason.soft)}
          {...reason.controlProps}
          className="field launcher"
          aria-haspopup="dialog"
          // Named by its visible text (WCAG 2.5.3, axe label-content-name-mismatch: a name that adds "(⌘K)" while the
          // keycaps are drawn as "⌘K" beside the text does not contain the label as shown); the shortcut has its own
          // attribute, which RAC does not pass through, and the menu bar lists it too.
          render={(props) => <button {...props} aria-keyshortcuts={keyShortcuts} />}
          data-testid={testId}
        >
          <Icon icon={Search} size="sm" />
          <span className="placeholder ellipsis">{t.shell.launcher}</span>
          <Kbd accelerator={accelerator} />
        </AriaButton>
      </Tooltip>
      {reason.description}
    </>
  );
}
