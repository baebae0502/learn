import { useEffect, useRef } from 'react';
import { api, unwrap } from '../api';
import { ConsentCard } from './ConsentCard';
import { TutorOff } from './TutorOff';
import { useTutorRun } from './tutorRun';
import { useTutorPrefs } from './useTutorPrefs';

/** Where the focus goes when a press changes the panel's state: the control that takes the place of the one that was pressed. */
type Landing = 'turnOn' | 'agree' | 'tab';
const SELECTOR: Record<Landing, string> = {
  turnOn: '[data-testid="tutor-turn-on"]',
  agree: '[data-testid="tutor-consent-agree"]',
  tab: '#inspector-tab-tutor',
};

/**
 * The right panel's tutor mode, under the head the inspector draws: before consent the card (or, after 나중에, the off state), and
 * after consent the place the chooser and the conversation take in the next tasks. Nothing here starts an agent, asks main which
 * agents exist, or tells it a session is on screen: that all waits for the consent main records (J9). The focus follows each state
 * change, so the button that was pressed never leaves it on <body>.
 */
export function TutorPanel() {
  const consented = useTutorPrefs().consent !== null;
  const later = useTutorRun((s) => s.later);
  const setLater = useTutorRun((s) => s.setLater);
  const state = consented ? 'consented' : later ? 'off' : 'consent';
  const landing = useRef<Landing | null>(null);
  const sending = useRef(false);
  useEffect(() => {
    const want = landing.current;
    if (want === null) return;
    // 동의 lands on the tab once main's answer has taken the card away; the others land as soon as the new state is drawn.
    if (want === 'tab' && !consented) return;
    landing.current = null;
    document.querySelector<HTMLElement>(SELECTOR[want])?.focus();
  }, [state, consented]);
  const agree = () => {
    // One question to main for the card, whatever pressed it (a click and ↩ together send once).
    if (sending.current) return;
    sending.current = true;
    landing.current = 'tab';
    // main writes the consent and pushes prefsChanged: the card goes when that arrives. A refusal leaves the card, and logs its code only.
    unwrap(api().tutor.consent({ grant: true }))
      .catch((e: unknown) => {
        landing.current = null;
        console.warn(`[tutor] consent failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`);
      })
      .finally(() => void (sending.current = false));
  };
  const later_ = () => {
    landing.current = 'turnOn';
    setLater(true);
  };
  const turnOn = () => {
    landing.current = 'agree';
    setLater(false);
  };
  return (
    <div className="tutor-panel" data-testid="tutor-panel" data-state={state}>
      {state === 'consent' && (
        <div className="tutor-scroll">
          <ConsentCard onAgree={agree} onLater={later_} />
        </div>
      )}
      {state === 'off' && <TutorOff onTurnOn={turnOn} />}
    </div>
  );
}
