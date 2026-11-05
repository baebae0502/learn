import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Check, CircleAlert, Copy, TriangleAlert, WifiOff } from 'lucide-react';
import type { TranslationFrom, TranslationLang } from '@learn/domain';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { ConsentPrompt } from './ConsentPrompt';
import { fromName, langName } from './languages';
import { readTranslationPrefs } from './prefs';
import { useTranslation, type TranslationView } from './store';
import { POPUP_STATES, dismissPopup, selectionRange, useSelection } from './useSelectionText';
import { usePrefs } from '../data/queries';
import { useReaderScope } from '../viewers/readerScope';

/** The gap under (or over) the selection's last line (spec 6.1). */
const GAP = 8;
/** The room the pop-up keeps from the stage's edges. */
const EDGE = 8;

/** The pop-up is on screen: a selection is held, it was not sent away, and the translation has something to say (not while off). */
export function usePopupShown(): boolean {
  const open = useSelection((s) => s.open && s.text !== '');
  const kind = useTranslation((s) => s.view.kind);
  return open && POPUP_STATES.has(kind);
}

export const paragraphs = (text: string) => text.split('\n').filter((line) => line.trim() !== '');

/** The selection pop-up (spec 6.1): over the stage, at the selection's end, never taking the focus. */
export function SelectionPopup({ stageRef }: { stageRef: RefObject<HTMLElement | null> }) {
  const scope = useReaderScope();
  const shown = usePopupShown();
  const view = useTranslation((s) => s.view);
  // A selection extended or moved (shift + arrows) moves the pop-up with its end.
  const text = useSelection((s) => s.text);
  const retry = useTranslation((s) => s.translate);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const prefs = usePrefs().data?.translation ?? readTranslationPrefs();

  const place = useCallback(() => {
    const stage = stageRef.current;
    const range = selectionRange(scope);
    const el = ref.current;
    if (!stage || !range || !el) return;
    // The text layer redrew (a zoom): what was selected is gone from the page.
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return dismissPopup(scope);
    const rects = range.getClientRects();
    const last = rects.length > 0 ? rects[rects.length - 1]! : range.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    // Scrolled out of sight: the pop-up goes with it.
    if (last.bottom < box.top || last.top > box.bottom) return dismissPopup(scope);
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(EDGE, Math.min(last.right - box.left - width / 2, box.width - width - EDGE));
    let top = last.bottom - box.top + GAP;
    if (top + height > box.height - EDGE) top = Math.max(EDGE, last.top - box.top - GAP - height);
    setPos((p) => (p && Math.abs(p.left - left) < 0.5 && Math.abs(p.top - top) < 0.5 ? p : { left, top }));
  }, [stageRef, scope]);

  // The pop-up never takes the focus, but a person can Tab into it or press a button. When what it says changes and the button that
  // had the focus is gone (번역 켜기 → pending, 다시 번역 → pending, 사용 안 함 or esc → closed), the focus would drop to the
  // document: the stage gets it, where the arrows turn pages and the selection stays.
  const held = useRef(false);
  useEffect(() => {
    const track = (e: FocusEvent) => {
      held.current = ref.current?.contains(e.target as Node) ?? false;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  useLayoutEffect(() => {
    if (!held.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    held.current = false;
    stageRef.current?.focus({ preventScroll: true });
  }, [shown, view, stageRef]);

  // Placed before the frame is drawn, and again whenever what it says changes its size or the page moves under it.
  useLayoutEffect(() => {
    if (shown) place();
    else setPos(null);
  }, [shown, view, text, place]);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const el = ref.current;
    if (!shown || !stage || !el) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    stage.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    const observer = new ResizeObserver(later);
    observer.observe(el);
    observer.observe(stage);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      observer.disconnect();
    };
  }, [shown, stageRef, place]);

  if (!shown) return null;
  const compact = view.kind === 'pending' || view.kind === 'tooLong' || (view.kind === 'done' && view.sameLanguage);
  return (
    <div
      ref={ref}
      className={compact ? 'sel-popup is-compact' : 'sel-popup'}
      role="dialog"
      aria-label={t.translation.popupLabel}
      data-testid="selection-popup"
      data-state={view.kind}
      style={{ left: pos?.left, top: pos?.top, visibility: pos ? undefined : 'hidden' }}
    >
      {view.kind === 'consent' ? <ConsentPrompt where="popup" /> : <Result view={view} to={prefs.to} from={prefs.from} onRetry={() => void retry()} />}
    </div>
  );
}

function Result({ view, from, to, onRetry }: { view: TranslationView; from: TranslationFrom; to: TranslationLang; onRetry(): void }) {
  const status = (glyph: typeof Check, text: string, note?: string, tone?: 'warning') => (
    <div className="sp-status">
      <Icon icon={glyph} className={tone} />
      <div>
        <div>{text}</div>
        {note && <div className="sp-note">{note}</div>}
      </div>
    </div>
  );
  if (view.kind === 'pending') {
    return (
      <div className="sp-body">
        <div className="sp-status">
          <Spinner />
          <span>{t.translation.pending}</span>
        </div>
      </div>
    );
  }
  if (view.kind === 'tooLong') {
    return (
      <div className="sp-body">
        {status(CircleAlert, t.translation.tooLong, t.translation.tooLongNote)}
      </div>
    );
  }
  if (view.kind === 'error') {
    return (
      <>
        <div className="sp-body">
          {view.code === 'TRANSLATION_OFFLINE' ? status(WifiOff, view.message) : status(TriangleAlert, view.message, undefined, 'warning')}
        </div>
        <div className="sp-foot">
          <span className="spacer" />
          <Button size="small" testId="translation-retry" onPress={onRetry}>
            {t.translation.retry}
          </Button>
        </div>
      </>
    );
  }
  if (view.kind !== 'done') return null;
  if (view.sameLanguage) {
    return (
      <div className="sp-body" data-testid="selection-popup-text">
        {status(Check, t.translation.already(langName(to) ?? ''))}
      </div>
    );
  }
  const source = view.detectedFrom !== null && langName(view.detectedFrom) !== null ? langName(view.detectedFrom)! : from === 'auto' ? null : fromName(from);
  return (
    <>
      <div className="sp-body" data-testid="selection-popup-text">
        {paragraphs(view.text).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <div className="sp-foot">
        <span className="sp-lang">{source ? t.translation.direction(source, langName(to) ?? '') : (langName(to) ?? '')}</span>
        <span className="spacer" />
        <Button size="small" icon={Copy} aria-label={t.translation.copyTranslated} testId="selection-popup-copy" onPress={() => void navigator.clipboard.writeText(view.text)}>
          {t.translation.copy}
        </Button>
      </div>
    </>
  );
}
