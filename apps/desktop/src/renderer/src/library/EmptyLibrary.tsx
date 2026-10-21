import { useRef, type RefObject } from 'react';
import { LibraryBig } from 'lucide-react';
import { commandById } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
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
      <div className="hints">
        <div className="row">
          <span>{t.library.hintImport}</span>
          <Kbd accelerator={managed.accelerator} />
          <span className="gap" />
          <span>{t.library.hintPalette}</span>
          <Kbd accelerator={commandById('app.palette').accelerator} />
        </div>
        <div className="row">{t.library.formats}</div>
      </div>
    </div>
  );
}
