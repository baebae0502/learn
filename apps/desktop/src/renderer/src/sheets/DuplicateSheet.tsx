import { Clapperboard, Copy, FileText } from 'lucide-react';
import type { DuplicateChoice, SheetPayload } from '@learn/domain';
import { formatDate, formatSize } from '../format';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { resolveSheet } from './SheetApp';

/** dialogs.html?scene=duplicate. ↩ = 건너뛰기 (the safe default), esc = 건너뛰기, 기존 자료 열기 on the left. */
export function DuplicateSheet({ payload }: { payload: Extract<SheetPayload, { kind: 'duplicate' }> }) {
  const choose = (choice: DuplicateChoice) => resolveSheet({ kind: 'duplicate', choice });
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
      onKeyDown={(ev) => {
        if (ev.key === 'Escape' && !ev.nativeEvent.isComposing) choose('skip');
      }}
    >
      <div className="d-body">
        <div className="d-title">
          <span className="badge-icon">
            <Icon icon={Copy} />
          </span>
          <h2 id="sheet-title">{t.sheets.duplicateTitle}</h2>
        </div>
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
