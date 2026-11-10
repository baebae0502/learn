import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { keepMainLog, lineStamper, nextLogFile } from './main-log';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-main-log-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const AT = new Date('2026-11-10T01:02:03.004Z');

describe('nextLogFile', () => {
  it('main.log first, then main-2.log, main-3.log for the same test\'s later launches', () => {
    expect(nextLogFile(dir)).toBe(path.join(dir, 'main.log'));
    fs.writeFileSync(path.join(dir, 'main.log'), '');
    expect(nextLogFile(dir)).toBe(path.join(dir, 'main-2.log'));
    fs.writeFileSync(path.join(dir, 'main-2.log'), '');
    expect(nextLogFile(dir)).toBe(path.join(dir, 'main-3.log'));
  });
});

describe('lineStamper', () => {
  it('writes whole lines stamped with the time and the stream; a line split across chunks waits for its end', () => {
    const out: string[] = [];
    const s = lineStamper('err', (t) => void out.push(t), () => AT);
    s.data(Buffer.from('[text] the body text loop st'));
    expect(out).toEqual([]);
    s.data(Buffer.from('opped: INTERNAL\r\nsecond\nthi'));
    s.end();
    expect(out.join('')).toBe(
      `${AT.toISOString()} err [text] the body text loop stopped: INTERNAL\n${AT.toISOString()} err second\n${AT.toISOString()} err thi\n`,
    );
  });

  it('puts a character split across chunks back together', () => {
    const out: string[] = [];
    const s = lineStamper('out', (t) => void out.push(t), () => AT);
    const bytes = Buffer.from('본문\n');
    s.data(bytes.subarray(0, 2));
    s.data(bytes.subarray(2));
    expect(out.join('')).toBe(`${AT.toISOString()} out 본문\n`);
  });
});

describe('keepMainLog', () => {
  it('keeps both streams in the file as they come, and closes it when the process has closed', () => {
    const child = Object.assign(new EventEmitter(), { pid: 42, stdout: new PassThrough(), stderr: new PassThrough() });
    const file = path.join(dir, 'nested', 'main.log');
    keepMainLog(child, file);
    child.stdout.write('ready\n');
    child.stderr.write('[check] the startup check failed: INTERNAL\n');
    // Written at once, before the process has ended: a hung test still leaves the lines.
    const now = fs.readFileSync(file, 'utf8');
    expect(now).toMatch(/^\S+ --- main pid 42: /);
    expect(now).toMatch(/\n\S+ out ready\n/);
    expect(now).toMatch(/\n\S+ err \[check\] the startup check failed: INTERNAL\n$/);
    child.stdout.write('last words');
    child.emit('close');
    expect(fs.readFileSync(file, 'utf8')).toMatch(/\n\S+ out last words\n$/);
  });

  it('a file that cannot be made is given up without throwing', () => {
    const blocker = path.join(dir, 'a-file');
    fs.writeFileSync(blocker, '');
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: null });
    expect(() => keepMainLog(child, path.join(blocker, 'main.log'))).not.toThrow();
    child.stdout.write('x\n');
    child.emit('close');
  });
});
