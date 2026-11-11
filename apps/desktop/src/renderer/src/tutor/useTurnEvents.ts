import { verifiedPages, type SessionThread, type TutorTurnEvent } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';
import { readerScopes } from '../viewers/readerScope';
import { startsLive, type LiveTurn } from './useSessionThread';

/**
 * The live answer after one notice of it (P-16): text appended, a tool shown while it runs and kept once recorded — its pages then
 * count as verified so far (spec 7, J41). A notice of another answer starts that one. The end (done, failed) changes nothing here:
 * the thread read again then takes over.
 */
export function applyTurnEvent(live: LiveTurn | null, e: TutorTurnEvent): LiveTurn | null {
  if (e.kind === 'done' || e.kind === 'failed') return live;
  const base: LiveTurn = live?.tutorMessageId === e.messageId ? live : { tutorMessageId: e.messageId, text: '', tools: [], running: null, verifiedSoFar: new Set() };
  if (e.kind === 'text') return { ...base, text: base.text + e.append };
  if (e.running) return { ...base, running: e.chip };
  const tools = [...base.tools, e.chip];
  return { ...base, tools, running: null, verifiedSoFar: verifiedPages(tools) };
}

/** The tutor store of the open tab that shows this session, if one does. */
function tabShowing(conversationId: string) {
  for (const id of readerScopes.ids()) {
    const tutor = readerScopes.peek(id)?.tutor;
    if (tutor?.getState().conversationId === conversationId) return tutor;
  }
  return null;
}

/**
 * Once per window (MainWindow): what main says about answers goes to the tab that shows their session, whether or not its panel is on
 * screen, so a panel shown later has the whole answer. An answer that ended has its thread read again (with its sources). A new
 * session main created for an item is the one that item's tab shows if the tab was on a new empty session: its question made it.
 */
export function useTurnEvents(): void {
  useLearnEvent('tutor:turn', (e) => {
    if (e.kind === 'done' || e.kind === 'failed') {
      void queryClient.invalidateQueries({ queryKey: keys.sessionThread(e.conversationId) });
      return;
    }
    const tab = tabShowing(e.conversationId);
    if (tab === null) return;
    const { live, setLive } = tab.getState();
    if (live?.tutorMessageId !== e.messageId) {
      const stored = queryClient.getQueryData<SessionThread>(keys.sessionThread(e.conversationId));
      // An answer heard from its middle (a reload, a session shown again) stays the stored one's, read again every 2 s.
      if (!startsLive(stored, e.messageId)) return;
      // A new turn of a session already read (another question, a resend): its rows are read, so its bubbles are drawn.
      if (stored !== undefined && !stored.messages.some((m) => m.id === e.messageId)) void queryClient.invalidateQueries({ queryKey: keys.sessionThread(e.conversationId) });
    }
    setLive(applyTurnEvent(live, e));
  });
  useLearnEvent('sessions:changed', (c) => {
    if (c.reason !== 'created') return;
    c.itemIds.forEach((itemId, k) => {
      const tutor = readerScopes.peek(itemId)?.tutor;
      const id = c.conversationIds[k];
      if (tutor !== undefined && id !== undefined && tutor.getState().conversationId === null) tutor.getState().setConversation(id);
    });
  });
}
