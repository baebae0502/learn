import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Info, Stethoscope, TriangleAlert } from 'lucide-react';
import type { CheckAction, CheckRowKind, LibraryCheckPayload, SheetPayload } from '@learn/domain';
import { api } from '../api';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { currentPlatform } from '../ui/platform';
import { Spinner } from '../ui/Spinner';
import { checkBadge, checkHintShown, checkIntro, checkRowView, type CheckActKey, type CheckRowView, type CheckTone } from './checkView';
import { resolveSheet } from './SheetApp';
import { useScrollRegion } from './scrollRegion';
import { useSheetKeys } from './sheetKeys';

const TONE_ICON = { warning: TriangleAlert, info: Info, success: CircleCheck } as const;
const TONE_CLASS: Record<CheckTone, string> = { warning: 'c-warning', info: 'c-secondary', success: 'c-success' };
const ACTIONS: Record<Exclude<CheckActKey, 'askClean'>, CheckAction> = {
  cleanStaging: { kind: 'libraryCheck', act: 'cleanStaging' },
  revive: { kind: 'libraryCheck', act: 'revive' },
  revealCorrupt: { kind: 'libraryCheck', act: 'revealCorrupt' },
  importOrphanEdits: { kind: 'libraryCheck', act: 'importOrphanEdits' },
  revealOrphanEdit: { kind: 'libraryCheck', act: 'revealOrphanEdit' },
};
const focusDone = () => document.querySelector<HTMLElement>('[data-testid="check-done"]')?.focus();

/**
 * 라이브러리 점검 (dialogs.html?scene=recovery, recovery-full, recovery-ok; M6 spec 7.2, P-17, P-26). Rows to act on first, in
 * the table's order, the 자료 기록 row last; a row's action runs in main (sheet:act) and the row turns ok in place. Only
 * the list scrolls. ↩ and esc are 완료 — or, while 지우기… asks in its row, they keep the copies.
 */
export function LibraryCheckSheet({ payload }: { payload: LibraryCheckPayload }) {
  const queryClient = useQueryClient();
  const [working, setWorking] = useState<CheckRowKind | null>(null);
  const [error, setError] = useState<{ kind: CheckRowKind; message: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [heard, setHeard] = useState('');
  const done = () => resolveSheet({ kind: 'libraryCheck' });
  const keepCopies = () => {
    setAsking(false);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="check-askClean"]')?.focus());
  };
  const keys = useSheetKeys(() => (asking ? keepCopies() : done()), () => (asking ? keepCopies() : done()));
  const list = useRef<HTMLDivElement>(null);
  const region = useScrollRegion(list, 'sheet-title');
  const platform = currentPlatform();
  const rows = payload.rows.map((r) => checkRowView(r, payload.homeDir, platform));
  const badge = checkBadge(payload);

  // A button that went with its row (the row turned ok) leaves the focus nowhere: it goes to 완료.
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) focusDone();
  }, [payload]);

  async function act(kind: CheckRowKind, action: CheckAction): Promise<void> {
    if (working !== null) return; // one action at a time; the buttons keep their focus meanwhile
    setWorking(kind);
    setError(null);
    try {
      const r = await api().sheet.act({ action });
      if (!r.ok) {
        setError({ kind, message: r.message });
        return;
      }
      const next = r.data as LibraryCheckPayload;
      queryClient.setQueryData<SheetPayload>(['sheet', 'payload'], next);
      const row = next.rows.find((x) => x.kind === kind);
      if (row?.state === 'done') setHeard(`${t.check.rows[kind].name}: ${t.check.fixed[row.fix ?? 'none']}`);
    } finally {
      setWorking(null);
      setAsking(false);
    }
  }
  const failure = (kind: CheckRowKind): string | null => (error?.kind === kind ? error.message : payload.failed?.kind === kind ? payload.failed.message : null);

  return (
    <div
      className="sheet wide check-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-title"
      aria-describedby="sheet-text"
      data-sheet-root=""
      data-kind="libraryCheck"
      data-mode={payload.mode}
      data-follows=""
      data-testid="sheet-root"
      {...keys}
    >
      <div className="d-title check-head">
        <span className={cx('badge-icon', badge)} data-testid="check-badge" data-tone={badge}>
          <Icon icon={Stethoscope} />
        </span>
        <div className="check-head-text">
          <h2 id="sheet-title" className="ui-balance">
            {t.check.title}
          </h2>
          <p className="d-text ui-prose" id="sheet-text" data-testid="check-intro">
            {checkIntro(payload)}
          </p>
        </div>
      </div>
      <div className="d-body check-body">
        <div className="card checklist" data-testid="check-list">
          <div className="check-scroll" ref={list} {...region} data-testid="check-scroll" aria-busy={working !== null ? true : undefined}>
            <div role="list" aria-labelledby="sheet-title">
              {rows.map((view) => (
                <CheckRowItem
                  key={view.kind}
                  view={view}
                  working={working === view.kind}
                  asking={asking && view.kind === 'unreferenced' && view.state === 'todo'}
                  failure={failure(view.kind)}
                  onAct={(key) => (key === 'askClean' ? setAsking(true) : void act(view.kind, ACTIONS[key]))}
                  onRelink={(itemId) => void act(view.kind, { kind: 'libraryCheck', act: 'relink', itemId })}
                  onConfirm={() => void act('unreferenced', { kind: 'libraryCheck', act: 'cleanUnreferenced', keys: payload.rows.find((r) => r.kind === 'unreferenced')?.keys ?? [] })}
                  onKeep={keepCopies}
                />
              ))}
              <div className="check-row" role="listitem" data-testid="check-row" data-kind="records" data-state="done" data-tone="success">
                <span className="ci-status c-success">
                  <Icon icon={CircleCheck} label={t.check.status.success} />
                </span>
                <div className="ci-main">
                  <div className="ci-title">{t.check.records.title}</div>
                  <div className="ci-text">{t.check.records.text(payload.items)}</div>
                </div>
                <div className="ci-action" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="d-foot">
        {checkHintShown(payload) && (
          <span className="t-footnote c-secondary" data-testid="check-hint">
            {t.check.hint}
          </span>
        )}
        <span className="spacer" />
        <Button variant={asking ? 'secondary' : 'primary'} autoFocus testId="check-done" onPress={done}>
          {t.common.done}
        </Button>
      </div>
      <div className="visually-hidden" role="status">
        {heard}
      </div>
    </div>
  );
}

interface RowProps {
  view: CheckRowView;
  working: boolean;
  asking: boolean;
  failure: string | null;
  onAct(key: CheckActKey): void;
  onRelink(itemId: string): void;
  onConfirm(): void;
  onKeep(): void;
}

function CheckRowItem({ view, working, asking, failure, onAct, onRelink, onConfirm, onKeep }: RowProps) {
  return (
    <div className="check-row" role="listitem" data-testid="check-row" data-kind={view.kind} data-state={view.state} data-tone={view.tone} data-asking={asking ? '' : undefined}>
      <span className={cx('ci-status', TONE_CLASS[view.tone])}>
        {working ? <Spinner label={t.check.status.working} /> : <Icon icon={TONE_ICON[view.tone]} label={t.check.status[view.tone]} />}
      </span>
      <div className="ci-main">
        <div className="ci-title">{asking ? t.check.confirm.title(view.count) : view.title}</div>
        <div className="ci-text">{asking ? t.check.confirm.text : view.text}</div>
        {view.meta !== null && (
          <div className={cx('ci-meta', view.metaTail === null && 'ellipsis')} title={view.meta}>
            {view.metaTail === null ? (
              view.meta
            ) : (
              <>
                <span className="cm-name ellipsis">{view.meta.slice(0, view.meta.length - view.metaTail.length)}</span>
                <span className="cm-tail">{view.metaTail}</span>
              </>
            )}
          </div>
        )}
      </div>
      <div className={cx('ci-action', asking ? 'confirm' : view.buttons.length > 1 && 'stack')}>
        {asking ? (
          <>
            <Button size="small" variant="plain-danger" testId="check-confirm" onPress={onConfirm}>
              {t.check.confirm.remove}
            </Button>
            <Button size="small" variant="primary" autoFocus testId="check-confirm-cancel" onPress={onKeep}>
              {t.check.confirm.cancel}
            </Button>
          </>
        ) : (
          view.buttons.map((b) => (
            <Button key={b.key} size="small" testId={`check-${b.key}`} onPress={() => onAct(b.key)}>
              {b.label}
            </Button>
          ))
        )}
      </div>
      {(view.entries.length > 0 || view.more > 0) && (
        <div className="ci-entries">
          {view.entries.map((e) => (
            <div className="ci-entry" key={e.key} data-testid="check-entry" data-item-id={e.relinkItemId ?? undefined}>
              {e.path !== null ? (
                <span className="ce-text">
                  <span className="ce-title ellipsis" title={e.label}>
                    {e.label}
                  </span>
                  <span className="ce-path ellipsis" title={e.pathTitle ?? undefined}>
                    {e.path}
                  </span>
                </span>
              ) : (
                <span className="ellipsis" title={e.label}>
                  {e.label}
                </span>
              )}
              {e.relinkItemId !== null && (
                <Button size="small" testId="check-relink" aria-label={t.check.actions.relinkFor(e.label)} onPress={() => onRelink(e.relinkItemId!)}>
                  {t.check.actions.relink}
                </Button>
              )}
            </div>
          ))}
          {view.more > 0 && (
            <div className="ci-entry more" data-testid="check-more">
              <span>{t.check.more(view.more)}</span>
            </div>
          )}
        </div>
      )}
      {failure !== null && (
        <div className="ci-error" role="alert" data-testid="check-error">
          {failure}
        </div>
      )}
    </div>
  );
}
