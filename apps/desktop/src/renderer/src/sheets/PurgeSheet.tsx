import { useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { purgeText, type PurgePayload } from './purgeText';
import { resolveSheet } from './SheetApp';
import { useScrollRegion } from './scrollRegion';
import { useSheetKeys } from './sheetKeys';

/**
 * 영구 삭제… / 휴지통 비우기… (P-25; dialogs.html?scene=purge, ?scene=empty-trash): an app sheet, as a native message box can
 * neither draw a destructive button nor keep 취소 the default. ↩ and esc are 취소; the destructive verb, in danger text on the
 * left, takes a press (or Tab, then Space).
 */
export function PurgeSheet({ payload }: { payload: PurgePayload }) {
  const answer = (confirmed: boolean) => resolveSheet({ kind: 'purge', confirmed });
  const keys = useSheetKeys(() => answer(false), () => answer(false));
  const body = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(body, 'sheet-title');
  const text = purgeText(payload);
  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="sheet-title" aria-describedby="sheet-text" data-sheet-root="" data-kind="purge" data-testid="sheet-root" {...keys}>
      <div className="d-title">
        <span className="badge-icon warning">
          <Icon icon={Trash2} />
        </span>
        <h2 id="sheet-title" className="ui-balance" data-testid="purge-title">
          {text.title}
        </h2>
      </div>
      <div className="d-body" ref={body} {...region}>
        <p className="d-text ui-prose" id="sheet-text" data-testid="purge-text">
          {text.body}
        </p>
      </div>
      <div className="d-foot">
        <Button variant="plain-danger" leading testId="purge-confirm" onPress={() => answer(true)}>
          {text.verb}
        </Button>
        <span className="spacer" />
        <Button variant="primary" autoFocus testId="purge-cancel" onPress={() => answer(false)}>
          {t.sheets.purge.cancel}
        </Button>
      </div>
    </div>
  );
}
