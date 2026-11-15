import { CircleCheck, CircleDashed, LogIn, Plug, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { AgentId, AgentState, AgentStatus } from '@learn/domain';
import { t } from '../strings';

const { agents } = t.tutor;

/** A flag: an icon, a colour token and the words (the words carry the meaning; the icon and colour only help). The chooser's rows and the composer's agent button show it. */
export const FLAG: Record<AgentState, { icon: LucideIcon; tone: 'c-success' | 'c-warning' | 'c-secondary' }> = {
  ready: { icon: CircleCheck, tone: 'c-success' },
  login: { icon: LogIn, tone: 'c-warning' },
  missing: { icon: CircleDashed, tone: 'c-secondary' },
  old: { icon: TriangleAlert, tone: 'c-warning' },
  adapter: { icon: Plug, tone: 'c-warning' },
};

/** One row of the chooser as the screen draws it: the words come from the approved copy, chosen by state and note (spec 4.3, 13). */
export interface AgentRowView {
  id: AgentId;
  name: string;
  /** The flag's words (the fake's is its "개발용" badge). */
  flag: string;
  description: string;
  /** The row's primary action: copy an install command, copy the login command, or only a recheck; null: none (ready, the fake). */
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
 * A command's parts for the screen: a line may break after a space (an argument separator), after a "/", and after the "=" of a leading
 * environment assignment (NAME=), nowhere else. A space inside
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
    if (ch === ' ' || ch === '/' || (ch === '=' && parts.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=$/.test(part))) {
      parts.push(part);
      part = '';
    }
  }
  if (part !== '') parts.push(part);
  return parts;
}
