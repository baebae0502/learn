import { Keyboard } from 'lucide-react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { currentPlatform } from '../ui/platform';
import { shortcutGroups } from './shortcuts';
import { resolveSheet } from './SheetApp';
import { useSheetKeys } from './sheetKeys';

/** ⌘/ (design-spec 7.4), generated from the command registry; ↩ or esc closes it. */
export function ShortcutsSheet() {
  const done = () => resolveSheet({ kind: 'shortcuts' });
  const keys = useSheetKeys(done, done);
  return (
    <div
      className="sheet wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      data-sheet-root=""
      data-kind="shortcuts"
      data-testid="sheet-root"
      {...keys}
    >
      <div className="d-body">
        <div className="d-title">
          <span className="badge-icon">
            <Icon icon={Keyboard} />
          </span>
          <h2 id="sheet-title" className="ui-balance">
            {t.sheets.shortcutsTitle}
          </h2>
        </div>
        <div className="shortcut-groups">
          {shortcutGroups(currentPlatform()).map((g) => (
            <section key={g.title} aria-label={g.title}>
              <div className="group-label">{g.title}</div>
              <div className="card shortcut-list">
                {g.rows.map((r) => (
                  <div className="shortcut-row" key={r.label} data-testid="shortcut-row">
                    <span className="sr-label">{r.label}</span>
                    <Kbd keys={r.keys} />
                    <span className="visually-hidden">{r.spoken}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="d-foot">
        <span className="spacer" />
        <Button variant="primary" autoFocus testId="shortcuts-done" onPress={done}>
          {t.common.done}
        </Button>
      </div>
    </div>
  );
}
