import { regroundPages, type AgentId, type CitationCheck, type ErrorCode, type MessageStatus } from '@learn/domain';
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
      default:
        return view(words.stoppedBefore(name), words.againBody);
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
