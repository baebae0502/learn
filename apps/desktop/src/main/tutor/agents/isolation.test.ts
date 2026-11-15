import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolCallInfo } from '../acp/client';
import { RpcError } from '../acp/jsonrpc';
import { ENV_ALLOW, ROOT_MARKER, agentCwd, agentEnv, agentHome, historyDirs, idleDir, isLearnToolCall, isLoginRequired, launchSpec, loginCommand, probeDir, sessionMeta, systemPromptParam, tmpDir, tutorHome, workDir } from './isolation';

const made: string[] = [];
const tempRoot = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-iso-'));
  made.push(d);
  return d;
};
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe('isolation', () => {
  it('hands Claude Code an allow-listed environment: its Learn-only folder, its own temp folder, no API key, the proxy kept', () => {
    // __CF_USER_TEXT_ENCODING is in every macOS process's own environment, Learn's too: it stays behind like any other name.
    const base = { PATH: '/x', HOME: '/h', USER: 'u', LANG: 'ko_KR.UTF-8', HTTPS_PROXY: 'http://p:1', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', CODEX_API_KEY: 'k', MY_API_KEY: 'k', SECRET: 's', __CF_USER_TEXT_ENCODING: '0x1F5:0x0:0x0' };
    const env = agentEnv('claude', base, { path: '/found', agentHome: '/u/Tutor/agents/claude', tmpDir: '/u/Tutor/tmp', ceiling: '/u/Tutor', cliPath: '/found/claude' });
    expect(Object.keys(env).filter((k) => /API_KEY|SECRET/.test(k))).toEqual([]);
    expect(env).toEqual({
      PATH: '/found', HOME: '/h', USER: 'u', LANG: 'ko_KR.UTF-8', HTTPS_PROXY: 'http://p:1',
      CLAUDE_CONFIG_DIR: '/u/Tutor/agents/claude', CLAUDE_CODE_EXECUTABLE: '/found/claude', ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_TMPDIR: '/u/Tutor/tmp', GIT_CEILING_DIRECTORIES: '/u/Tutor', ELECTRON_RUN_AS_NODE: '1', NO_PROXY: '127.0.0.1,localhost',
    });
    expect({ meta: sessionMeta('claude'), system: systemPromptParam('I') }).toMatchSnapshot();
  });

  it('makes an agent folder with Learn\'s empty .git in it, both private, and a second call changes nothing', () => {
    const dir = path.join(tempRoot(), 'a', 'idle');
    expect(agentCwd(dir)).toBe(dir);
    expect(agentCwd(dir)).toBe(dir);
    expect(fs.readdirSync(dir)).toEqual([ROOT_MARKER]);
    expect(fs.statSync(path.join(dir, ROOT_MARKER)).isDirectory()).toBe(true);
    expect(fs.readdirSync(path.join(dir, ROOT_MARKER))).toEqual([]);
    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, ROOT_MARKER))).toBe(0o700);
    const w = workDir(tempRoot(), 'c1');
    expect(fs.readdirSync(w)).toEqual([ROOT_MARKER]);
  });

  it('fences git at Learn\'s folder whatever the base environment says, and the fake gets no GIT_ key', () => {
    const base = { PATH: '/x', GIT_CEILING_DIRECTORIES: '/elsewhere', GIT_DIR: '/g' };
    const env = agentEnv('claude', base, { path: '/p', agentHome: '/a', tmpDir: '/t', ceiling: '/u/Tutor', cliPath: '/c' });
    expect(env.GIT_CEILING_DIRECTORIES).toBe('/u/Tutor');
    expect(env.GIT_DIR).toBeUndefined();
    const fake = agentEnv('fake', base, { path: '/p', agentHome: '/a', tmpDir: '/t', ceiling: '/u/Tutor', cliPath: null, fake: { script: '/s', log: null } });
    expect(Object.keys(fake).filter((k) => k.startsWith('GIT_'))).toEqual([]);
  });

  it('names the record folders by both rules the CLI may use, and refuses a Claude launch without its CLI', () => {
    const dirs = historyDirs({ agentHome: '/a', work: '/Users/a/Library/Application Support/Learn/Tutor/work/x.y', home: '/h' });
    expect(dirs).toEqual([
      '/a/projects/-Users-a-Library-Application Support-Learn-Tutor-work-x-y', '/h/.cache/claude-cli-nodejs/-Users-a-Library-Application Support-Learn-Tutor-work-x-y', '/h/Library/Caches/claude-cli-nodejs/-Users-a-Library-Application Support-Learn-Tutor-work-x-y',
      '/a/projects/-Users-a-Library-Application-Support-Learn-Tutor-work-x-y', '/h/.cache/claude-cli-nodejs/-Users-a-Library-Application-Support-Learn-Tutor-work-x-y', '/h/Library/Caches/claude-cli-nodejs/-Users-a-Library-Application-Support-Learn-Tutor-work-x-y',
    ]);
    expect(() => agentEnv('claude', { PATH: '/x' }, { path: '/p', agentHome: '/a', tmpDir: '/t', ceiling: '/c', cliPath: null })).toThrow();
  });

  it('hands the fake agent its script and log instead of the isolation variables', () => {
    const base = { PATH: '/x', HOME: '/h', LEARN_FAKE_AGENT_SCRIPT: 'ignored', ANTHROPIC_API_KEY: 'k' };
    const env = agentEnv('fake', base, { path: '/p', agentHome: '/a', tmpDir: '/t', ceiling: '/c', cliPath: null, fake: { script: '/s.json', log: '/l.log' } });
    expect(env).toEqual({ PATH: '/p', HOME: '/h', ELECTRON_RUN_AS_NODE: '1', LEARN_FAKE_AGENT_SCRIPT: '/s.json', LEARN_FAKE_AGENT_LOG: '/l.log', NO_PROXY: '127.0.0.1,localhost' });
    expect(agentEnv('fake', base, { path: '/p', agentHome: '/a', tmpDir: '/t', ceiling: '/c', cliPath: null, fake: { script: '/s.json', log: null } }).LEARN_FAKE_AGENT_LOG).toBeUndefined();
    expect(ENV_ALLOW).toEqual(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTPS_PROXY', 'HTTP_PROXY']);
    expect(sessionMeta('fake')).toEqual({ learnFake: true });
  });

  it('knows a Learn tool call by its title or its tool name, never by rawInput', () => {
    const call = (o: Partial<ToolCallInfo>): ToolCallInfo => ({ toolCallId: 'toolu_1', title: null, kind: 'other', toolName: null, rawInput: {}, ...o });
    expect(isLearnToolCall('claude', call({ title: 'mcp__learn__read_pdf_pages' }))).toBe(true);
    expect(isLearnToolCall('claude', call({ toolName: 'mcp__learn__get_outline' }))).toBe(true);
    expect(isLearnToolCall('fake', call({ title: 'mcp__learn__get_context' }))).toBe(true);
    for (const c of [call({ title: 'Bash' }), call({ title: 'Read', kind: 'read' }), call({ title: 'mcp__learn__read_pdf_pages_x' }), call({ toolName: 'mcp__other__get_context' }), call({ rawInput: { tool: 'read_pdf_pages' } })]) expect(isLearnToolCall('claude', c)).toBe(false);
  });

  it('a call that names its tool is judged by that name alone: a built-in titled like a Learn tool is not Learn\'s', () => {
    const call = (o: Partial<ToolCallInfo>): ToolCallInfo => ({ toolCallId: 'toolu_1', title: null, kind: 'other', toolName: null, rawInput: {}, ...o });
    expect(isLearnToolCall('claude', call({ title: 'mcp__learn__read_pdf_pages', toolName: 'Bash' }))).toBe(false);
    expect(isLearnToolCall('claude', call({ title: 'mcp__learn__get_context', toolName: 'Read', kind: 'read' }))).toBe(false);
    expect(isLearnToolCall('fake', call({ title: 'mcp__learn__get_outline', toolName: 'WebFetch' }))).toBe(false);
    // Positive control: the same title with Learn's own tool name passes.
    expect(isLearnToolCall('claude', call({ title: 'mcp__learn__read_pdf_pages', toolName: 'mcp__learn__read_pdf_pages' }))).toBe(true);
    expect(isLearnToolCall('claude', call({ title: 'Read pages', toolName: 'mcp__learn__read_pdf_pages' }))).toBe(true);
  });

  it('names the records of a work folder where the agent writes them: its own environment has no XDG_CACHE_HOME (P-40, N2)', () => {
    expect(historyDirs({ agentHome: '/u/Tutor/agents/claude', work: '/u/Tutor/work/abc.d', home: '/h' })).toEqual([
      '/u/Tutor/agents/claude/projects/-u-Tutor-work-abc-d', '/h/.cache/claude-cli-nodejs/-u-Tutor-work-abc-d', '/h/Library/Caches/claude-cli-nodejs/-u-Tutor-work-abc-d',
    ]);
    const env = agentEnv('claude', { PATH: '/x', HOME: '/h', XDG_CACHE_HOME: '/c' }, { path: '/found', agentHome: '/a', tmpDir: '/t', ceiling: '/c', cliPath: '/found/claude' });
    expect(env.XDG_CACHE_HOME).toBeUndefined(); // so the CLI writes under ~/.cache, where historyDirs looks
    expect(historyDirs({ agentHome: '/a', work: '/w', home: env.HOME! })[1]).toBe('/h/.cache/claude-cli-nodejs/-w');
  });

  it('launches the real agent through Electron\'s node on the resolved entry, and the fake on its own entry, without a shell', () => {
    const root = tempRoot();
    const real = path.join(root, 'real.js');
    fs.writeFileSync(real, '');
    const link = path.join(root, 'link.js');
    fs.symlinkSync(real, link);
    const detected = { entry: { id: 'claude' }, cliPath: '/c', cliVersion: '2.1.318', adapterEntry: link, adapterVersion: '0.103.0' } as never;
    expect(launchSpec(detected, { execPath: '/electron', fakeEntry: '/fake.js', env: { A: '1' }, cwd: '/idle' })).toEqual({ command: '/electron', args: [fs.realpathSync(real)], env: { A: '1' }, cwd: '/idle' });
    expect(launchSpec('fake', { execPath: '/electron', fakeEntry: '/fake.js', env: {}, cwd: '/idle' })).toEqual({ command: '/electron', args: ['/fake.js'], env: {}, cwd: '/idle' });
    expect(() => launchSpec({ ...(detected as object), adapterEntry: null } as never, { execPath: '/e', fakeEntry: '/f', env: {}, cwd: '/c' })).toThrow();
  });

  it('makes the agent, work and temp folders 0700, also when they existed with a looser mode, and only names idle and probe', () => {
    const user = tempRoot();
    const home = tutorHome(user, { live: false, liveHome: undefined });
    const loose = path.join(home, 'tmp');
    fs.mkdirSync(loose, { recursive: true, mode: 0o755 });
    fs.chmodSync(loose, 0o755);
    expect(mode(tmpDir(user))).toBe(0o700);
    const a = agentHome(home, 'claude');
    expect(a).toBe(path.join(user, 'Tutor', 'agents', 'claude'));
    expect(mode(a)).toBe(0o700);
    const w = workDir(user, 'conv-1');
    expect(w).toBe(path.join(user, 'Tutor', 'work', 'conv-1'));
    expect(mode(w)).toBe(0o700);
    expect(idleDir(user)).toBe(path.join(user, 'Tutor', 'idle'));
    expect(probeDir(user)).toBe(path.join(user, 'Tutor', 'probe'));
    expect(fs.existsSync(idleDir(user))).toBe(false);
    expect(fs.existsSync(probeDir(user))).toBe(false);
    expect(() => workDir(user, '../x')).toThrow();
  });

  it('puts the login folder elsewhere only in a live run with an absolute path (N1)', () => {
    expect(tutorHome('/u', { live: true, liveHome: '/abs/live' })).toBe('/abs/live');
    expect(tutorHome('/u', { live: false, liveHome: '/abs/live' })).toBe(path.join('/u', 'Tutor'));
    expect(tutorHome('/u', { live: true, liveHome: 'relative' })).toBe(path.join('/u', 'Tutor'));
    expect(tutorHome('/u', { live: true, liveHome: undefined })).toBe(path.join('/u', 'Tutor'));
  });

  it('takes only -32000 "Authentication required" for a login request', () => {
    expect(isLoginRequired(new RpcError(-32000, 'Authentication required'))).toBe(true);
    expect(isLoginRequired(new RpcError(-32603, 'Authentication required'))).toBe(false);
    expect(isLoginRequired(new RpcError(-32000, 'Something else'))).toBe(false);
    expect(isLoginRequired(new Error('Authentication required'))).toBe(false);
    expect(isLoginRequired(null)).toBe(false);
  });

  describe('loginCommand', () => {
    it('writes a folder inside the home as $HOME/…, as the macOS one reads', () => {
      expect(loginCommand('claude', '/Users/a/Library/Application Support/Learn/Tutor/agents/claude', '/Users/a')).toBe(
        'CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Learn/Tutor/agents/claude" claude auth login',
      );
    });
    it('treats a path as inside the home by segment, not by string prefix', () => {
      expect(loginCommand('claude', '/home/ab/x', '/home/a')).toBe('CLAUDE_CONFIG_DIR="/home/ab/x" claude auth login');
      expect(loginCommand('claude', '/elsewhere/x', '/home/a')).toBe('CLAUDE_CONFIG_DIR="/elsewhere/x" claude auth login');
    });
    it('escapes backslash, quote, dollar and backtick in the path, not the $HOME prefix', () => {
      expect(loginCommand('claude', '/h/a"b$c`d\\e', '/h')).toBe('CLAUDE_CONFIG_DIR="$HOME/a\\"b\\$c\\`d\\\\e" claude auth login');
      expect(loginCommand('claude', '/o/a"b$c', '/h')).toBe('CLAUDE_CONFIG_DIR="/o/a\\"b\\$c" claude auth login');
    });
  });
});
