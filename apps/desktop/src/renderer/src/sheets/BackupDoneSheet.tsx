import { useRef, useState } from 'react';
import { CircleCheck, FolderSearch, Info } from 'lucide-react';
import type { BackupDoneSheet as BackupDonePayload } from '@learn/domain';
import { api, unwrap } from '../api';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { currentPlatform } from '../ui/platform';
import { backupSheetText, splitLocation } from './backupText';
import { resolveSheet } from './SheetApp';
import { useScrollRegion } from './scrollRegion';
import { useSheetKeys } from './sheetKeys';

/**
 * 백업을 만들었습니다 (spec 8.2, dialogs.html?scene=backup): when, what the backup holds, where, and what it kept as a
 * location only. Finder에서 보기 asks main to show the folder (sheet:act — this page has no path to send); ↩ and esc are 완료.
 */
export function BackupDoneSheet({ payload }: { payload: BackupDonePayload }) {
  const done = () => resolveSheet({ kind: 'backupDone' });
  const keys = useSheetKeys(done, done);
  const body = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(body, 'sheet-title');
  const [revealError, setRevealError] = useState<string | null>(null);
  const text = backupSheetText(payload, currentPlatform());
  const location = splitLocation(text.location);
  const reveal = () => {
    setRevealError(null);
    void unwrap(api().sheet.act({ action: { kind: 'backupDone', act: 'reveal' } })).catch((e: unknown) => setRevealError((e as Error).message));
  };
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" aria-describedby="sheet-when" data-sheet-root="" data-kind="backupDone" data-testid="sheet-root" {...keys}>
      <div className="d-title">
        <span className="badge-icon success">
          <Icon icon={CircleCheck} />
        </span>
        <div className="d-heading">
          <h2 id="sheet-title" className="ui-balance" data-testid="backup-title">
            {text.title}
          </h2>
          <div className="t-footnote c-secondary num" id="sheet-when" data-testid="backup-when">
            {text.when}
          </div>
        </div>
      </div>
      <div className="d-body" ref={body} {...region}>
        <div className="card kv-card">
          <dl className="kv">
            <dt>{t.backup.labels.items}</dt>
            <dd className="num" data-testid="backup-items">
              {text.items}
            </dd>
            <dt>{t.backup.labels.files}</dt>
            <dd className="num" data-testid="backup-files">
              {text.files}
            </dd>
            <dt>{t.backup.labels.location}</dt>
            <dd className="mono-val path-split" title={payload.location} data-testid="backup-location">
              <span className="path-head ellipsis">{location.parent}</span>
              <span className="path-tail">{location.name}</span>
            </dd>
          </dl>
        </div>
        {text.linkedNote !== null && (
          <p className="sheet-note" data-testid="backup-linked-note">
            <Icon icon={Info} size="sm" />
            <span className="ui-prose">{text.linkedNote}</span>
          </p>
        )}
        {text.missingNote !== null && (
          <p className="sheet-note" data-testid="backup-missing-note">
            <Icon icon={Info} size="sm" />
            <span className="ui-prose">{text.missingNote}</span>
          </p>
        )}
        {revealError !== null && (
          <p className="field-error" role="alert" data-testid="backup-reveal-error">
            {revealError}
          </p>
        )}
      </div>
      <div className="d-foot">
        <Button icon={FolderSearch} testId="backup-reveal" onPress={reveal}>
          {text.reveal}
        </Button>
        <span className="spacer" />
        <Button variant="primary" autoFocus testId="backup-done" onPress={done}>
          {text.done}
        </Button>
      </div>
    </div>
  );
}
