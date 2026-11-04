import type { Ref } from 'react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { useTranslation } from './store';

/**
 * The question that comes before any text leaves the machine (owner decision 2), as the pop-up and the panel put it: what
 * goes where, the way back, and the two answers. `off` is the panel's line for a choice already made: only 켜기.
 */
export function ConsentPrompt({ where, off = false, rootRef }: { where: 'popup' | 'panel'; off?: boolean; rootRef?: Ref<HTMLDivElement> }) {
  const enable = useTranslation((s) => s.enable);
  const decline = useTranslation((s) => s.decline);
  const text = off ? t.translation.offText : t.translation.consentText;
  const note = off ? t.translation.offNote : t.translation.consentNote;
  const answers = (
    <>
      <Button variant={off ? 'secondary' : 'primary'} size="small" testId="consent-enable" onPress={() => void enable()}>
        {t.translation.enable}
      </Button>
      {!off && (
        <Button size="small" testId="consent-decline" onPress={() => void decline()}>
          {t.translation.decline}
        </Button>
      )}
    </>
  );
  if (where === 'popup') {
    return (
      <>
        <div className="sp-body">
          <p>{text}</p>
          <div className="sp-note">{note}</div>
        </div>
        <div className="sp-foot">{answers}</div>
      </>
    );
  }
  return (
    <div ref={rootRef} className="tr-consent" data-testid="translation-consent" data-state={off ? 'off' : 'consent'}>
      <p>{text}</p>
      <p className="tr-note-text">{note}</p>
      <div className="actions">{answers}</div>
    </div>
  );
}
