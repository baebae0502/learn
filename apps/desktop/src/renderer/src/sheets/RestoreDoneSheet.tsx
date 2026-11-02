import { useRef, useState } from 'react';
import { CircleCheck, FolderSearch, TriangleAlert } from 'lucide-react';
import type { RestoreDoneSheet as RestoreDonePayload } from '@learn/domain';
import { api, unwrap } from '../api';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { currentPlatform } from '../ui/platform';
import { splitLocation } from './backupText';
import { restoreSheetText } from './restoreText';
import { resolveSheet } from './SheetApp';
import { useScrollRegion } from './scrollRegion';
import { useSheetKeys } from './sheetKeys';

/**
 * 백업을 복원했습니다 (spec 9.3, dialogs.html?scene=restore, ?scene=restore-issues): which backup, what came back, where — the
 * location shrinks in the middle (the folders give way, the folder's name stays whole) and carries its own small
 * Finder에서 보기 (sheet:act: this page has no path to send) — then each kind of problem with the items it touches, and what happens to the library in use. ↩ is
 * 이 라이브러리로 전환하고 다시 시작 (the default), esc 나중에.
 */
export function RestoreDoneSheet({ payload }: { payload: RestoreDonePayload }) {
  const answer = (switchNow: boolean) => resolveSheet({ kind: 'restoreDone', switch: switchNow });
  const keys = useSheetKeys(() => answer(true), () => answer(false));
  const body = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(body, 'sheet-title');
  const [revealError, setRevealError] = useState<string | null>(null);
  const text = restoreSheetText(payload, currentPlatform());
  const location = splitLocation(text.location);
  const reveal = () => {
    setRevealError(null);
    void unwrap(api().sheet.act({ action: { kind: 'restoreDone', act: 'reveal' } })).catch((e: unknown) => setRevealError((e as Error).message));
  };
  return (
    <div
      className="sheet wide restore-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      aria-describedby="sheet-when"
      data-sheet-root=""
      data-kind="restoreDone"
      data-tone={text.tone}
      data-testid="sheet-root"
      {...keys}
    >
      <div className="d-title">
        <span className={cx('badge-icon', text.tone)} data-testid="restore-badge" data-tone={text.tone}>
          <Icon icon={text.tone === 'success' ? CircleCheck : TriangleAlert} />
        </span>
        <div className="d-heading">
          <h2 id="sheet-title" className="ui-balance" data-testid="restore-title">
            {text.title}
          </h2>
          <div className="t-footnote c-secondary num" id="sheet-when" data-testid="restore-when">
            {text.when}
          </div>
        </div>
      </div>
      <div className="d-body" ref={body} {...region}>
        <div className="card kv-card">
          <dl className="kv">
            <dt>{t.restore.labels.items}</dt>
            <dd className="num" data-testid="restore-items">
              {text.items}
            </dd>
            <dt>{t.restore.labels.files}</dt>
            <dd className="num" data-testid="restore-files">
              {text.files}
            </dd>
            <dt>{t.restore.labels.location}</dt>
            <dd className="loc-row">
              <span className="loc path-split" title={payload.location} data-testid="restore-location">
                <span className="path-head ellipsis">{location.parent}</span>
                <span className="path-tail">{location.name}</span>
              </span>
              <Button size="small" icon={FolderSearch} testId="restore-reveal" onPress={reveal}>
                {text.reveal}
              </Button>
            </dd>
          </dl>
        </div>
        {text.issues.length > 0 && (
          <div className="restore-issues" data-testid="restore-issues">
            {text.issues.map((issue) => (
              <div className="ri-issue" key={issue.key} data-testid="restore-issue" data-kind={issue.key}>
                <div className="ri-line">
                  <Icon icon={TriangleAlert} size="sm" className="c-warning" />
                  <span>{issue.text}</span>
                </div>
                {(issue.titles.length > 0 || issue.more > 0) && (
                  <div className="ri-items">
                    {issue.titles.map((title, i) => (
                      <span key={i} className="ellipsis" title={title} data-testid="restore-issue-item">
                        {title}
                      </span>
                    ))}
                    {issue.more > 0 && (
                      <span className="ri-more" data-testid="restore-issue-more">
                        {t.restore.more(issue.more)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {text.missingNote !== null && (
              <p className="d-text ui-prose" data-testid="restore-missing-note">
                {text.missingNote}
              </p>
            )}
          </div>
        )}
        <p className="d-text ui-prose" data-testid="restore-keep">
          {text.keep}
        </p>
        {revealError !== null && (
          <p className="field-error" role="alert" data-testid="restore-reveal-error">
            {revealError}
          </p>
        )}
      </div>
      <div className="d-foot">
        <span className="spacer" />
        <Button testId="restore-later" onPress={() => answer(false)}>
          {text.later}
        </Button>
        <Button variant="primary" autoFocus testId="restore-switch" onPress={() => answer(true)}>
          {text.switch}
        </Button>
      </div>
    </div>
  );
}
