import { useLayoutEffect, useRef, type RefObject } from 'react';
import { LibraryBig } from 'lucide-react';
import { commandById, commandMention } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { Spinner } from '../ui/Spinner';
import { useFocusOnLeave } from './focusOnLeave';

/** First run (design-spec 10.2, library-empty.html). The two buttons run the same registry commands as ⌘O / ⌥⌘O. */
export function EmptyLibrary(props: {
  /** Set when the screen goes away (first import) while focus is inside it: the list then takes the focus over. */
  focusOnLeave?: RefObject<boolean>;
}) {
  const { run, isEnabled } = useCommands();
  const managed = commandById('file.importManaged');
  const linked = commandById('file.importLinked');
  const root = useRef<HTMLDivElement>(null);
  useFocusOnLeave(root, props.focusOnLeave);
  // A drop is bringing files in (the count is known): the screen says so, with nothing to press (T13R2-m1). The
  // dialog flow keeps this screen, whose buttons are disabled with a reason while the dialog is up.
  const busyCount = useShell((s) => (s.importing ? s.importCount : null));
  // A focus inside goes with the buttons: the screen itself keeps it, so the list can still take it over afterwards.
  const focusInside = root.current !== null && root.current.contains(document.activeElement);
  const keepFocus = useRef(false);
  keepFocus.current = focusInside;
  useLayoutEffect(() => {
    if (busyCount !== null && keepFocus.current && (document.activeElement === null || document.activeElement === document.body)) root.current?.focus();
  }, [busyCount]);
  if (busyCount !== null) {
    return (
      <div className="empty-state" data-testid="empty-state" data-busy="" ref={root} tabIndex={-1} role="status">
        <div className="glyph">
          <Icon icon={LibraryBig} size="xl" />
        </div>
        <h2 className="ui-balance busy-title">
          <Spinner />
          {t.library.importingTitle(busyCount)}
        </h2>
      </div>
    );
  }
  return (
    <div className="empty-state" data-testid="empty-state" ref={root}>
      <div className="glyph">
        <Icon icon={LibraryBig} size="xl" />
      </div>
      <h2 className="ui-balance">{t.library.emptyTitle}</h2>
      <p className="ui-balance">
        {t.library.emptyBody1}
        <br />
        {t.library.emptyBody2}
      </p>
      <div className="actions">
        {/* Disabled only while an import or a sheet holds the window (M-2: the reason is the tooltip). */}
        <Button variant="primary" size="large" testId="import-managed" isDisabled={!isEnabled(managed.id)} disabledReason={t.common.busy} onPress={() => run(managed.id)}>
          {managed.label}
        </Button>
        <Button size="large" testId="import-linked" isDisabled={!isEnabled(linked.id)} disabledReason={t.common.busy} onPress={() => run(linked.id)}>
          {linked.label}
        </Button>
      </div>
      {/* An action list with its shortcuts: name first, as in a menu (design-spec 7.4). Named without "…" (prose). */}
      <div className="hints">
        <div className="row">
          <span>{commandMention(managed, currentPlatform())}</span>
          <Kbd accelerator={managed.accelerator} />
          <span className="gap" />
          <span>{commandMention(commandById('app.palette'), currentPlatform())}</span>
          <Kbd accelerator={commandById('app.palette').accelerator} />
        </div>
        <div className="row">{t.library.formats}</div>
      </div>
    </div>
  );
}
