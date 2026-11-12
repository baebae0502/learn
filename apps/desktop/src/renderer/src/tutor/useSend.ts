import { useCallback } from 'react';
import { create } from 'zustand';
import type { AgentId, AgentsReport, MessageStatus, TutorAskInput } from '@learn/domain';
import { api } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';
import { perfMarkLatest } from '../ui/perfMarks';
import { outlineSnapshot } from '../viewers/pdf/outlineCache';
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
/** Whether a question of tab `id` is on its way to main (its chip goes with it: a selection meanwhile is not attached). */
export const questionOnTheWay = onTheWay;
async function carrying(id: string, run: () => Promise<void>): Promise<void> {
  useOnTheWay.setState(({ ids }) => ({ ids: [...ids, id] }));
  try {
    await run();
  } finally {
    useOnTheWay.setState(({ ids }) => ({ ids: ids.filter((x) => x !== id) }));
  }
}

/**
 * The reader's numbers a question carries: its page, its page count and its outline as far as the tab's cache has resolved it — never
 * waited for (spec 5.1, J25, J63). Null while the PDF is still opening.
 */
function readerNow(scope: ReaderScope): TutorAskInput['reader'] | null {
  const { pdf, outline } = scope.reader.getState();
  if (pdf?.ready !== true || pdf.pagesCount < 1) return null;
  return { pageIndex: Math.min(Math.max(pdf.pageNumber, 1), pdf.pagesCount) - 1, pageCount: pdf.pagesCount, ...outlineSnapshot(outline) };
}

/** Whether the agents report this window has says the agent is 준비됨 (no report yet: not known to be). */
function knownReady(agent: AgentId): boolean {
  const report = queryClient.getQueryData<AgentsReport>(keys.tutorAgents);
  const status = agent === 'fake' ? report?.fake : report?.agents.find((a) => a.id === agent);
  return status?.state === 'ready';
}

/**
 * The status of the answer a question waits for, read now. A session that is gone (deleted, or its only question failed before any
 * answer, which takes the session with it) has no answer coming: null. Any other failed read is tried once more; failing again, it
 * counts as ended too — the question is then asked, and main answers busy again if that answer still comes. A wait never hangs.
 */
async function statusOf(busyWith: WaitingQuestion['busyWith']): Promise<MessageStatus | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await api().sessions.get({ conversationId: busyWith.conversationId });
      if (r.ok) return r.data.messages.find((m) => m.id === busyWith.messageId)?.status ?? null;
      if (r.code === 'NOT_FOUND') return null;
      console.warn(`[tutor] status read failed: ${r.code}`);
    } catch {
      console.warn('[tutor] status read failed: INTERNAL');
    }
  }
  return null;
}

/**
 * tutor:ask for the tab of `scope`, and what its answer means for the tab (the caller carries the tab). The question carries the passage
 * attached in the composer, if any. Rows written: the draft and the chip go, the tab is on the session the question made, and its thread
 * is read again, so the question's bubble shows at once. Another session's answer still coming ({ busyWith }): the question waits in the
 * composer with its chip — and goes at once if that answer has already ended, by the status read now or by its end notice that came
 * while the read was out (main may answer busy just before it ends the turn). Refused before anything was written (offline, the agent
 * not ready or its login): the question and its chip stay in the composer; the failure's notice is the next task's. Answers whether the
 * question is to be sent again now.
 */
async function ask(scope: ReaderScope, text: string): Promise<boolean> {
  const reader = readerNow(scope);
  if (reader === null) return false;
  const from = scope.tutor.getState().conversationId;
  const key = draftKey(from, scope.id);
  const attached = scope.tutor.getState().attached;
  let answer: Awaited<ReturnType<ReturnType<typeof api>['tutor']['ask']>>;
  try {
    answer = await api().tutor.ask({ itemId: scope.id, conversationId: from, text, selection: attached === null ? null : { anchor: attached.anchor, text: attached.text }, reader });
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
    const { busyWith } = answer.data;
    tab.setWaiting({ text, busyWith });
    const status = await statusOf(busyWith);
    const waiting = scope.tutor.getState().waiting;
    // Let go of meanwhile (보내지 않기, another session): nothing is sent.
    if (waiting === null || waiting.busyWith.messageId !== busyWith.messageId) return false;
    return waiting.ended === true || afterBusy(status) === 'send-now';
  }
  // Only the text that went: a question let go of while it was on its way may have been edited since. The same for the chip.
  if ((tab.drafts[key] ?? '').trim() === text) tab.setDraft(key, '');
  if (attached !== null && tab.attached === attached) tab.setAttached(null);
  tab.setWaiting(null);
  if (tab.conversationId === from) {
    tab.setConversation(answer.data.conversationId);
    // This tab's own question: its answer is heard from the start (notices before this one made it already), whatever order main's
    // notices and its answer to the read below arrive in — a read that came first must not leave the answer to the 2 s re-reads.
    const { live, setLive } = scope.tutor.getState();
    const id = answer.data.tutorMessageId;
    setLive(live?.tutorMessageId === id ? { ...live, fromStart: true } : { tutorMessageId: id, text: '', tools: [], running: null, verifiedSoFar: new Set(), fromStart: true });
  }
  void queryClient.invalidateQueries({ queryKey: keys.sessionThread(answer.data.conversationId) });
  return false;
}

/**
 * The question asked, and asked once more at once when the answer it waited for had already ended. Main clears an ended answer before
 * it reads the next request, so the second ask is not busy with it; were it busy with an ended one again, the question keeps waiting
 * (보내지 않기 lets it go, the next end notice sends it) rather than asking main in a loop.
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
 * The answer `messageId` ended (completed, failed or stopped): a question that waits for it is sent once, in whatever tab it waits,
 * shown or not — the send the user pressed, put off (spec 8.8: no other send is automatic). While that tab's question is on its way
 * (the status read is out), the end is kept on the waiting question for the read's caller to act on, never dropped.
 */
export function waitEnded(messageId: string): void {
  for (const id of readerScopes.ids()) {
    const scope = readerScopes.peek(id);
    const waiting = scope?.tutor.getState().waiting;
    if (scope === null || scope === undefined || waiting?.busyWith.messageId !== messageId) continue;
    if (onTheWay(scope.id)) scope.tutor.getState().setWaiting({ ...waiting, ended: true });
    else sendWaiting(scope);
  }
}

/** Once per window (MainWindow): the end notices of answers, for the questions that wait for them. */
export function useWaitingSends(): void {
  useLearnEvent('tutor:turn', (e) => {
    if (e.kind === 'done' || e.kind === 'failed') waitEnded(e.messageId);
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
 * A send from the composer of the tab of `scope`: it needs text, the item open, no answer of this session coming, no question waiting
 * and none on its way. The agent's state never holds it back: when this window does not know the agent as 준비됨, it is checked again
 * first — the window's one check, so a second ↩ while it runs does nothing — and the question is asked whatever the check found; main
 * refuses it if the agent is still not ready.
 */
export async function sendQuestion(scope: ReaderScope, text: string, agent: AgentId | null): Promise<void> {
  const question = text.trim();
  const tab = scope.tutor.getState();
  if (question === '' || agent === null || onTheWay(scope.id) || tab.waiting !== null || answerComingIn(scope) !== null || readerNow(scope) === null) return;
  // Where tutor-perf times a send from (to its first text painted, Bubble.tsx).
  perfMarkLatest('tutor:send');
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
}

/**
 * The composer's send, stop and 보내지 않기 for the tab around it (spec 8.4); `disabledReason` says what a send is missing (the agent's
 * state is never one).
 */
export function useSend(): { send(text: string): Promise<void>; stop(): void; cancelWaiting(): void; disabledReason: 'empty' | 'opening' | null } {
  const scope = useReaderScope();
  const opening = useReader((s) => s.pdf?.ready !== true);
  const empty = useTutorTab((s) => (s.drafts[draftKey(s.conversationId, scope.id)] ?? '').trim() === '');
  const agent = useTutorPrefs().agent;
  return {
    send: useCallback((text: string) => sendQuestion(scope, text, agent), [scope, agent]),
    stop: useCallback(() => stopAnswer(scope), [scope]),
    cancelWaiting: useCallback(() => scope.tutor.getState().setWaiting(null), [scope]),
    disabledReason: opening ? 'opening' : empty ? 'empty' : null,
  };
}
