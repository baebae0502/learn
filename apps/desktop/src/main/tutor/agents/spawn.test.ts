import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { spawnAgent, type ChildPort } from './spawn';

// The real spawn, unless a test replaces one call (a start that got no pid and no stdio).
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// Small Node scripts run with this Node: never a real agent.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-spawn-'));
const script = (name: string, body: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
};
const ARGS = script('args.cjs', `
// More stderr than a pipe holds: a parent that did not drain it would leave this process blocked here.
process.stderr.write('STDERR-TEXT '.repeat(100_000) + '\\n');
process.stdout.write(JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('second line\\n');
`);
// A grandchild in the same group, its pid on stdout; then this process stays, or exits and leaves the grandchild running.
const GROUP = script('group.cjs', `
const { spawn } = require('node:child_process');
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
if (process.argv[2] === 'exit') process.stdout.write(grandchild.pid + '\\n', () => process.exit(0));
else {
  process.stdout.write(grandchild.pid + '\\n');
  setInterval(() => {}, 1000);
}
`);
// Each line read back on stdout; exits when stdin ends.
const ECHO = script('echo.cjs', `
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;
  let nl;
  while ((nl = buffered.indexOf('\\n')) !== -1) {
    process.stdout.write('got ' + buffered.slice(0, nl) + '\\n');
    buffered = buffered.slice(nl + 1);
  }
});
process.stdin.on('end', () => process.exit(buffered === '' ? 0 : 3));
`);
// More than one line may hold, and no newline.
const OVERFLOW = script('overflow.cjs', `
process.stdout.write('x'.repeat(9 * 1024 * 1024));
`);
const CLOSED_STDIN = script('closed-stdin.cjs', `
require('node:fs').closeSync(0);
process.stdout.write('closed\\n');
setInterval(() => {}, 1000);
`);

const started: ChildPort[] = [];
const rawPids: number[] = [];
let info: MockInstance<typeof console.info>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(async () => {
  // Only the groups these tests started.
  for (const port of started.splice(0)) {
    if (port.groupAlive()) port.signalGroup('SIGKILL');
    await vi.waitFor(() => expect(port.groupAlive()).toBe(false), { timeout: 10_000 });
  }
  for (const pid of rawPids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already ended
    }
  }
  vi.restoreAllMocks();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function start(file: string, args: string[] = []) {
  const port = spawnAgent({ command: process.execPath, args: [file, ...args], env: {}, cwd: dir });
  started.push(port);
  const lines: string[] = [];
  port.onLine((line) => lines.push(line), () => lines.push('<overflow>'));
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => port.onExit(resolve));
  return { port, lines, exit };
}

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const groupOf = (pid: number) => Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());

describe('spawnAgent', () => {
  it('passes the arguments as they are, with no shell between', async () => {
    const args = ['two words', '"quoted"', "it's", '$HOME', '; echo injected', '*'];
    const { lines, exit } = start(ARGS, args);
    await exit;
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines).toEqual([JSON.stringify(args), 'second line']);
  });

  it('delivers stdout line by line and drops stderr unread; the exit is logged with its code alone', async () => {
    const { lines, exit } = start(ARGS);
    await expect(exit).resolves.toEqual({ code: 0, signal: null });
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines.join('\n')).not.toContain('STDERR-TEXT');
    expect(info.mock.calls).toEqual([['[tutor] agent-exit code=0']]);
  });

  it('starts the agent as the leader of a new process group, which SIGKILL ends with the processes it started', async () => {
    const { port, lines, exit } = start(GROUP);
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    const grandchild = Number(lines[0]);
    expect(() => process.kill(-port.pid, 0)).not.toThrow();
    expect(groupOf(port.pid)).toBe(port.pid);
    expect(groupOf(grandchild)).toBe(port.pid);
    expect(groupOf(process.pid)).not.toBe(port.pid);
    expect(isRunning(grandchild)).toBe(true);
    port.signalGroup('SIGKILL');
    await expect(exit).resolves.toEqual({ code: null, signal: 'SIGKILL' });
    expect(port.exited).toBe(true);
    expect(info).toHaveBeenCalledWith('[tutor] agent-exit code=SIGKILL');
    await vi.waitFor(() => expect(port.groupAlive()).toBe(false), { timeout: 10_000 });
    expect(isRunning(grandchild)).toBe(false);
  });

  it('reports its group alive while a process it started outlives it, and not after that one has ended', async () => {
    const { port, lines, exit } = start(GROUP, ['exit']);
    await expect(exit).resolves.toEqual({ code: 0, signal: null });
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    const grandchild = Number(lines[0]);
    expect(port.exited).toBe(true);
    expect(isRunning(grandchild)).toBe(true);
    expect(port.groupAlive()).toBe(true);
    const kill = vi.spyOn(process, 'kill');
    port.signalGroup('SIGTERM');
    expect(kill).toHaveBeenCalledWith(-port.pid, 'SIGTERM');
    await vi.waitFor(() => expect(port.groupAlive()).toBe(false), { timeout: 10_000 });
    expect(isRunning(grandchild)).toBe(false);
    // Once seen gone, its id may go to an unrelated group: it is never signalled or probed again.
    kill.mockClear();
    port.signalGroup('SIGKILL');
    expect(port.groupAlive()).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('writes each message as one line, and endInput closes stdin', async () => {
    const { port, lines, exit } = start(ECHO);
    port.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    port.write('{"jsonrpc":"2.0","method":"session/cancel"}');
    await vi.waitFor(() => expect(lines).toHaveLength(2));
    expect(lines).toEqual(['got {"jsonrpc":"2.0","id":1,"method":"initialize"}', 'got {"jsonrpc":"2.0","method":"session/cancel"}']);
    expect(port.exited).toBe(false);
    port.endInput();
    await expect(exit).resolves.toEqual({ code: 0, signal: null });
  });

  it('a write to an agent that closed its stdin or has exited does not throw (EPIPE)', async () => {
    // Positive control: the same script really makes a raw write fail with EPIPE.
    const raw = spawn(process.execPath, [CLOSED_STDIN], { stdio: ['pipe', 'pipe', 'ignore'] });
    if (raw.pid !== undefined) rawPids.push(raw.pid);
    await new Promise<void>((resolve) => raw.stdout.once('data', () => resolve()));
    const rawError = new Promise<string | undefined>((resolve) => raw.stdin.once('error', (e: NodeJS.ErrnoException) => resolve(e.code)));
    raw.stdin.write('x'.repeat(65_536));
    await expect(rawError).resolves.toBe('EPIPE');

    const { port, lines, exit } = start(CLOSED_STDIN);
    await vi.waitFor(() => expect(lines).toEqual(['closed']));
    expect(() => {
      for (let i = 0; i < 4; i++) port.write(JSON.stringify({ jsonrpc: '2.0', method: 'x', params: 'x'.repeat(65_536) }));
    }).not.toThrow();
    port.signalGroup('SIGKILL');
    await exit;
    expect(() => {
      port.write('{"jsonrpc":"2.0","method":"late"}');
      port.endInput();
    }).not.toThrow();
  });

  it('a program that cannot start is AGENT_START_FAILED, and only its error code is logged', async () => {
    let error: unknown = null;
    try {
      spawnAgent({ command: path.join(dir, 'missing-adapter'), args: [], env: {}, cwd: dir });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'AGENT_START_FAILED' });
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('[tutor] agent-start-failed code=ENOENT'));
    expect(info.mock.calls).toEqual([['[tutor] agent-start-failed code=ENOENT']]);
  });

  it('a start that got no pid and no stdio (EMFILE) is AGENT_START_FAILED, not a crash on the missing pipes', async () => {
    const failed = Object.assign(new EventEmitter(), { pid: undefined, stdin: null, stdout: null, stderr: null });
    vi.mocked(spawn).mockImplementationOnce((() => {
      process.nextTick(() => failed.emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' })));
      return failed as unknown as ChildProcess;
    }) as unknown as typeof spawn);
    let error: unknown = null;
    try {
      spawnAgent({ command: process.execPath, args: [ARGS], env: {}, cwd: dir });
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: 'AGENT_START_FAILED' });
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('[tutor] agent-start-failed code=EMFILE'));
  });

  it('a line longer than the limit reaches onOverflow', async () => {
    const { lines, exit } = start(OVERFLOW);
    await expect(exit).resolves.toEqual({ code: 0, signal: null });
    await vi.waitFor(() => expect(lines).toEqual(['<overflow>']));
  });
});
