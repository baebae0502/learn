import { useCallback } from 'react';
import { create } from 'zustand';
import type { AgentId, AgentsReport, ErrorCode, MessageStatus, Prefs, SessionThread, TutorAskInput, TutorTurnEvent } from '@learn/domain';
import { api } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';
import { t } from '../strings';
import { perfMarkLatest } from '../ui/perfMarks';
import { outlineSnapshot } from '../viewers/pdf/outlineCache';
import { useReader } from '../viewers/pdf/readerStore';
import { readerScopes, useReaderScope, type ReaderScope } from '../viewers/readerScope';
import { afterBusy } from './composerKeys';
import { draftKey, useTutorTab, type SentTurn, type WaitingQuestion } from './tutorStore';
import { recheckAgent, useAgentsRun } from './useAgents';
import { answerComingIn, useAnswerComing } from './useSessionThread';
import { useTutorPrefs } from './useTutorPrefs';

const { composer } = t.tutor;

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
 * waited for (spec 5.1). Null while the PDF is still opening.
 */
function readerNow(scope: ReaderScope): TutorAskInput['reader'] | null {
  const { pdf, outline } = scope.reader.getState();
  if (pdf?.ready !== true || pdf.pagesCount < 1) return null;
  return { pageIndex: Math.min(Math.max(pdf.pageNumber, 1), pdf.pagesCount) - 1, pageCount: pdf.pagesCount, ...outlineSnapshot(outline) };
}

/** The highest seq of the session as this window read it (0 for none, or a new session): where a turn that is gone stood after. */
function lastSeq(conversationId: string | null): number {
  if (conversationId === null) return 0;
  const thread = queryClient.getQueryData<SessionThread>(keys.sessionThread(conversationId));
  return thread?.messages.reduce((top, m) => Math.max(top, m.seq), 0) ?? 0;
}

/** The agent the next turn of the tab's session goes to: the chosen one, else the session's own. */
function nextAgent(conversationId: string | null): AgentId {
  const chosen = queryClient.getQueryData<Prefs>(keys.prefs)?.tutor.agent ?? null;
  if (chosen !== null) return chosen;
  const thread = conversationId === null ? undefined : queryClient.getQueryData<SessionThread>(keys.sessionThread(conversationId));
  return thread?.session.agent ?? 'claude';
}

/** Refusals that are not a failure to show: another answer still coming (the waiting line's), Learn quitting, the consent gone. */
const quietRefusal = (code: ErrorCode): boolean => code === 'AGENT_BUSY' || code === 'CANCELLED' || code === 'TUTOR_CONSENT_REQUIRED';

/** What a refusal says of the window's own reads: the consent gone (the panel shows its card again), a report main has changed. */
function readAgainAfter(code: ErrorCode): void {
  if (code === 'TUTOR_CONSENT_REQUIRED') void queryClient.invalidateQueries({ queryKey: keys.prefs });
  if (code === 'AGENT_LOGIN' || code === 'AGENT_NOT_READY') void queryClient.invalidateQueries({ queryKey: keys.tutorAgents });
}

/**
 * A turn of the tab of `scope` failed before its answer began (or main refused to start it): a question goes back to the composer it
 * came from — its text into that session's draft (unless something was written there since) — and a new session that question made is
 * gone with it, so the tab is on a new empty session again. Where the tab still shows that session, its passage goes back onto the chip
 * (unless another was attached since: the chip is the tab's, whatever session it shows), the notice stands where the turn would have
 * been, the hidden alert says it once, and the composer takes the focus with its caret at the end. A 원문 근거 요청 has nothing to give
 * back: its notice only. Nothing is sent again (spec 8.8).
 */
function giveBack(scope: ReaderScope, turn: SentTurn, code: ErrorCode): void {
  const tab = scope.tutor.getState();
  if (turn.kind === 'question') {
    const key = draftKey(turn.from, scope.id);
    if ((tab.drafts[key] ?? '').trim() === '') tab.setDraft(key, turn.text);
  }
  if (turn.from === null && tab.conversationId === turn.conversationId) tab.setConversation(null);
  const now = scope.tutor.getState();
  if (now.conversationId !== turn.from) return;
  if (turn.kind === 'question' && turn.attached !== null && now.attached === null) now.setAttached(turn.attached);
  now.setNotice({ code, afterSeq: turn.afterSeq, agent: turn.agent, ...(turn.kind === 'reground' ? { reground: true as const } : {}) });
  now.say({ code, phase: 'before', agent: turn.agent });
  if (turn.kind === 'question') now.focusComposer();
}

/**
 * main's notice that an answer failed: the tab that sent its turn gives it back when it failed before the answer began (giveBack); one
 * that failed during it is said once by the tab that shows its session (its notice is the failed answer's own).
 */
export function turnFailed(e: Extract<TutorTurnEvent, { kind: 'failed' }>): void {
  let agent: AgentId | null = null;
  for (const id of readerScopes.ids()) {
    const scope = readerScopes.peek(id);
    const turn = scope?.tutor.getState().sent;
    if (scope === undefined || scope === null || turn?.tutorMessageId !== e.messageId) continue;
    scope.tutor.getState().setSent(null);
    if (e.phase === 'before') {
      giveBack(scope, turn, e.code);
      return;
    }
    agent = turn.agent;
    break;
  }
  if (e.phase !== 'during') return;
  for (const id of readerScopes.ids()) {
    const tab = readerScopes.peek(id)?.tutor.getState();
    if (tab?.conversationId !== e.conversationId) continue;
    const thread = queryClient.getQueryData<SessionThread>(keys.sessionThread(e.conversationId));
    tab.say({ code: e.code, phase: 'during', agent: agent ?? thread?.messages.find((m) => m.id === e.messageId)?.agent ?? thread?.session.agent ?? nextAgent(e.conversationId) });
    return;
  }
}

/** An answer ended: the tab that sent its turn lets go of it (a notice of its text may still come before a failure before the answer). */
export function turnSettled(messageId: string): void {
  for (const id of readerScopes.ids()) {
    const tab = readerScopes.peek(id)?.tutor.getState();
    if (tab?.sent?.tutorMessageId === messageId) tab.setSent(null);
  }
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
 * is read again, so the question's bubble shows at once; the tab keeps what it sent until the answer ends, to give it back if the answer
 * fails before it begins. Another session's answer still coming ({ busyWith }): the question waits in the composer with its chip — and
 * goes at once if that answer has already ended, by the status read now or by its end notice that came while the read was out (main may
 * answer busy just before it ends the turn). Refused before anything was written (offline, the agent not ready or its login): the
 * question and its chip stay in the composer, and the refusal's notice stands. Answers whether the question is to be sent again now.
 */
async function ask(scope: ReaderScope, text: string): Promise<boolean> {
  const reader = readerNow(scope);
  if (reader === null) return false;
  const from = scope.tutor.getState().conversationId;
  const key = draftKey(from, scope.id);
  const attached = scope.tutor.getState().attached;
  const afterSeq = lastSeq(from);
  const agent = nextAgent(from);
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
    // The command of a login, or the state of an agent the window still thought ready, is in the report main has now.
    readAgainAfter(answer.code);
    if (!quietRefusal(answer.code)) giveBack(scope, { kind: 'question', tutorMessageId: '', conversationId: from ?? '', from, text, attached: null, afterSeq, agent }, answer.code);
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
  const id = answer.data.tutorMessageId;
  const turn: SentTurn = { kind: 'question', tutorMessageId: id, conversationId: answer.data.conversationId, from, text, attached, afterSeq, agent };
  void queryClient.invalidateQueries({ queryKey: keys.sessionThread(answer.data.conversationId) });
  // Its failure before any answer came first: the question never left the composer, and there is nothing left to hear.
  const dropped = tab.droppedAnswers.find((d) => d.messageId === id);
  if (dropped !== undefined) {
    tab.setWaiting(null);
    if (tab.live?.tutorMessageId === id) tab.setLive(null);
    giveBack(scope, turn, dropped.code);
    return false;
  }
  // Only the text that went: a question let go of while it was on its way may have been edited since. The same for the chip.
  if ((tab.drafts[key] ?? '').trim() === text) tab.setDraft(key, '');
  if (attached !== null && tab.attached === attached) tab.setAttached(null);
  tab.setWaiting(null);
  tab.setSent(turn);
  if (tab.conversationId === from) tab.setConversation(answer.data.conversationId);
  // This tab's own question, the tab on its session (a new session's first question moved it there already, through main's notice
  // that the session was made): its answer is heard from the start (notices before this one made it already), whatever order main's
  // notices and the rows a read brings arrive in — a read that came first must not leave the answer to the 2 s re-reads.
  hearFromStart(scope, answer.data.conversationId, id);
  return false;
}

/** The tab's own turn, the tab on its session: its answer is heard from its start (notices before this one made it already). */
function hearFromStart(scope: ReaderScope, conversationId: string, id: string): void {
  const now = scope.tutor.getState();
  if (now.conversationId !== conversationId) return;
  now.setLive(now.live?.tutorMessageId === id ? { ...now.live, fromStart: true } : { tutorMessageId: id, text: '', tools: [], running: null, verifiedSoFar: new Set(), fromStart: true });
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
 * Why a turn of the tab around the component cannot go now — the item still opens, a question waits for another session's answer or is
 * on its way (the agent being checked again first), an answer of this session comes — in the composer's own words for the same state;
 * null when it can. 다시 보내기 and 원문 근거로 다시 묻기 wait with it.
 */
export function useTurnHeld(): string | null {
  const opening = useReader((s) => s.pdf?.ready !== true);
  const conversationId = useTutorTab((s) => s.conversationId);
  const waiting = useTutorTab((s) => s.waiting !== null);
  const coming = useAnswerComing(conversationId) !== null;
  const onTheWay = useQuestionOnTheWay();
  const checking = useAgentsRun((s) => s.busy);
  if (opening) return composer.sendOpening;
  if (waiting) return composer.sendWaiting;
  if (onTheWay && checking) return t.tutor.agents.searchingTip;
  return coming || onTheWay ? composer.receiving : null;
}

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
  // The send that goes takes the last failure's notice with it.
  const going = () => {
    tab.setNotice(null);
    tab.setRetryRefused(null);
  };
  // perfMarkLatest('tutor:send'): where tutor-perf times a send from (to its first text painted, Bubble.tsx) — only a send that goes.
  if (knownReady(agent)) {
    going();
    perfMarkLatest('tutor:send');
    await carrying(scope.id, () => askAndFollow(scope, question));
    return;
  }
  const check = recheckAgent(agent);
  if (check === null) return;
  going();
  perfMarkLatest('tutor:send');
  await carrying(scope.id, async () => {
    await check;
    await askAndFollow(scope, question);
  });
}

/** Whether a turn of the tab of `scope` can go now: the item open, no answer of its session coming, no question waiting or on its way. */
const canGo = (scope: ReaderScope): boolean =>
  !onTheWay(scope.id) && scope.tutor.getState().waiting === null && answerComingIn(scope) === null && readerNow(scope) !== null;

/**
 * 다시 보내기 under a failed answer (spec 8.8): main deletes it and asks the same question again from the start, in a new agent
 * process; the new answer is heard from its start. Refused (offline, busy, the agent not ready — nothing changed): the failed answer's
 * notice says that code, and the composer is as it was. One press at a time.
 */
export async function resendAnswer(scope: ReaderScope, messageId: string): Promise<void> {
  if (!canGo(scope)) return;
  const tab = scope.tutor.getState();
  tab.setNotice(null);
  tab.setRetryRefused(null);
  const conversationId = tab.conversationId;
  await carrying(scope.id, async () => {
    const reader = readerNow(scope);
    if (reader === null) return;
    let r: Awaited<ReturnType<ReturnType<typeof api>['tutor']['resend']>>;
    try {
      r = await api().tutor.resend({ messageId, reader });
    } catch {
      r = { ok: false, code: 'INTERNAL', message: '', retryable: false };
    }
    const now = scope.tutor.getState();
    if (now.conversationId !== conversationId) return;
    if (!r.ok) {
      console.warn(`[tutor] resend failed: ${r.code}`);
      readAgainAfter(r.code);
      if (r.code === 'CANCELLED' || r.code === 'TUTOR_CONSENT_REQUIRED') return;
      now.setRetryRefused({ messageId, code: r.code });
      now.say({ code: r.code, phase: 'during', agent: nextAgent(conversationId) });
      return;
    }
    if (conversationId !== null) {
      hearFromStart(scope, conversationId, r.data.tutorMessageId);
      void queryClient.invalidateQueries({ queryKey: keys.sessionThread(conversationId) });
    }
  });
}

/**
 * 원문 근거로 다시 묻기 under an answer that cited pages it did not read (spec 7): a new visible turn of the session that asks the
 * agent to read those pages first. It gives nothing back to the composer: a failure before its answer, or main's refusal, leaves only its
 * notice's title after the answer it doubted (whose own notice then has its button again). One press at a time.
 */
export async function regroundAnswer(scope: ReaderScope, messageId: string): Promise<void> {
  if (!canGo(scope)) return;
  const tab = scope.tutor.getState();
  const conversationId = tab.conversationId;
  if (conversationId === null) return;
  tab.setNotice(null);
  tab.setRetryRefused(null);
  const afterSeq = lastSeq(conversationId);
  const agent = nextAgent(conversationId);
  await carrying(scope.id, async () => {
    const reader = readerNow(scope);
    if (reader === null) return;
    let r: Awaited<ReturnType<ReturnType<typeof api>['tutor']['reground']>>;
    try {
      r = await api().tutor.reground({ messageId, reader });
    } catch {
      r = { ok: false, code: 'INTERNAL', message: '', retryable: false };
    }
    const turn: SentTurn = { kind: 'reground', tutorMessageId: r.ok ? r.data.tutorMessageId : '', conversationId, from: conversationId, text: '', attached: null, afterSeq, agent };
    if (!r.ok) {
      console.warn(`[tutor] reground failed: ${r.code}`);
      readAgainAfter(r.code);
      if (r.code !== 'CANCELLED' && r.code !== 'TUTOR_CONSENT_REQUIRED') giveBack(scope, turn, r.code);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: keys.sessionThread(conversationId) });
    const now = scope.tutor.getState();
    const dropped = now.droppedAnswers.find((d) => d.messageId === turn.tutorMessageId);
    if (dropped !== undefined) {
      giveBack(scope, turn, dropped.code);
      return;
    }
    now.setSent(turn);
    hearFromStart(scope, conversationId, turn.tutorMessageId);
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
