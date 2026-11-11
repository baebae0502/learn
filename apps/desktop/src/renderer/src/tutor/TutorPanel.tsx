import { useEffect, useRef } from 'react';
import { api, unwrap } from '../api';
import { AgentChooser } from './AgentChooser';
import { ConsentCard } from './ConsentCard';
import { FakeBand } from './FakeBand';
import { useTutorTab } from './tutorStore';
import { TutorOff } from './TutorOff';
import { useTutorRun } from './tutorRun';
import { useTutorPrefs } from './useTutorPrefs';

/** Where the focus goes when a press changes the panel's state: the control that takes the place of the one that was pressed. */
type Landing = 'turnOn' | 'agree';
const SELECTOR: Record<Landing, string> = {
  turnOn: '[data-testid="tutor-turn-on"]',
  agree: '[data-testid="tutor-consent-agree"]',
};

/**
 * The right panel's tutor mode, under the head the inspector draws: before consent the card (or, after 나중에, the off state), and
 * after consent the agent chooser until an agent is chosen (or 에이전트 고르기… asks for it again), then the place the conversation takes
 * in the next tasks. Nothing here starts an agent, asks main which agents exist, or tells it a session is on screen before the consent
 * main records (J9): the chooser is what asks, and it is mounted only after. The focus follows each state change, so the button that
 * was pressed never leaves it on <body>; after 동의 it lands in the chooser.
 */
export function TutorPanel() {
  const prefs = useTutorPrefs();
  const consented = prefs.consent !== null;
  const choosing = useTutorTab((s) => s.choosing);
  const setChoosing = useTutorTab((s) => s.setChoosing);
  const later = useTutorRun((s) => s.later);
  const setLater = useTutorRun((s) => s.setLater);
  const chooser = consented && (prefs.agent === null || choosing);
  const state = !consented ? (later ? 'off' : 'consent') : chooser ? 'chooser' : 'ready';
  // 동의 asks the chooser for the focus once main's answer has put it on screen; the chooser reads and clears it.
  const chooserFocus = useRef(false);
  const landing = useRef<Landing | null>(null);
  const sending = useRef(false);
  useEffect(() => {
    const want = landing.current;
    if (want === null) return;
    landing.current = null;
    document.querySelector<HTMLElement>(SELECTOR[want])?.focus();
  }, [state]);
  const agree = () => {
    // One question to main for the card, whatever pressed it (a click and ↩ together send once).
    if (sending.current) return;
    sending.current = true;
    chooserFocus.current = true;
    // main writes the consent and pushes prefsChanged: the card goes when that arrives. A refusal leaves the card, and logs its code only.
    unwrap(api().tutor.consent({ grant: true }))
      .catch((e: unknown) => {
        chooserFocus.current = false;
        console.warn(`[tutor] consent failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`);
      })
      .finally(() => void (sending.current = false));
  };
  const putOff = () => {
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
          <ConsentCard onAgree={agree} onLater={putOff} />
        </div>
      )}
      {state === 'off' && <TutorOff onTurnOn={turnOn} />}
      {consented && prefs.agent === 'fake' && <FakeBand />}
      {state === 'chooser' && <AgentChooser focusRequest={chooserFocus} onStarted={() => setChoosing(false)} />}
    </div>
  );
}
