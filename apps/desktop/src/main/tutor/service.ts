import fs from 'node:fs';
import {
  CONSENT_VERSION, LearnError, TUTOR_TIMEOUTS, checkCitations, pdfSpanAnchor, regroundPages,
  type AgentId, type AgentsReport, type AgentStatus, type ErrorCode, type ReaderSnapshot, type SessionsChanged, type TutorAgentsInput, type TutorAskAnswer,
  type TutorAskInput, type TutorPrefs, type TutorRetryInput, type TutorTurnEvent, type TutorWarmInput,
} from '@learn/domain';
import type { LibraryContext } from '../library-context';
import type { PrefsStore } from '../prefs';
import { mainStrings } from '../strings';
import type { PromptOutcome } from './acp/client';
import type { AgentDetector } from './agents/detect';
import { agentHomePath, historyDirs, isLoginRequired, workDirPath } from './agents/isolation';
import type { SessionKey, Supervisor } from './agents/supervisor';
import type { AgentSession, StartInput, TutorBackend } from './backend';
import { tutorLog } from './log';
import { buildPrompt, regroundInstruction, replayWindow } from './prompts';
import { guardPromptSelection, type ScopeRegistry, type TurnSelection } from './scope';
import { runTurn, type TurnDeps, type TurnEnd } from './turn';

export interface TutorServiceDeps {
  context(): LibraryContext; prefs: PrefsStore; prefsChanged(): void;
  backend: TutorBackend; detector: AgentDetector; supervisor: Supervisor<unknown>; scopes: ScopeRegistry;
  /** tutorNetwork (E2E) wins over isOnline when it is set. */
  isOnline(): boolean; network(): 'online' | 'offline' | null;
  prioritize(sha256: string): void;
  emitTurn(e: TutorTurnEvent): void; emitSessions(e: SessionsChanged): void;
  userData: string; tutorHome: string; home: string; fakeAvailable: boolean; now(): string; timers: TurnDeps['timers'];
}

export interface TutorService {
  consent(): void;
  agents(i: TutorAgentsInput): Promise<AgentsReport>;
  chooseAgent(agent: AgentId): Promise<void>;
  view(v: SessionKey | null): void;
  warm(i: TutorWarmInput): Promise<void>;
  ask(i: TutorAskInput): Promise<TutorAskAnswer>;
  stop(messageId: string): void;
  resend(i: TutorRetryInput): Promise<{ tutorMessageId: string }>;
  reground(i: TutorRetryInput): Promise<{ userMessageId: string; tutorMessageId: string }>;
  removeWorkFolders(conversationIds: readonly string[]): Promise<void>;
  setTimeouts(t: Partial<{ firstUpdateMs: number; betweenMs: number; idleMs: number }>): void;
  processes(): { count: number; max: number; conversationIds: Array<string | null> };
  resetProcessMax(): void;
  killAgent(): void;
  shutdown(maxMs: number): Promise<void>;
}

/** The item a turn reads: a PDF outside the trash, as of now. */
interface Target { itemId: string; revisionId: string; sha256: string; title: string }

/** The one turn that may run: the supervisor lets one key answer at a time. */
interface Turn {
  readonly key: SessionKey;
  readonly agent: AgentId;
  readonly target: Target;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly tutorMessageId: string;
  readonly userSeq: number;
  readonly question: string;
  readonly selection: TurnSelection | null;
  readonly reader: ReaderSnapshot;
  /** A question or a reground drops its pair when it fails before an answer; a resend leaves a failed answer. */
  readonly beforeAnswer: 'drop-pair' | 'keep-failed';
  session: AgentSession | null;
  stopped: boolean;
}

/** What a stop before the prompt was sent ends with: no prompt, the answer stopped. */
const NOT_SENT: PromptOutcome = { stopReason: 'cancelled', lockdown: false, model: null, inputTokens: null, outputTokens: null };
const sameKey = (a: SessionKey, b: SessionKey) => a.itemId === b.itemId && a.conversationId === b.conversationId;
const codeOf = (e: unknown): string => (e instanceof LearnError ? e.code : e instanceof Error ? e.name : 'UNKNOWN');
const invalid = () => new LearnError('VALIDATION_FAILED', 'This tutor request does not fit the session.');
const consented = (t: TutorPrefs): boolean => t.consent?.version === CONSENT_VERSION;

/** A start's failure as the answer tells it: the agent's own code, else the start failed. */
function startCode(e: unknown): ErrorCode {
  if (e instanceof LearnError && e.code.startsWith('AGENT_')) return e.code;
  if (isLoginRequired(e)) return 'AGENT_LOGIN';
  return 'AGENT_START_FAILED';
}

export function createTutorService(d: TutorServiceDeps): TutorService {
  const timeouts = { firstUpdateMs: TUTOR_TIMEOUTS.firstUpdateMs as number, betweenMs: TUTOR_TIMEOUTS.betweenMs as number, turnMs: TUTOR_TIMEOUTS.turnMs as number };
  let active: Turn | null = null;
  let shuttingDown = false;

  const repo = () => d.context().conversations;
  const tutorPrefs = () => d.prefs.get().tutor;

  const requireConsent = (): TutorPrefs => {
    const t = tutorPrefs();
    if (!consented(t)) throw new LearnError('TUTOR_CONSENT_REQUIRED', 'The tutor needs consent first.');
    return t;
  };

  const statusOf = (report: AgentsReport, agent: AgentId): AgentStatus | null =>
    agent === 'fake' ? (d.fakeAvailable ? report.fake : null) : (report.agents.find((a) => a.id === agent) ?? null);
  const notReady = (s: AgentStatus | null): LearnError =>
    s?.state === 'login' ? new LearnError('AGENT_LOGIN', 'The agent needs its login.') : new LearnError('AGENT_NOT_READY', 'The agent is not ready.');

  /** Before anything is written, in order: consent, offline, the chosen agent ready in the cached report (with none cached, the start detects). */
  const precheck = (): AgentId => {
    const agent = requireConsent().agent;
    // The fake needs no network; only the test hook takes it offline.
    const net = agent === 'fake' ? d.network() : (d.network() ?? (d.isOnline() ? 'online' : 'offline'));
    if (net === 'offline') throw new LearnError('OFFLINE', 'Learn is offline.');
    if (agent === null || (agent === 'fake' && !d.fakeAvailable)) throw notReady(null);
    const report = d.detector.cachedReport();
    if (report !== null) {
      const s = statusOf(report, agent);
      if (s?.state !== 'ready') throw notReady(s);
    }
    return agent;
  };

  /** The turn a send must wait for: another key's answer, or this key's own one still streaming. */
  const busyTurn = (key: SessionKey): Turn | 'unknown' | null => {
    const other = d.supervisor.busyWith(key);
    if (other !== null) return active !== null && sameKey(active.key, other) ? active : 'unknown';
    return active !== null && sameKey(active.key, key) ? active : null;
  };
  const refuseBusy = (key: SessionKey) => {
    if (busyTurn(key) !== null) throw new LearnError('AGENT_BUSY', 'Another answer is streaming.');
  };

  const targetOf = (ctx: LibraryContext, itemId: string, conversationId: string | null): Target | null => {
    const item = ctx.repo.getItem(itemId);
    if (!item || item.type !== 'pdf') return null;
    if (conversationId !== null) {
      const c = ctx.conversations.conversation(conversationId);
      if (!c || c.itemId !== itemId || c.deleted) return null;
    }
    const asset = ctx.repo.getAsset(item.assetId);
    if (!asset) return null;
    return { itemId, revisionId: item.revisionId, sha256: asset.sha256, title: item.title };
  };

  const conversationInput = (conversationId: string, agent: AgentId, target: Target, reader: ReaderSnapshot | null): NonNullable<StartInput['conversation']> => {
    const c = repo().conversation(conversationId);
    return {
      id: conversationId,
      agentSessionId: c?.agentSessionId ?? null,
      agentOfSession: c?.agent ?? agent,
      scopeInit: {
        conversationId, itemId: target.itemId, revisionId: target.revisionId, sha256: target.sha256, title: target.title,
        // A warm has no reader numbers yet; the turn sets them before its prompt.
        pageCount: reader?.pageCount ?? 1,
        outline: { entries: reader?.outline ?? [], complete: reader?.outlineComplete ?? false, total: reader?.outlineTotal ?? 0 },
        readerPage: reader?.pageIndex ?? 0,
      },
    };
  };

  const sessionsChanged = (reason: SessionsChanged['reason'], t: { itemId: string; conversationId: string }) => {
    d.emitSessions({ reason, itemIds: [t.itemId], conversationIds: [t.conversationId] });
  };

  /** What the detector learns from a failure goes in before the failure is told: the renderer reads the report again when it hears it. */
  const emitTurn = (agent: AgentId, e: TutorTurnEvent) => {
    if (e.kind === 'failed') {
      if (e.code === 'AGENT_LOGIN') d.detector.markLogin(agent);
      if (e.code === 'AGENT_LOCKDOWN') d.detector.markLockedOut(agent);
    }
    d.emitTurn(e);
  };

  /** A turn that failed before its prompt: the same rule as a failure before the answer. */
  const failBefore = (t: Turn, code: ErrorCode) => {
    if (shuttingDown) return;
    let deleted = false;
    try {
      if (t.beforeAnswer === 'drop-pair') deleted = repo().dropBeforeAnswer(t.userMessageId, t.tutorMessageId).conversationDeleted;
      else repo().finishTurn(t.tutorMessageId, { status: 'failed', text: '', stopReason: null, errorCode: code, revisionId: t.target.revisionId, verified: [] }, d.now());
    } catch (e) {
      tutorLog('turn-end-failed', { code: codeOf(e) });
    }
    emitTurn(t.agent, { conversationId: t.conversationId, messageId: t.tutorMessageId, kind: 'failed', phase: t.beforeAnswer === 'drop-pair' ? 'before' : 'during', code });
    sessionsChanged(deleted ? 'deleted' : 'updated', { itemId: t.target.itemId, conversationId: t.conversationId });
  };

  /** The session the turn runs on is the conversation's from now: a new one (or one of another agent) is stored with its agent. */
  const keepSession = (t: Turn, s: AgentSession) => {
    const c = repo().conversation(t.conversationId);
    if (c && s.sessionId !== null && (c.agentSessionId !== s.sessionId || c.agent !== t.agent)) repo().setAgentSession(t.conversationId, t.agent, s.sessionId, d.now());
  };

  /** Everything after the start was called: nothing here may throw, and the turn always ends. */
  const play = async (t: Turn, started: Promise<AgentSession>): Promise<void> => {
    try {
      let s: AgentSession;
      try {
        s = await started;
      } catch (e) {
        failBefore(t, startCode(e));
        return;
      }
      t.session = s;
      let blocks: Array<{ type: 'text'; text: string }>;
      try {
        const scope = s.scope;
        if (scope === null) throw new LearnError('AGENT_START_FAILED', 'The ACP session has no scope.');
        scope.pageCount = t.reader.pageCount;
        scope.outline = { entries: t.reader.outline, complete: t.reader.outlineComplete, total: t.reader.outlineTotal };
        scope.readerPage = t.reader.pageIndex;
        scope.activeTurn = { tutorMessageId: t.tutorMessageId, selection: t.selection, pagesReturned: 0 };
        if (d.context().text.stateOf(t.target.sha256).state === 'pending') d.prioritize(t.target.sha256);
        keepSession(t, s);
        // A new ACP session that is not a resume knows nothing of this conversation: its first prompt carries it.
        const replay = s.firstPrompt && s.resumedBy === 'new' ? replayWindow(repo().replayTurns(t.conversationId, t.userSeq)) : null;
        const built = buildPrompt({ nonce: scope.nonce, first: s.firstPrompt, replay, selection: t.selection && { pageIndex: t.selection.anchor.pageIndex, text: t.selection.text }, question: t.question });
        repo().setSent(t.userMessageId, built.sent);
        blocks = built.blocks;
      } catch (e) {
        tutorLog('turn-prepare-failed', { code: codeOf(e) });
        failBefore(t, startCode(e));
        return;
      }
      const end: TurnEnd = await runTurn({
        prompt: (b, on) => (t.stopped ? Promise.resolve(NOT_SENT) : d.backend.prompt(s, b, on)),
        interrupt: (kill) => d.backend.interrupt(s, kill),
        repo: repo(),
        emit: (e) => emitTurn(t.agent, e),
        timers: d.timers,
        now: d.now,
        timeouts: { ...timeouts },
        stopRequested: () => t.stopped,
        shuttingDown: () => shuttingDown,
      }, {
        conversationId: t.conversationId, tutorMessageId: t.tutorMessageId, userMessageId: t.userMessageId, revisionId: t.target.revisionId,
        pageCount: t.reader.pageCount, blocks, beforeAnswer: t.beforeAnswer,
      });
      if (end.phase === 'abandoned') return;
      // A turn the agent never answered may not have reached it: the next prompt carries the head again.
      s.firstPrompt = !end.answered;
      // The adapter may live on without the session: the next send starts a process and resumes there.
      if (end.code === 'AGENT_EXITED') void d.backend.close(s).catch((e: unknown) => tutorLog('agent-close-failed', { code: codeOf(e) }));
      // The pair may have taken its conversation with it.
      sessionsChanged(repo().conversation(t.conversationId) === undefined ? 'deleted' : 'updated', { itemId: t.target.itemId, conversationId: t.conversationId });
    } catch (e) {
      tutorLog('turn-failed', { code: codeOf(e) });
      if (shuttingDown) return;
      try {
        repo().finishTurn(t.tutorMessageId, { status: 'failed', text: '', stopReason: null, errorCode: 'INTERNAL', revisionId: t.target.revisionId, verified: [] }, d.now());
      } catch {
        // The row is gone or already ended; the event below still ends the turn on screen.
      }
      emitTurn(t.agent, { conversationId: t.conversationId, messageId: t.tutorMessageId, kind: 'failed', phase: 'during', code: 'INTERNAL' });
      sessionsChanged('updated', { itemId: t.target.itemId, conversationId: t.conversationId });
    } finally {
      if (t.session?.scope?.activeTurn?.tutorMessageId === t.tutorMessageId) t.session.scope.activeTurn = null;
      if (active === t) active = null;
      d.supervisor.streaming(t.key, false);
      d.supervisor.touch();
    }
  };

  /** The start is called now, which reserves the key; the rest runs after the rows are answered, so the bubble never waits for the agent. */
  const launch = (t: Turn, conversation: NonNullable<StartInput['conversation']>) => {
    active = t;
    let started: Promise<AgentSession>;
    try {
      started = d.backend.start({ key: t.key, agent: t.agent, conversation, streaming: true });
    } catch (e) {
      started = Promise.reject(e);
    }
    void play(t, started);
  };

  /** The passage as a prompt carries it: the reader's span, read as one. */
  const passage = (sel: TutorAskInput['selection']): TurnSelection | null => {
    if (sel === null) return null;
    const anchor = pdfSpanAnchor.safeParse(sel.anchor);
    if (!anchor.success) throw invalid();
    return { anchor: anchor.data, text: sel.text };
  };

  return {
    consent() {
      d.prefs.set({ tutor: { ...tutorPrefs(), consent: { version: CONSENT_VERSION, at: d.now() } } });
      d.prefsChanged();
    },

    async agents(i) {
      requireConsent();
      return d.detector.report(i.mode, i.agent);
    },

    async chooseAgent(agent) {
      requireConsent();
      const report = await d.detector.report('cached');
      const s = statusOf(report, agent);
      if (s?.state !== 'ready') throw new LearnError('AGENT_NOT_READY', 'The agent is not ready.');
      d.prefs.set({ tutor: { ...tutorPrefs(), agent } });
      d.prefsChanged();
      // The next question goes to the new agent: another agent's idle process has no more use.
      const live = d.supervisor.current();
      if (live && live.agent !== agent && !live.streaming && active === null) void d.supervisor.close().catch((e: unknown) => tutorLog('agent-close-failed', { code: codeOf(e) }));
    },

    view(v) {
      if (!consented(tutorPrefs())) return;
      d.supervisor.view(v);
    },

    async warm(i) {
      try {
        const tutor = tutorPrefs();
        const agent = tutor.agent;
        if (!consented(tutor) || agent === null) return;
        const report = d.detector.cachedReport();
        if (report === null || statusOf(report, agent)?.state !== 'ready') return;
        const key: SessionKey = { itemId: i.itemId, conversationId: i.conversationId };
        if (busyTurn(key) !== null) return;
        const ctx = d.context();
        const target = targetOf(ctx, i.itemId, i.conversationId);
        if (target === null) return;
        const conversation = i.conversationId === null ? null : conversationInput(i.conversationId, agent, target, null);
        d.backend.start({ key, agent, conversation }).catch(() => {});
        if (ctx.text.stateOf(target.sha256).state === 'pending') d.prioritize(target.sha256);
      } catch {
        // A warm is a guess at the next question: it never fails or says anything.
      }
    },

    async ask(i) {
      const agent = precheck();
      const asked: SessionKey = { itemId: i.itemId, conversationId: i.conversationId };
      const busy = busyTurn(asked);
      if (busy === 'unknown') throw new LearnError('AGENT_BUSY', 'Another answer is streaming.');
      if (busy !== null) return { busyWith: { conversationId: busy.conversationId, messageId: busy.tutorMessageId } };
      const ctx = d.context();
      const target = targetOf(ctx, i.itemId, i.conversationId);
      if (target === null) throw invalid();
      const selection = passage(i.selection);
      if (!guardPromptSelection({ revisionId: target.revisionId }, selection).ok) throw invalid();
      const b = ctx.conversations.beginTurn({
        conversationId: i.conversationId, itemId: i.itemId, revisionId: target.revisionId, agent, openedAtPage: i.reader.pageIndex,
        user: {
          kind: 'question', text: i.text,
          // What was sent is known once the prompt is built.
          sent: { selection: selection ? 1 : 0, replayedTurns: 0, preamble: false },
          attached: selection && { anchor: selection.anchor, quote: selection.text, label: mainStrings.tutor.pageLabel(selection.anchor.pageIndex + 1) },
        },
        now: d.now(),
      });
      const key: SessionKey = { itemId: i.itemId, conversationId: b.conversationId };
      if (b.created) {
        d.supervisor.rekey(asked, key);
        sessionsChanged('created', { itemId: i.itemId, conversationId: b.conversationId });
      }
      const conversation = conversationInput(b.conversationId, agent, target, i.reader);
      launch({
        key, agent, target, conversationId: b.conversationId, userMessageId: b.userMessageId, tutorMessageId: b.tutorMessageId,
        userSeq: ctx.conversations.message(b.userMessageId)!.seq, question: i.text, selection, reader: i.reader, beforeAnswer: 'drop-pair', session: null, stopped: false,
      }, conversation);
      return { conversationId: b.conversationId, userMessageId: b.userMessageId, tutorMessageId: b.tutorMessageId };
    },

    stop(messageId) {
      const t = active;
      if (t === null || t.tutorMessageId !== messageId) return;
      t.stopped = true;
      // Before the session is known there is no prompt to cancel: the turn sends none.
      if (t.session !== null) d.backend.interrupt(t.session, 'if-not-ended');
    },

    async resend(i) {
      const agent = precheck();
      const ctx = d.context();
      const failed = ctx.conversations.message(i.messageId);
      const c = failed && ctx.conversations.conversation(failed.conversationId);
      if (!failed || !c) throw invalid();
      refuseBusy({ itemId: c.itemId, conversationId: c.id });
      if (failed.role !== 'tutor' || failed.status !== 'failed' || failed.errorCode === 'AGENT_LOCKDOWN' || c.deleted || c.itemTrashed) throw invalid();
      const target = targetOf(ctx, c.itemId, c.id);
      if (target === null) throw invalid();
      const question = ctx.conversations.thread(c.id).messages.find((m) => m.seq === failed.seq - 1 && m.role === 'user');
      if (!question) throw invalid();
      // The passage goes again with the question: it must still be of the revision the tools read.
      if (question.attached?.revisionId != null && question.attached.revisionId !== target.revisionId) throw invalid();
      const r = ctx.conversations.retryTurn(i.messageId, agent, d.now());
      const attached = ctx.conversations.attachedOf(r.userMessageId);
      const conversation = conversationInput(c.id, agent, target, i.reader);
      launch({
        key: { itemId: c.itemId, conversationId: c.id }, agent, target, conversationId: c.id, userMessageId: r.userMessageId, tutorMessageId: r.tutorMessageId,
        userSeq: question.seq, question: question.text, selection: attached && { anchor: attached.anchor, text: attached.quote }, reader: i.reader,
        beforeAnswer: 'keep-failed', session: null, stopped: false,
      }, conversation);
      return { tutorMessageId: r.tutorMessageId };
    },

    async reground(i) {
      const agent = precheck();
      const ctx = d.context();
      const doubted = ctx.conversations.message(i.messageId);
      const c = doubted && ctx.conversations.conversation(doubted.conversationId);
      if (!doubted || !c) throw invalid();
      refuseBusy({ itemId: c.itemId, conversationId: c.id });
      if (doubted.role !== 'tutor' || (doubted.status !== 'complete' && doubted.status !== 'stopped') || c.deleted || c.itemTrashed) throw invalid();
      const target = targetOf(ctx, c.itemId, c.id);
      if (target === null) throw invalid();
      const pages = regroundPages(checkCitations(doubted.text, ctx.conversations.toolReads(doubted.id), i.reader.pageCount));
      if (pages.length === 0) throw invalid();
      const text = regroundInstruction(pages.map((p) => p + 1));
      const b = ctx.conversations.beginTurn({
        conversationId: c.id, itemId: c.itemId, revisionId: target.revisionId, agent, openedAtPage: i.reader.pageIndex,
        user: { kind: 'reground', text, sent: { selection: 0, replayedTurns: 0, preamble: false }, attached: null }, now: d.now(),
      });
      const conversation = conversationInput(c.id, agent, target, i.reader);
      launch({
        key: { itemId: c.itemId, conversationId: c.id }, agent, target, conversationId: c.id, userMessageId: b.userMessageId, tutorMessageId: b.tutorMessageId,
        userSeq: ctx.conversations.message(b.userMessageId)!.seq, question: text, selection: null, reader: i.reader, beforeAnswer: 'drop-pair', session: null, stopped: false,
      }, conversation);
      return { userMessageId: b.userMessageId, tutorMessageId: b.tutorMessageId };
    },

    async removeWorkFolders(conversationIds) {
      // Claude's naming for every id: the conversation row is gone by now, and one session may have had two agents.
      const claudeHome = agentHomePath(d.tutorHome, 'claude');
      for (const id of conversationIds) {
        let work: string;
        try {
          work = workDirPath(d.userData, id);
        } catch {
          tutorLog('work-folder-skipped', { code: 'VALIDATION_FAILED' });
          continue;
        }
        for (const p of [work, ...historyDirs({ agentHome: claudeHome, work, home: d.home })]) {
          try {
            await fs.promises.rm(p, { recursive: true, force: true });
          } catch (e) {
            tutorLog('work-folder-remove-failed', { code: (e as NodeJS.ErrnoException).code ?? codeOf(e) });
          }
        }
      }
    },

    setTimeouts(t) {
      if (t.firstUpdateMs !== undefined) timeouts.firstUpdateMs = t.firstUpdateMs;
      if (t.betweenMs !== undefined) timeouts.betweenMs = t.betweenMs;
      if (t.idleMs !== undefined) d.supervisor.setTimeouts({ idleMs: t.idleMs });
    },

    processes: () => d.supervisor.processes(),
    resetProcessMax: () => d.supervisor.resetMax(),
    killAgent: () => d.backend.killNow(),

    async shutdown(maxMs) {
      // First: the turn that is cut off writes nothing, and the next start mends its row as interrupted.
      shuttingDown = true;
      const t = active;
      if (t?.session) d.backend.interrupt(t.session, 'if-not-ended');
      await d.supervisor.shutdown(maxMs);
    },
  };
}
