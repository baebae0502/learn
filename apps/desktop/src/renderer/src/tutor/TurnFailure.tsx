import type { ReactNode } from 'react';
import { CircleAlert, LogIn, Plug, WifiOff, type LucideIcon } from 'lucide-react';
import { commandById, type AgentId } from '@learn/domain';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { useReader } from '../viewers/pdf/readerStore';
import { CommandText } from './CommandText';
import { failureCopy, failureTone, type FailureCode } from './failureCopy';
import { useAgents } from './useAgents';

const { failure: words } = t.tutor;

/**
 * A notice in the conversation column (design-spec 2.6; mockup .tu-notice): a framed card the column's width — Learn's voice, not the
 * tutor's — its 16 px icon beside a headline title, then the sentence, a command, the buttons. `brief`: the title line alone. Not a live
 * region: what it says once is the panel's hidden alert's.
 */
export function TutorNotice({ icon, tone, title, brief = false, children, testId, data }: {
  icon: LucideIcon;
  tone: 'warning' | 'danger';
  title: string;
  brief?: boolean;
  children?: ReactNode;
  testId: string;
  data?: Record<`data-${string}`, string>;
}) {
  return (
    <div className={cx('tutor-notice', brief && 'is-brief')} data-testid={testId} {...data}>
      <Icon icon={icon} className={tone === 'warning' ? 'c-warning' : 'c-danger'} />
      <div className="nt" data-testid={`${testId}-title`}>
        {title}
      </div>
      {!brief && children}
    </div>
  );
}

const ICON: Partial<Record<FailureCode, LucideIcon>> = { OFFLINE: WifiOff, AGENT_LOGIN: LogIn, AGENT_NOT_READY: Plug };

/** The Learn-only login command of the agent as the agents report has it now (the chooser's own; read again after a login failure). */
function useLoginCommand(agent: AgentId): string | null {
  const { report } = useAgents(false);
  const status = agent === 'fake' ? report?.fake : report?.agents.find((a) => a.id === agent);
  return status?.state === 'login' ? status.command : null;
}

/**
 * A button of a notice that sends a turn: off with the composer's reason while the item still opens (a turn carries the reader's
 * numbers), else its own tooltip when it has one.
 */
export function SendingButton({ label, tip, onPress, testId }: { label: string; tip?: string; onPress?: (() => void) | undefined; testId: string }) {
  const opening = useReader((s) => s.pdf?.ready !== true);
  if (opening) {
    return (
      <Button size="small" isDisabled disabledReason={t.tutor.composer.sendOpening} testId={testId}>
        {label}
      </Button>
    );
  }
  const button = (
    <Button size="small" onPress={onPress} testId={testId}>
      {label}
    </Button>
  );
  return tip === undefined ? button : <Tooltip label={tip}>{button}</Tooltip>;
}

/**
 * What a failed turn shows (spec 8.8, 13; mockup ?state=8): before any answer, where its turn would have been — the question is back in
 * the composer; during one, under the part that came — with 다시 보내기 (its tooltip says it asks the same question from the start), never
 * after a lockdown. The login's failure shows the command to run, copied as shown; a not-ready or not-started agent, 에이전트 고르기….
 * `brief`: the title alone (a 원문 근거 요청 that failed has nothing in the composer to point at).
 */
export function TurnFailure({ code, phase, agent, brief = false, onResend }: { code: FailureCode; phase: 'before' | 'during'; agent: AgentId; brief?: boolean; onResend?(): void }) {
  const loginCommand = useLoginCommand(agent);
  const { run } = useCommands();
  const view = failureCopy({ code, phase, agent, loginCommand });
  const buttons = view.actions.filter((a) => a !== 'copy-login' && (a !== 'resend' || onResend !== undefined));
  return (
    <TutorNotice
      icon={ICON[code] ?? CircleAlert}
      tone={failureTone(code)}
      title={view.title}
      brief={brief}
      testId="tutor-failure"
      data={{ 'data-code': code, 'data-phase': phase }}
    >
      <div className="nt-text">{view.body}</div>
      {view.command !== null && (
        <div className="nt-cmd">
          <CommandText command={view.command} testId="tutor-failure-copy" />
        </div>
      )}
      {buttons.length > 0 && (
        <div className="nt-actions">
          {buttons.map((a) =>
            a === 'resend' ? (
              <SendingButton key={a} label={words.resend} tip={words.resendTip} onPress={onResend} testId="tutor-resend" />
            ) : (
              <Button key={a} size="small" onPress={() => run('tutor.chooseAgent')} testId="tutor-failure-choose">
                {commandById('tutor.chooseAgent').label}
              </Button>
            ),
          )}
        </div>
      )}
    </TutorNotice>
  );
}
