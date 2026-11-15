import fs from 'node:fs';
import path from 'node:path';
import type { AgentId, RealAgentId } from '@learn/domain';
import { RpcError } from '../acp/jsonrpc';
import type { ToolCallInfo } from '../acp/client';
import { AGENT_CATALOG } from './catalog';
import type { Detected } from './detect';

/** What an agent process may inherit from Learn's own environment; everything else, API keys included, stays behind. */
export const ENV_ALLOW: readonly string[] = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY'];

/** The ENV_ALLOW variables `base` sets, and no other. */
export function allowedEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOW) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const privateDir = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
};

/** Claude Code takes the first `.git` above its cwd as the project root, even an empty one; Learn's own stops that search at the agent's folder. */
export const ROOT_MARKER = '.git';
/** A folder for an agent's cwd: private, holding only Learn's empty root marker. Idempotent. */
export function agentCwd(dir: string): string {
  privateDir(dir);
  privateDir(path.join(dir, ROOT_MARKER));
  return dir;
}
/** The folder git is fenced at: it never looks above it. */
export const ceilingDir = (userData: string): string => path.join(userData, 'Tutor');

/** The live run's login folder only when main says it is a live run of an unpackaged app; this function never reads the environment. */
export function tutorHome(userData: string, o: { live: boolean; liveHome: string | undefined }): string {
  return o.live && o.liveHome !== undefined && path.isAbsolute(o.liveHome) ? o.liveHome : path.join(userData, 'Tutor');
}
/** The path alone, for naming it in a message without making it. */
export const agentHomePath = (home: string, agent: AgentId): string => path.join(home, 'agents', agent);
export const agentHome = (home: string, agent: AgentId): string => privateDir(agentHomePath(home, agent));
/** The path alone, for removing it without making it first. */
export function workDirPath(userData: string, conversationId: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(conversationId) || conversationId === '.' || conversationId === '..') throw new Error('invalid conversation id');
  return path.join(userData, 'Tutor', 'work', conversationId);
}
export const workDir = (userData: string, conversationId: string): string => agentCwd(workDirPath(userData, conversationId));
export const idleDir = (userData: string): string => path.join(userData, 'Tutor', 'idle');
export const probeDir = (userData: string): string => path.join(userData, 'Tutor', 'probe');
export const tmpDir = (userData: string): string => privateDir(path.join(userData, 'Tutor', 'tmp'));

export interface LaunchSpec { command: string; args: string[]; env: Record<string, string>; cwd: string }

export function agentEnv(
  agent: AgentId,
  base: NodeJS.ProcessEnv,
  o: { path: string; agentHome: string; tmpDir: string; ceiling: string; cliPath: string | null; fake?: { script: string; log: string | null } },
): Record<string, string> {
  const env = allowedEnv(base);
  env.PATH = o.path;
  env.ELECTRON_RUN_AS_NODE = '1';
  env.NO_PROXY = '127.0.0.1,localhost';
  if (agent === 'fake') {
    if (!o.fake) throw new Error('the fake agent needs its script');
    env.LEARN_FAKE_AGENT_SCRIPT = o.fake.script;
    if (o.fake.log !== null) env.LEARN_FAKE_AGENT_LOG = o.fake.log;
    return env;
  }
  // without it the adapter would silently use the binary bundled with it
  if (o.cliPath === null) throw new Error('Claude Code needs its detected CLI');
  env.CLAUDE_CONFIG_DIR = o.agentHome;
  env.CLAUDE_CODE_EXECUTABLE = o.cliPath;
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  env.DISABLE_AUTOUPDATER = '1';
  env.CLAUDE_CODE_TMPDIR = o.tmpDir;
  env.GIT_CEILING_DIRECTORIES = o.ceiling;
  return env;
}

/** No shell: Electron's own node runs the adapter's real entry file. */
export function launchSpec(d: Detected | 'fake', o: { execPath: string; fakeEntry: string; env: Record<string, string>; cwd: string }): LaunchSpec {
  if (d === 'fake') return { command: o.execPath, args: [o.fakeEntry], env: o.env, cwd: o.cwd };
  if (d.adapterEntry === null) throw new Error('no adapter to launch');
  return { command: o.execPath, args: [fs.realpathSync(d.adapterEntry)], env: o.env, cwd: o.cwd };
}

const LEARN_TOOLS: readonly string[] = ['mcp__learn__get_context', 'mcp__learn__get_outline', 'mcp__learn__read_pdf_pages'];

/** Sent with session/new, session/resume, session/load and the login check's session/new. */
export function sessionMeta(agent: AgentId): Record<string, unknown> {
  if (agent === 'fake') return { learnFake: true };
  return {
    claudeCode: {
      options: {
        tools: [], settingSources: [], strictMcpConfig: true, allowedTools: [...LEARN_TOOLS],
        allowDangerouslySkipPermissions: false, promptSuggestions: false,
      },
    },
  };
}

export const systemPromptParam = (instructions: string): { mode: 'append'; content: Array<{ type: 'text'; text: string }> } =>
  ({ mode: 'append', content: [{ type: 'text', text: instructions }] });

/**
 * By the tool name when the call names one — then alone, so a built-in titled like a Learn tool is caught — else by the title; never by
 * rawInput, which is empty on the first update. The fake imitates Claude's shape, so every id shares the rule.
 */
export function isLearnToolCall(_agent: AgentId, call: ToolCallInfo): boolean {
  if (call.toolName !== null) return LEARN_TOOLS.includes(call.toolName);
  return call.title !== null && LEARN_TOOLS.includes(call.title);
}

export function isLoginRequired(error: unknown): boolean {
  return error instanceof RpcError && error.rpcCode === -32000 && error.message.startsWith('Authentication required');
}

const quoted = (s: string): string => s.replace(/[\\"$`]/g, '\\$&');

/** One string, shown and copied: the folder is written from $HOME when it is inside the home (by path segment). */
export function loginCommand(agent: RealAgentId, agentHomeDir: string, home: string): string {
  let target = quoted(agentHomeDir);
  if (path.isAbsolute(agentHomeDir) && path.isAbsolute(home)) {
    const rel = path.relative(home, agentHomeDir);
    if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
      target = rel === '' ? '$HOME' : `$HOME/${quoted(rel.split(path.sep).join('/'))}`;
    }
  }
  const cli = AGENT_CATALOG.find((e) => e.id === agent)!.cli;
  return `CLAUDE_CONFIG_DIR="${target}" ${cli} auth login`;
}

/** Claude's own records of a work folder: in its config folder, and the cache folders its own environment gives it (no XDG_CACHE_HOME). Claude's rule for every id. */
export function historyDirs(o: { agentHome: string; work: string; home: string }): string[] {
  // the slash-and-dot rule was seen on Linux; the CLI is believed to replace every other character too (a space in the macOS path)
  const names = [...new Set([o.work.replace(/[/.]/g, '-'), o.work.replace(/[^A-Za-z0-9]/g, '-')])];
  return names.flatMap((name) => [
    path.join(o.agentHome, 'projects', name),
    path.join(o.home, '.cache', 'claude-cli-nodejs', name),
    path.join(o.home, 'Library', 'Caches', 'claude-cli-nodejs', name),
  ]);
}
