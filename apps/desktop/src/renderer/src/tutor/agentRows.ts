import type { AgentId, AgentState, AgentStatus } from '@learn/domain';
import { t } from '../strings';

const { agents } = t.tutor;

/** One row of the chooser as the screen draws it: the words come from the approved copy, chosen by state and note (spec 4.3, 13). */
export interface AgentRowView {
  id: AgentId;
  name: string;
  /** The flag's words (the fake's is its "개발용" badge). */
  flag: string;
  description: string;
  /** What the row's command button copies; null: no command. */
  action: 'copy-install' | 'copy-login' | 'recheck' | null;
  /** The row has a "다시 확인" button. */
  recheck: boolean;
  command: string | null;
  /** The row can be the chosen one. */
  selectable: boolean;
}

const ACTION: Record<AgentState, AgentRowView['action']> = { ready: null, adapter: 'copy-install', login: 'copy-login', old: 'recheck', missing: 'copy-install' };
const RECHECK: Record<AgentState, boolean> = { ready: false, adapter: true, login: true, old: true, missing: false };

function description(s: AgentStatus): string {
  if (s.id === 'fake') return agents.description.fake;
  if (s.state === 'old') return s.note === 'lockdown' || s.minimum === null ? agents.description.lockdown : agents.description.old(s.minimum);
  return agents.description[s.state];
}

export function agentRow(s: AgentStatus): AgentRowView {
  const fake = s.id === 'fake';
  return {
    id: s.id,
    name: t.tutor.agentName(s.id),
    flag: fake ? agents.fakeBadge : agents.flag[s.state],
    description: description(s),
    action: fake ? null : ACTION[s.state],
    recheck: !fake && RECHECK[s.state],
    command: fake ? null : s.command,
    selectable: s.state === 'ready',
  };
}

/**
 * A command's parts for the screen: a line may break after a space (an argument separator) and after a "/", nowhere else. A space inside
 * double quotes is no separator: it stays in its part as U+00A0, so a folder's name is not split. The copied text is the command itself.
 */
export function commandParts(command: string): string[] {
  const parts: string[] = [];
  let part = '';
  let quoted = false;
  for (const ch of command) {
    if (ch === '"') quoted = !quoted;
    if (ch === ' ' && quoted) {
      part += ' ';
      continue;
    }
    part += ch;
    if (ch === ' ' || ch === '/') {
      parts.push(part);
      part = '';
    }
  }
  if (part !== '') parts.push(part);
  return parts;
}
