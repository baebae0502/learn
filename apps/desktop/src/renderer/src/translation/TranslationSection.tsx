import { useEffect, useLayoutEffect, useRef } from 'react';
import { Check, CircleAlert, TriangleAlert, WifiOff } from 'lucide-react';
import { Checkbox, TextArea, TextField } from 'react-aria-components';
import { usePrefs } from '../data/queries';
import { Section } from '../inspector/Section';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { MenuButton } from '../ui/MenuButton';
import { Spinner } from '../ui/Spinner';
import { ConsentPrompt } from './ConsentPrompt';
import { directionEntries, directionLabel, langName, parseDirection } from './languages';
import { readTranslationPrefs } from './prefs';
import { paragraphs } from './SelectionPopup';
import { useTranslation, type TranslationView } from './store';

type CopyKind = 'source' | 'result' | 'both';

/** The reader panel's first section (spec 6.2): the consent or the two boxes, the toggles and the buttons; same result as the pop-up. */
export function TranslationSection() {
  const prefs = usePrefs().data?.translation ?? readTranslationPrefs();
  const enabled = prefs.enabled === true;
  // The answer replaces the button that was pressed. The focus goes where the person works next: 번역 켜기 to the 원문 box,
  // 사용 안 함 to the section's own head (not to the document).
  const held = useRef(false);
  useEffect(() => {
    const track = (e: FocusEvent) => {
      held.current = e.target instanceof Element && e.target.closest('[data-testid="translation-section"] .tr-consent') !== null;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  useLayoutEffect(() => {
    if (!held.current) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const section = document.querySelector('[data-testid="translation-section"]');
    const target = prefs.enabled === true ? section?.querySelector<HTMLElement>('[data-testid="translation-source"]') : section?.querySelector<HTMLElement>('.section-toggle');
    if (!target) return;
    held.current = false;
    target.focus({ preventScroll: true });
  }, [prefs.enabled]);
  const direction = enabled && (
    <MenuButton
      label={directionLabel(prefs)}
      variant="plain"
      size="small"
      placement="bottom end"
      items={directionEntries(prefs)}
      onAction={(id) => void useTranslation.getState().save(parseDirection(id))}
      testId="translation-direction"
    />
  );
  return (
    <Section id="translation" title={t.translation.title} extra={direction || undefined} testId="translation-section" className="tr">
      {prefs.enabled === null ? <ConsentPrompt where="panel" /> : prefs.enabled === false ? <ConsentPrompt where="panel" off /> : <Boxes />}
    </Section>
  );
}

function Boxes() {
  const prefs = usePrefs().data?.translation ?? readTranslationPrefs();
  const { source, view, concat } = useTranslation();
  const { setSource, translate, clear, setConcat } = useTranslation.getState();
  const area = useRef<HTMLTextAreaElement>(null);
  // The original grows with its text up to its own limit (CSS), then scrolls in its box.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [source]);

  const done = view.kind === 'done' ? view : null;
  const toName = langName(prefs.to) ?? '';
  const sourceLang = done?.detectedFrom != null && langName(done.detectedFrom) !== null ? langName(done.detectedFrom) : prefs.from !== 'auto' ? langName(prefs.from) : null;
  const length = view.kind === 'tooLong' ? t.translation.chars(source.trim().length) : null;
  const sourceNote = [sourceLang, length].filter((x): x is string => Boolean(x)).join(' · ');
  const failed = view.kind === 'error';
  const empty = source.trim() === '';
  const busy = view.kind === 'pending';
  const cannotRun = empty || busy || view.kind === 'tooLong' || (done?.sameLanguage ?? false);

  const copy = (kind: CopyKind) => {
    const result = done?.text ?? '';
    const text = kind === 'source' ? source : kind === 'result' ? result : `${source}\n\n${result}`;
    void navigator.clipboard.writeText(text);
  };

  return (
    <>
      <div className="tr-label">
        <span>{t.translation.source}</span>
        <span className="spacer" />
        {sourceNote && <span>{sourceNote}</span>}
      </div>
      <TextField aria-label={t.translation.source} value={source} onChange={setSource}>
        <TextArea ref={area} className="tr-box src" rows={1} placeholder={t.translation.sourcePlaceholder} spellCheck={false} data-testid="translation-source" />
      </TextField>
      <div className="tr-label">
        <span>{t.translation.result}</span>
        <span className="spacer" />
        {done && <span>{toName}</span>}
      </div>
      <div className="tr-box dst" aria-live="polite" data-testid="translation-result" data-state={view.kind}>
        <Result view={view} toName={toName} />
      </div>
      <div className="tr-toggles">
        <Checkbox className="checkbox" isSelected={prefs.autoOnSelect} onChange={(autoOnSelect) => void useTranslation.getState().save({ autoOnSelect })} data-testid="translation-auto">
          {({ isSelected }) => (
            <>
              <span className="box" aria-hidden="true">
                {isSelected && <Icon icon={Check} size="xs" />}
              </span>
              {t.translation.auto}
            </>
          )}
        </Checkbox>
        <Checkbox className="checkbox" isSelected={concat} onChange={setConcat} data-testid="translation-concat">
          {({ isSelected }) => (
            <>
              <span className="box" aria-hidden="true">
                {isSelected && <Icon icon={Check} size="xs" />}
              </span>
              {t.translation.concat}
            </>
          )}
        </Checkbox>
      </div>
      <div className="tr-actions">
        <Button size="small" isDisabled={empty && view.kind === 'idle'} onPress={clear} testId="translation-clear" aria-label={t.translation.clearTip}>
          {t.translation.clear}
        </Button>
        <MenuButton
          label={t.translation.copy}
          size="small"
          isDisabled={empty || busy}
          items={[
            { id: 'source', label: t.translation.copySource, testId: 'translation-copy-source' },
            { id: 'result', label: t.translation.copyResult, isDisabled: !done, testId: 'translation-copy-result' },
            { id: 'both', label: t.translation.copyBoth, isDisabled: !done, testId: 'translation-copy-both' },
          ]}
          onAction={(id) => copy(id as CopyKind)}
          testId="translation-copy"
        />
        <span className="spacer" />
        <Button size="small" isDisabled={cannotRun} onPress={() => void translate()} testId={failed ? 'translation-retry' : 'translation-run'}>
          {failed ? t.translation.retry : t.translation.run}
        </Button>
      </div>
    </>
  );
}

/** The translation box's content for each state: the same sentences as the pop-up. */
function Result({ view, toName }: { view: TranslationView; toName: string }) {
  const note = (glyph: typeof Check, lines: readonly string[], tone?: 'warning') => (
    <div className="tr-note">
      <Icon icon={glyph} size="sm" className={tone} />
      <div>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
  switch (view.kind) {
    case 'pending':
      return (
        <div className="loading">
          <Spinner />
          {t.translation.pending}
        </div>
      );
    case 'done':
      return view.sameLanguage ? note(Check, [t.translation.already(toName)]) : <>{paragraphs(view.text).map((line, i) => <p key={i}>{line}</p>)}</>;
    case 'error':
      return view.code === 'TRANSLATION_OFFLINE' ? note(WifiOff, [view.message]) : note(TriangleAlert, [view.message], 'warning');
    case 'tooLong':
      return note(CircleAlert, [t.translation.tooLong, t.translation.tooLongNote]);
    default:
      return <span className="ph">{t.translation.resultPlaceholder}</span>;
  }
}
