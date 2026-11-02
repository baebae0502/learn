import { useRef, useState } from 'react';
import { Checkbox } from 'react-aria-components';
import { Check, Clapperboard, Copy, FileText } from 'lucide-react';
import type { DuplicateChoice, SheetPayload } from '@learn/domain';
import { formatDate, formatSize } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { resolveSheet } from './SheetApp';
import { useScrollRegion } from './scrollRegion';
import { useSheetKeys } from './sheetKeys';

/**
 * dialogs.html?scene=duplicate. ↩ = 건너뛰기 (the safe default), esc = 건너뛰기, 기존 자료 열기 on the left. While more
 * duplicates of the import wait (`remaining`), a check box under the card answers them all at once; it opens ticked,
 * as drawn, and ↩ / esc keep what it says.
 */
export function DuplicateSheet({ payload }: { payload: Extract<SheetPayload, { kind: 'duplicate' }> }) {
  const offer = payload.remaining > 0;
  const [applyToRest, setApplyToRest] = useState(offer);
  const choose = (choice: DuplicateChoice) => resolveSheet({ kind: 'duplicate', choice, applyToRest: offer && applyToRest });
  const keys = useSheetKeys(() => choose('skip'), () => choose('skip'));
  const body = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(body, 'sheet-title');
  const e = payload.existing;
  return (
    <div
      className="sheet"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      aria-describedby="sheet-text"
      data-sheet-root=""
      data-kind="duplicate"
      data-testid="sheet-root"
      {...keys}
    >
      <div className="d-title">
        <span className="badge-icon">
          <Icon icon={Copy} />
        </span>
        <h2 id="sheet-title" className="ui-balance">
          {t.sheets.duplicateTitle}
        </h2>
      </div>
      <div className="d-body" ref={body} {...region}>
        <p className="d-text ui-prose" id="sheet-text">
          <b data-testid="dup-file">{payload.fileName}</b>
          {t.sheets.duplicateBody}
        </p>
        <div className="card item-card" data-testid="dup-card">
          <span className="thumb">
            <Icon icon={e.type === 'video' ? Clapperboard : FileText} />
          </span>
          <div className="card-text">
            <div className="t-headline ellipsis" title={e.title}>
              {e.title}
            </div>
            <div className="t-footnote c-secondary ellipsis">{t.sheets.cardMeta(t.library.type[e.type], formatSize(e.size), formatDate(e.createdAt))}</div>
          </div>
        </div>
        {offer && (
          <Checkbox className="checkbox t-footnote" isSelected={applyToRest} onChange={setApplyToRest}>
            {({ isSelected }) => (
              <>
                <span className="box" aria-hidden="true">
                  {isSelected && <Icon icon={Check} size="xs" />}
                </span>
                {t.sheets.applyToRest(payload.remaining)}
              </>
            )}
          </Checkbox>
        )}
      </div>
      <div className="d-foot">
        <Button variant="plain-accent" leading testId="dup-open" onPress={() => choose('open')}>
          {t.sheets.openExisting}
        </Button>
        <span className="spacer" />
        <Button testId="dup-add" onPress={() => choose('add')}>
          {t.sheets.addAnyway}
        </Button>
        <Button variant="primary" autoFocus testId="dup-skip" onPress={() => choose('skip')}>
          {t.sheets.skip}
        </Button>
      </div>
    </div>
  );
}
