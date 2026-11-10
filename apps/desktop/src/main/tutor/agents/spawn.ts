import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { LearnError } from '@learn/domain';
import { createLineReader } from '../acp/jsonrpc';
import { tutorLog } from '../log';
import type { LaunchSpec } from './isolation';

export interface ChildPort {
  readonly pid: number;
  /** One message: the newline that ends it is added here. Nothing is written once the agent has gone. */
  write(line: string): void;
  /** Closes stdin. */
  endInput(): void;
  onLine(fn: (line: string) => void, onOverflow: () => void): void;
  onExit(fn: (e: { code: number | null; signal: NodeJS.Signals | null }) => void): void;
  readonly exited: boolean;
  /** To the whole group, so the CLI the adapter started gets it too. */
  signalGroup(sig: 'SIGTERM' | 'SIGKILL'): void;
  /** Some process of the group still runs: the CLI outlives the adapter by up to a second. */
  groupAlive(): boolean;
}

const ignore = () => {};

/** child_process.spawn without a shell: argument array, stdio pipes, detached (its own process group); stderr read and dropped. */
export function spawnAgent(spec: LaunchSpec): ChildPort {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true, shell: false, windowsHide: true });
  } catch (e) {
    throw new LearnError('AGENT_START_FAILED', 'The agent could not be started.', { cause: e });
  }
  // A failed start and a write to an agent that has gone (EPIPE) arrive as error events; none may reach the process.
  child.on('error', (e: NodeJS.ErrnoException) => {
    if (child.pid === undefined) tutorLog('agent-start-failed', { code: e.code ?? 'unknown' });
  });
  child.stdin.on('error', ignore);
  child.stdout.on('error', ignore);
  child.stderr.on('error', ignore);
  // The question's text can be in it: drained so the agent never blocks on it, and never read.
  child.stderr.resume();
  const pid = child.pid;
  if (pid === undefined) throw new LearnError('AGENT_START_FAILED', 'The agent could not be started.');

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const exitFns: Array<(e: { code: number | null; signal: NodeJS.Signals | null }) => void> = [];
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    tutorLog('agent-exit', { code: signal ?? String(code) });
    for (const fn of exitFns.splice(0)) fn(exit);
  });

  // Once the group is seen gone its id may be given to an unrelated group, so it is never signalled again.
  let groupGone = false;
  const groupAlive = () => {
    if (groupGone) return false;
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      groupGone = true;
      return false;
    }
  };

  return {
    pid,
    write(line) {
      if (exit !== null || !child.stdin.writable) return;
      child.stdin.write(`${line}\n`);
    },
    endInput() {
      if (child.stdin.writable) child.stdin.end();
    },
    onLine(fn, onOverflow) {
      const reader = createLineReader(fn, onOverflow);
      child.stdout.on('data', (chunk: Buffer) => reader.push(chunk));
    },
    onExit(fn) {
      const e = exit;
      if (e !== null) queueMicrotask(() => fn(e));
      else exitFns.push(fn);
    },
    get exited() {
      return exit !== null;
    },
    signalGroup(sig) {
      if (!groupAlive()) return;
      try {
        process.kill(-pid, sig);
      } catch {
        groupGone = true;
      }
    },
    groupAlive,
  };
}
