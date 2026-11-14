import { useEffect, useRef, useState } from 'react';
import { TUTOR_LIMITS } from '@learn/domain';
import { api, unwrap } from '../api';
import { useItem, useItemDetail } from '../data/queries';
import { usePanelFocusRequest } from '../shell/panelFocus';
import { ensureOutline } from '../viewers/pdf/outlineCache';
import { useReader } from '../viewers/pdf/readerStore';
import { useReaderScope } from '../viewers/readerScope';
import { AgentChooser } from './AgentChooser';
import { Composer } from './Composer';
import { createComposerFocus } from './composerFocus';
import { composerKey } from './composerKeys';
import { ConsentCard } from './ConsentCard';
import { BeforeNotice, Conversation } from './Conversation';
import { EmptySession } from './EmptySession';
import { failureCopy } from './failureCopy';
import { FakeBand } from './FakeBand';
import { NoTextNotice, noTextKind } from './NoTextNotice';
import { useTutorTab } from './tutorStore';
import { TutorOff } from './TutorOff';
import { useTutorRun } from './tutorRun';
import { useTutorPrefs } from './useTutorPrefs';
import { stopAnswer } from './useSend';
import { useAnswerComing } from './useSessionThread';

/** What the tutor panel shows: the consent card, the off state (나중에), the agent chooser, or the tab's session (`ready`). */
export type TutorPanelState = 'consent' | 'off' | 'chooser' | 'ready';

/** The tutor panel's state for the tab around the component (the active one outside a reader): the panel, its head and MainWindow read it alike. */
export function useTutorPanelState(): TutorPanelState {
  const prefs = useTutorPrefs();
  const choosing = useTutorTab((s) => s.choosing);
  const later = useTutorRun((s) => s.later);
  if (prefs.consent === null) return later ? 'off' : 'consent';
  return prefs.agent === null || choosing ? 'chooser' : 'ready';
}

/**
 * esc stops the answer of the tab's session from anywhere in the tutor's part of the right pane — its head (the mode segment, 새 세션)
 * included — with one press, never during a composition (spec 8.4). The listener is the window's, in the capture phase, and it is there
 * only while the answer comes: it runs before an open tooltip takes esc for itself (the tooltip still closes too). A menu or a popover
 * holds the focus outside the pane, so its own esc is untouched.
 */
function useEscStops(streaming: boolean): void {
  const scope = useReaderScope();
  useEffect(() => {
    if (!streaming) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A held esc repeats: the one stop is its first press.
      if (e.repeat || composerKey(e, { hasText: false, streaming: true, canSend: false }) !== 'stop') return;
      const at = document.activeElement;
      if (!(at instanceof Element) || at.closest('[data-pane="inspector"]') === null) return;
      stopAnswer(scope);
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, [streaming, scope]);
}

/**
 * The title of the tab's last failure, said once by a hidden alert (spec 8.3): emptied first, then filled a frame later, so the same title
 * again is a new alert too. One that was there before the panel showed is not said again.
 */
function FailureAlert() {
  const alert = useTutorTab((s) => s.alert);
  const before = useRef(alert);
  const [said, setSaid] = useState('');
  useEffect(() => {
    setSaid('');
    if (alert === null || alert === before.current) return;
    const frame = requestAnimationFrame(() => setSaid(failureCopy({ ...alert, loginCommand: null }).title));
    return () => cancelAnimationFrame(frame);
  }, [alert]);
  return (
    <span className="visually-hidden" role="alert" data-testid="tutor-alert">
      {said}
    </span>
  );
}

/**
 * The tab's session: a new empty one (the item's title over what to do) or the conversation, and the composer under it. Over both, one
 * line when the PDF's body text cannot be read (asking is not held back). A question that failed before its answer in a new session
 * stands as its notice over the empty session it left.
 */
function TabSession({ visible }: { visible: boolean }) {
  const scope = useReaderScope();
  const conversationId = useTutorTab((s) => s.conversationId);
  const notice = useTutorTab((s) => s.notice);
  const title = useItem(scope.id).data?.title ?? '';
  const noText = noTextKind(useItemDetail(scope.id).data?.text);
  useEscStops(useAnswerComing(conversationId) !== null);
  return (
    <div className="tutor-session" data-testid="tutor-session">
      {noText !== null && <NoTextNotice kind={noText} />}
      {conversationId === null ? (
        <EmptySession title={title} noText={noText} notice={notice === null ? null : <BeforeNotice notice={notice} />} />
      ) : (
        <Conversation key={conversationId} conversationId={conversationId} visible={visible} />
      )}
      <Composer visible={visible} />
      <FailureAlert />
    </div>
  );
}

/** Where the focus goes when a press changes the panel's state: the control that takes the place of the one that was pressed. */
type Landing = 'turnOn' | 'agree';
const SELECTOR: Record<Landing, string> = {
  turnOn: '[data-testid="tutor-turn-on"]',
  agree: '[data-testid="tutor-consent-agree"]',
};

/**
 * The first time the tab's tutor can be seen — or a PDF opens while it can — the outline's pages are resolved for its questions, the
 * first 300 entries, whether or not the outline pane is open (spec 5.1). Nothing waits for it: a question carries what is resolved.
 */
function useOutlineForQuestions(visible: boolean): void {
  const scope = useReaderScope();
  const doc = useReader((s) => s.handle)?.document() ?? null;
  useEffect(() => {
    if (visible && doc !== null) ensureOutline(scope, doc, TUTOR_LIMITS.outlineEntries);
  }, [visible, doc, scope]);
}

/**
 * The right panel's tutor mode, under the head the inspector draws: before consent the card (or, after 나중에, the off state), and
 * after consent the agent chooser until an agent is chosen (or 에이전트 고르기… asks for it again), then the tab's session — empty, or
 * the conversation (spec 8.2). Nothing here starts an agent, asks main which agents exist, or tells it a session is on screen before
 * the consent main records: the chooser is what asks, and it is mounted only after. The focus follows each state change, so the
 * button that was pressed never leaves it on <body>; after 동의 it lands in the chooser, after 시작 in the composer.
 */
export function TutorPanel({ visible }: { visible: boolean }) {
  useOutlineForQuestions(visible);
  const prefs = useTutorPrefs();
  const consented = prefs.consent !== null;
  const setChoosing = useTutorTab((s) => s.setChoosing);
  const setLater = useTutorRun((s) => s.setLater);
  const state = useTutorPanelState();
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
  // 시작 pressed in the chooser (the focus in it): the composer's text area takes the focus once this tab's session is on screen,
  // through the panel's focus request (which lands where F6 does). main's answer and its prefs notice may come in either order.
  const tabId = useReaderScope().id;
  const stateNow = useRef(state);
  stateNow.current = state;
  const owedFocus = useRef(createComposerFocus());
  useEffect(() => {
    if (owedFocus.current.step(state, tabId)) usePanelFocusRequest.getState().request();
  }, [state, tabId]);
  // A session row's click owed the conversation column the focus; a panel seen without the session (the card, the chooser, off)
  // lets it go, so the conversation it shows later does not take it.
  const logFocus = useTutorTab((s) => s.logFocus);
  const setLogFocus = useTutorTab((s) => s.setLogFocus);
  useEffect(() => {
    if (logFocus && visible && state !== 'ready') setLogFocus(false);
  }, [logFocus, visible, state, setLogFocus]);
  const started = (focusInside: boolean) => {
    if (focusInside) {
      owedFocus.current.owe(tabId);
      if (owedFocus.current.step(stateNow.current, tabId)) usePanelFocusRequest.getState().request();
    }
    setChoosing(false);
  };
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
      {state === 'chooser' && <AgentChooser visible={visible} focusRequest={chooserFocus} onStarted={started} />}
      {state === 'ready' && <TabSession visible={visible} />}
    </div>
  );
}
