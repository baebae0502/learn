import { useCallback } from 'react';
import { create } from 'zustand';
import type { AgentId, AgentsReport, MessageStatus, TutorAskInput } from '@learn/domain';
import { api } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';
import { useReader } from '../viewers/pdf/readerStore';
import { readerScopes, useReaderScope, type ReaderScope } from '../viewers/readerScope';
import { afterBusy } from './composerKeys';
import { draftKey, useTutorTab, type WaitingQuestion } from './tutorStore';
import { recheckAgent } from './useAgents';
import { answerComingIn } from './useSessionThread';
import { useTutorPrefs } from './useTutorPrefs';

/**
 * The tabs whose question is on its way (the agent checked again, then tutor:ask, or the question that waited): one at a time per tab,
 * whatever composer is mounted — the composer reads it to keep its text as it is meanwhile.
 */
const useOnTheWay = create<{ ids: readonly string[] }>()(() => ({ ids: [] }));
const onTheWay = (id: string): boolean => useOnTheWay.getState().ids.includes(id);
async function carrying(id: string, run: () => Promise<void>): Promise<void> {
  useOnTheWay.setState(({ ids }) => ({ ids: [...ids, id] }));
  try {
    await run();
  } finally {
    useOnTheWay.setState(({ ids }) => ({ ids: ids.filter((x) => x !== id) }));
  }
}

/**
 * The reader's numbers a question carries: its page and page count. The outline is the next task's (its snapshot cache): until then a
 * question carries none, and says the outline is not complete. Null while the PDF is still opening.
 */
function readerNow(scope: ReaderScope): TutorAskInput['reader'] | null {
  const pdf = scope.reader.getState().pdf;
  if (pdf?.ready !== true || pdf.pagesCount < 1) return null;
  return { pageIndex: Math.min(Math.max(pdf.pageNumber, 1), pdf.pagesCount) - 1, pageCount: pdf.pagesCount, outline: [], outlineComplete: false, outlineTotal: 0 };
}

/** Whether the agents report this window has says the agent is 준비됨 (no report yet: not known to be). */
function knownReady(agent: AgentId): boolean {
  const report = queryClient.getQueryData<AgentsReport>(keys.tutorAgents);
  const status = agent === 'fake' ? report?.fake : report?.agents.find((a) => a.id === agent);
  return status?.state === 'ready';
}

/**
 * The status of the answer a question waits for, read now (M19). A read that fails says nothing about it: the question keeps waiting
 * for that answer's end notice rather than asking main again at once (which would answer busy again while it still comes).
 */
async function statusOf(busyWith: WaitingQuestion['busyWith']): Promise<MessageStatus | null> {
  try {
    const r = await api().sessions.get({ conversationId: busyWith.conversationId });
    if (!r.ok) return 'streaming';
    return r.data.messages.find((m) => m.id === busyWith.messageId)?.status ?? null;
  } catch {
    return 'streaming';
  }
}

/**
 * tutor:ask for the tab of `scope`, and what its answer means for the tab (the caller carries the tab). Rows written: the draft goes,
 * the tab is on the session the question made, and its thread is read again, so the question's bubble shows at once. Another session's
 * answer still coming ({ busyWith }, J17): the question waits in the composer — and goes at once if that answer has already ended (M19).
 * Refused before anything was written (offline, the agent not ready or its login): the question stays in the composer; the failure's
 * notice is the next task's. Answers whether the question is to be sent again now.
 */
async function ask(scope: ReaderScope, text: string): Promise<boolean> {
  const reader = readerNow(scope);
  if (reader === null) return false;
  const from = scope.tutor.getState().conversationId;
  const key = draftKey(from, scope.id);
  let answer: Awaited<ReturnType<ReturnType<typeof api>['tutor']['ask']>>;
  try {
    answer = await api().tutor.ask({ itemId: scope.id, conversationId: from, text, selection: null, reader });
  } catch {
    answer = { ok: false, code: 'INTERNAL', message: '', retryable: false };
  }
  const tab = scope.tutor.getState();
  if (!answer.ok) {
    console.warn(`[tutor] ask failed: ${answer.code}`);
    tab.setWaiting(null);
    return false;
  }
  if ('busyWith' in answer.data) {
    // The tab went to another session meanwhile: that session's composer holds no question.
    if (tab.conversationId !== from) return false;
    const waiting = { text, busyWith: answer.data.busyWith };
    tab.setWaiting(waiting);
    const now = afterBusy(await statusOf(waiting.busyWith)) === 'send-now';
    return now && scope.tutor.getState().waiting === waiting;
  }
  // Only the text that went: a question let go of while it was on its way may have been edited since.
  if ((tab.drafts[key] ?? '').trim() === text) tab.setDraft(key, '');
  tab.setWaiting(null);
  if (tab.conversationId === from) tab.setConversation(answer.data.conversationId);
  void queryClient.invalidateQueries({ queryKey: keys.sessionThread(answer.data.conversationId) });
  return false;
}

/**
 * The question asked, and asked once more at once when main answered busy for an answer that had already ended (M19). Main clears
 * an ended answer before it reads the next request, so the second ask is not busy with it; were it busy with an ended one again, the
 * question keeps waiting (보내지 않기 lets it go) rather than asking main in a loop.
 */
async function askAndFollow(scope: ReaderScope, text: string): Promise<void> {
  if (!(await ask(scope, text))) return;
  if (await ask(scope, text)) console.warn('[tutor] ask: busy with an answer that has ended');
}

/** The question this tab waits with, asked once more (its wait ended); nothing when none waits or one is already on its way. */
function sendWaiting(scope: ReaderScope): void {
  const waiting = scope.tutor.getState().waiting;
  if (waiting === null || onTheWay(scope.id)) return;
  void carrying(scope.id, () => askAndFollow(scope, waiting.text));
}

/**
 * Once per window (MainWindow): a question that waits for another session's answer is sent once that answer ends — completed, failed
 * or stopped — in whatever tab it waits, shown or not. It is the send the user pressed, put off (spec 8.8: no other send is automatic).
 */
export function useWaitingSends(): void {
  useLearnEvent('tutor:turn', (e) => {
    if (e.kind !== 'done' && e.kind !== 'failed') return;
    for (const id of readerScopes.ids()) {
      const scope = readerScopes.peek(id);
      if (scope !== null && scope.tutor.getState().waiting?.busyWith.messageId === e.messageId) sendWaiting(scope);
    }
  });
}

/** 중지, esc and 답 중지: the answer the tab of `scope` receives stops, as it is (spec 8.8 중지). */
export function stopAnswer(scope: ReaderScope): void {
  const messageId = answerComingIn(scope);
  if (messageId === null) return;
  api().tutor.stop({ messageId }).then(
    (r) => {
      if (!r.ok) console.warn(`[tutor] stop failed: ${r.code}`);
    },
    () => console.warn('[tutor] stop failed: INTERNAL'),
  );
}

/** Whether a question of the tab around the component is on its way to main. */
export const useQuestionOnTheWay = (): boolean => {
  const id = useReaderScope().id;
  return useOnTheWay((s) => s.ids.includes(id));
};

/**
 * The composer's send, stop and 보내지 않기 for the tab around it (spec 8.4). A send needs text and the item open (`disabledReason` says
 * which is missing), no answer of this session coming, no question waiting and none on its way. The agent's state never holds it back
 * (R7): when this window does not know the agent as 준비됨, it is checked again first — the window's one check, so a second ↩ while it
 * runs does nothing — and the question is asked whatever the check found; main refuses it if the agent is still not ready.
 */
export function useSend(): { send(text: string): Promise<void>; stop(): void; cancelWaiting(): void; disabledReason: 'empty' | 'opening' | null } {
  const scope = useReaderScope();
  const opening = useReader((s) => s.pdf?.ready !== true);
  const empty = useTutorTab((s) => (s.drafts[draftKey(s.conversationId, scope.id)] ?? '').trim() === '');
  const agent = useTutorPrefs().agent;
  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      const tab = scope.tutor.getState();
      if (question === '' || agent === null || onTheWay(scope.id) || tab.waiting !== null || answerComingIn(scope) !== null || readerNow(scope) === null) return;
      if (knownReady(agent)) {
        await carrying(scope.id, () => askAndFollow(scope, question));
        return;
      }
      const check = recheckAgent(agent);
      if (check === null) return;
      await carrying(scope.id, async () => {
        await check;
        await askAndFollow(scope, question);
      });
    },
    [scope, agent],
  );
  return {
    send,
    stop: useCallback(() => stopAnswer(scope), [scope]),
    cancelWaiting: useCallback(() => scope.tutor.getState().setWaiting(null), [scope]),
    disabledReason: opening ? 'opening' : empty ? 'empty' : null,
  };
}
