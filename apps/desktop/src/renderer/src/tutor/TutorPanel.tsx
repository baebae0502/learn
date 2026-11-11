import { api, unwrap } from '../api';
import { ConsentCard } from './ConsentCard';
import { TutorOff } from './TutorOff';
import { useTutorTab } from './tutorStore';
import { useTutorPrefs } from './useTutorPrefs';

/**
 * The right panel's tutor mode, under the head the inspector draws: before consent the card (or, after 나중에, the off state), and
 * after consent the place the chooser and the conversation take in the next tasks. Nothing here starts an agent, asks main which
 * agents exist, or tells it a session is on screen: that all waits for the consent main records (J9).
 */
export function TutorPanel() {
  const consented = useTutorPrefs().consent !== null;
  const later = useTutorTab((s) => s.later);
  const setLater = useTutorTab((s) => s.setLater);
  const state = consented ? 'consented' : later ? 'off' : 'consent';
  const agree = () => {
    // main writes the consent and pushes prefsChanged: the card goes when that arrives. A refusal leaves the card, and logs its code only.
    unwrap(api().tutor.consent({ grant: true })).catch((e: unknown) => console.warn(`[tutor] consent failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`));
  };
  return (
    <div className="tutor-panel" data-testid="tutor-panel" data-state={state}>
      {state === 'consent' && (
        <div className="tutor-scroll">
          <ConsentCard onAgree={agree} onLater={() => setLater(true)} />
        </div>
      )}
      {state === 'off' && <TutorOff onTurnOn={() => setLater(false)} />}
    </div>
  );
}
