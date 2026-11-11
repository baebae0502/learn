import type { RealAgentId } from '@learn/domain';

/** One row per real agent; the key is the agent id, so a second agent is one more row. */
export interface AgentCatalogEntry {
  id: RealAgentId;
  name: 'Claude Code';
  cli: 'claude';
  adapterPackage: '@agentclientprotocol/claude-agent-acp';
  adapterBin: 'claude-agent-acp';
  /** The version the install command pins. */
  adapterPin: '0.103.0';
  /** null would mean never ready: the lock was not confirmed on any version. */
  minimum: { cli: string; adapter: string } | null;
  installCli: 'npm install -g @anthropic-ai/claude-code';
  resume: { resume: boolean; load: boolean };
  /** R1: the token binds to the first MCP session; true until a live run says otherwise. */
  mcpSessionBinding: boolean;
}

export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    cli: 'claude',
    adapterPackage: '@agentclientprotocol/claude-agent-acp',
    adapterBin: 'claude-agent-acp',
    adapterPin: '0.103.0',
    minimum: { cli: '2.1.318', adapter: '0.103.0' },
    installCli: 'npm install -g @anthropic-ai/claude-code',
    resume: { resume: true, load: true },
    mcpSessionBinding: true,
  },
];

export const installAdapter = (e: AgentCatalogEntry): string => `npm install -g ${e.adapterPackage}@${e.adapterPin}`;

/** The one line for a machine with neither: Claude Code and the connection tool together (R23). */
export const installBoth = (e: AgentCatalogEntry): string => `${e.installCli} ${e.adapterPackage}@${e.adapterPin}`;
