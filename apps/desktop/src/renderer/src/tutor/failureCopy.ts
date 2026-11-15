import { checkCitations, regroundPages, type AgentId, type BodyTextState, type CitationCheck, type ErrorCode, type MessageStatus, type ReadSpan } from '@learn/domain';
import { t } from '../strings';

const { failure: words } = t.tutor;

/** What a failed turn shows (spec 8.8, 13): its title, its sentence, its buttons, and the login command when it is the login's. */
export interface FailureView {
  title: string;
  body: string;
  actions: Array<'resend' | 'copy-login' | 'choose-agent'>;
  command: string | null;
}

/** `INTERRUPTED`: an answer Learn's quit or crash cut off (stopReason 'interrupted', no error code). */
export type FailureCode = ErrorCode | 'INTERRUPTED';

/**
 * The words and buttons of a failed turn. `before`: no answer began — the question went back to the composer (↩ sends it again).
 * `during`: the answer row stays failed, with 다시 보내기 — after the part that came, after Learn's quit or crash, after a resend that
 * could not go or whose turn failed before its answer (that code's fact, never the composer). `loginCommand`: the Learn-only login as the
 * agents report has it (the chooser's own), shown only on the login's failure.
 */
export function failureCopy(f: { code: FailureCode; phase: 'before' | 'during'; agent: AgentId; loginCommand: string | null }): FailureView {
  const name = t.tutor.agentName(f.agent);
  const view = (title: string, body: string, actions: FailureView['actions'] = []): FailureView => ({ title, body, actions, command: actions.includes('copy-login') ? f.loginCommand : null });
  if (f.phase === 'before') {
    switch (f.code) {
      case 'OFFLINE':
        return view(words.offline, words.offlineBody);
      case 'AGENT_LOGIN':
        return view(words.login(name), words.loginBody, ['copy-login']);
      case 'AGENT_NOT_READY':
        return view(words.notReady(name), words.chooseBody, ['choose-agent']);
      case 'AGENT_START_FAILED':
        return view(words.startFailed(name), words.chooseBody, ['choose-agent']);
      case 'AGENT_TIMEOUT':
        return view(words.timeout(name), words.againBody);
      case 'AGENT_BUSY':
        return view(words.busy, words.notResent.busy);
      case 'AGENT_EXITED':
      case 'AGENT_PROTOCOL':
      case 'AGENT_LOCKDOWN':
        return view(words.stoppedBefore(name), words.againBody);
      default:
        // Main refused it for a reason of its own (an item trashed from another tab, say): no agent ran.
        return view(words.notSent, words.againBody);
    }
  }
  switch (f.code) {
    case 'AGENT_EXITED':
    case 'AGENT_PROTOCOL':
      return view(words.stoppedDuring(name), words.stoppedDuringBody, ['resend']);
    case 'AGENT_TIMEOUT':
      return view(words.timeoutDuring(name), words.timeoutDuringBody, ['resend']);
    case 'AGENT_LOCKDOWN':
      return view(words.lockdown, words.lockdownBody(name), ['choose-agent']);
    case 'INTERRUPTED':
      return view(words.interrupted, words.resendBody, ['resend']);
    case 'OFFLINE':
      return view(words.offline, words.notResent.offline, ['resend']);
    case 'AGENT_LOGIN':
      return view(words.login(name), words.notResent.login, ['copy-login', 'resend']);
    case 'AGENT_NOT_READY':
      return view(words.notReady(name), words.notResent.choose, ['choose-agent', 'resend']);
    case 'AGENT_START_FAILED':
      return view(words.startFailed(name), words.notResent.choose, ['choose-agent', 'resend']);
    case 'AGENT_BUSY':
      return view(words.busy, words.notResent.busy, ['resend']);
    default:
      return view(words.stoppedDuring(name), words.resendBody, ['resend']);
  }
}

/** The icon's colour: a warning for what the user can set right (the network, the login, the agent's state, another answer), danger else. */
export function failureTone(code: FailureCode): 'warning' | 'danger' {
  return code === 'OFFLINE' || code === 'AGENT_LOGIN' || code === 'AGENT_NOT_READY' || code === 'AGENT_BUSY' ? 'warning' : 'danger';
}

/** The reground button: a finished answer with unverified pages inside the document. */
export function canReground(status: MessageStatus, check: CitationCheck): boolean {
  return (status === 'complete' || status === 'stopped') && regroundPages(check).length > 0;
}

/** The reground turn's bubble: the pages its answer is to read first, as the answer before it left them unverified; null for none. */
export function regroundBubble(check: CitationCheck): string | null {
  const [first, ...more] = regroundPages(check).map((p) => p + 1);
  return first === undefined ? null : t.tutor.unverified.ask(first, ...more);
}

/**
 * The page count an answer's cites are checked against: the reader's once pdf.js has the document; before that the body index's, when it
 * read every page; 0 while neither is known.
 */
export function knownPageCount(readerPages: number, text: BodyTextState | null | undefined): number {
  if (readerPages > 0) return readerPages;
  if (text?.state === 'empty' || (text?.state === 'done' && !text.truncated)) return text.pages;
  return 0;
}

/** An answer's cites against the pages its turn read; null while the page count is not known (no cite can be told inside or past it). */
export function answerCheck(answer: { text: string; tools: readonly ReadSpan[] }, pageCount: number): CitationCheck | null {
  return pageCount > 0 ? checkCitations(answer.text, answer.tools, pageCount) : null;
}

/**
 * How a finished answer's unverified notice is drawn: in full with 원문 근거로 다시 묻기 when the button can go (the thread's last answer —
 * the asked-again turn goes at the end — with a page inside the document not read); its title alone otherwise; none when every cite was
 * read, while the page count is not known, while the answer comes, and under a failed answer (its failure stands alone, its 출처 없음
 * chips mark the pages).
 */
export function unverifiedForm(status: MessageStatus, check: CitationCheck | null, last: boolean): 'none' | 'title' | 'full' {
  if (status === 'streaming' || status === 'failed' || check === null || check.unverified.length === 0) return 'none';
  return last && canReground(status, check) ? 'full' : 'title';
}
