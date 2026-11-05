import { usePrefs } from '../data/queries';
import { t } from '../strings';
import { langName } from './languages';
import { readTranslationPrefs } from './prefs';
import { useTranslation, type TranslationView } from './store';

/** What a screen reader says for a state; nothing for the states that only ask or wait for the user (idle, consent, off). */
export function spokenResult(view: TranslationView, toName: string): string {
  switch (view.kind) {
    case 'pending':
      return t.translation.pending;
    case 'done':
      return view.sameLanguage ? t.translation.already(toName) : view.text.split('\n').filter((line) => line.trim() !== '').join(' ');
    case 'error':
      return view.message;
    case 'tooLong':
      return `${t.translation.tooLong} ${t.translation.tooLongNote}`;
    default:
      return '';
  }
}

/**
 * The one live region of the translation (m-2): persistent while the reader is open, fed by the store. The pop-up and the
 * panel's result box show the same sentences as plain content, so a result is read out once and whichever of them is on screen.
 */
export function TranslationStatus() {
  const view = useTranslation((s) => s.view);
  const prefs = usePrefs().data?.translation ?? readTranslationPrefs();
  return (
    <span className="visually-hidden" aria-live="polite" data-testid="translation-status">
      {spokenResult(view, langName(prefs.to) ?? '')}
    </span>
  );
}
