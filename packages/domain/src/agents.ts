import { z } from 'zod';

/** The real agents: the keys of the catalog and the isolation tables (T1a: Claude Code only — owner, 2026-11-10). */
export const AGENT_IDS = ['claude'] as const;
export type RealAgentId = (typeof AGENT_IDS)[number];
/** What a session, a message and prefs.tutor may name: a real agent or the dev-only fake. */
export const TUTOR_AGENT_IDS = [...AGENT_IDS, 'fake'] as const;
export type AgentId = (typeof TUTOR_AGENT_IDS)[number];
export const agentIdSchema = z.enum(TUTOR_AGENT_IDS);

export type AgentState = 'ready' | 'adapter' | 'login' | 'old' | 'missing';
export interface AgentStatus {
  id: AgentId;
  name: string;
  state: AgentState;
  cliVersion: string | null;
  adapterVersion: string | null;
  minimum: { cli: string; adapter: string } | null;
  /** What the row's button copies: the install command (missing, adapter) or the Learn-only login command (login). */
  command: string | null;
  /** Why a row reads differently: the lockdown watch stopped it this run. */
  note: 'lockdown' | null;
}
export interface AgentsReport { agents: AgentStatus[]; fake: AgentStatus | null }

/** What the screens say depends on these spike results; one place to change them. */
export const SPIKE_FACTS = {
  separateLogin: true, // the Learn-only folder needs its own login
  historyLine: true, // the agent keeps its records in that folder
} as const;
