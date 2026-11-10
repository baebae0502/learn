import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

/** The file a launch's main log goes to in `dir`: main.log, then main-2.log, main-3.log… for a test's later launches. */
export function nextLogFile(dir: string): string {
  let file = path.join(dir, 'main.log');
  for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `main-${n}.log`);
  return file;
}

/**
 * One stream's chunks as whole lines, each stamped with the time it came and the stream's tag; a line split across chunks
 * waits for its end, and a character split across chunks is put back together.
 */
export function lineStamper(tag: string, write: (text: string) => void, now: () => Date = () => new Date()): { data(chunk: Buffer | string): void; end(): void } {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  const stamp = (lines: string[]): void => {
    if (lines.length === 0) return;
    const at = now().toISOString();
    write(lines.map((line) => `${at} ${tag} ${line}\n`).join(''));
  };
  return {
    data(chunk) {
      const lines = (rest + (typeof chunk === 'string' ? chunk : decoder.write(chunk))).split('\n');
      rest = lines.pop() ?? '';
      stamp(lines.map((line) => line.replace(/\r$/, '')));
    },
    end() {
      const last = rest + decoder.end();
      rest = '';
      if (last !== '') stamp([last]);
    },
  };
}

export interface LoggedProcess {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: 'close', listener: () => void): unknown;
}

/**
 * Keeps the Electron main process's stdout and stderr in `file` from now on, line by line. The writes are synchronous: a
 * test that hangs until its worker is stopped still leaves every line main printed. What main printed before the call
 * (while Playwright was still starting it) is not there. A file that cannot be written is given up quietly: the log is
 * evidence, never a reason for a test to fail.
 */
export function keepMainLog(child: LoggedProcess, file: string): void {
  let fd: number | null = null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fd = fs.openSync(file, 'a');
  } catch {
    return;
  }
  const write = (text: string): void => {
    if (fd === null) return;
    try {
      fs.writeSync(fd, text);
    } catch {
      fs.closeSync(fd);
      fd = null;
    }
  };
  write(`${new Date().toISOString()} --- main pid ${child.pid ?? '?'}: its stdout (out) and stderr (err) from here on\n`);
  const out = lineStamper('out', write);
  const err = lineStamper('err', write);
  child.stdout?.on('data', out.data);
  child.stderr?.on('data', err.data);
  child.once('close', () => {
    out.end();
    err.end();
    if (fd !== null) fs.closeSync(fd);
    fd = null;
  });
}
