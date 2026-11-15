import { afterEach, describe, expect, it, vi } from 'vitest';
import { LearnError } from '@learn/domain';
import { codeOf, errorCode, tutorLog } from './log';

describe('tutorLog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes the event, then its code, latency and request id', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    tutorLog('turn-end', { code: 'AGENT_EXITED', ms: 12, req: 7 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith('[tutor] turn-end code=AGENT_EXITED ms=12 req=7');
  });

  it('leaves out a field that is not given, but writes a zero', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    tutorLog('spawn');
    tutorLog('first-text', { ms: 0 });
    tutorLog('rpc-unknown-id', { req: 'a1' });
    expect(info.mock.calls).toEqual([['[tutor] spawn'], ['[tutor] first-text ms=0'], ['[tutor] rpc-unknown-id req=a1']]);
  });

  it('takes no other field: the type refuses one, and one slipped past it is not written', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // @ts-expect-error a question's text is never a log field
    tutorLog('turn-end', { code: 'AGENT_EXITED', text: 'what is on page 3?' });
    const smuggled = { code: 'AGENT_EXITED', stderr: 'secret' };
    tutorLog('exit', smuggled);
    expect(info.mock.calls).toEqual([['[tutor] turn-end code=AGENT_EXITED'], ['[tutor] exit code=AGENT_EXITED']]);
  });
});

describe('errorCode', () => {
  it('a LearnError\'s code, a system error\'s code, an error\'s name — never its message', () => {
    expect(errorCode(new LearnError('AGENT_EXITED', 'the agent at /home/x exited'))).toBe('AGENT_EXITED');
    expect(errorCode(Object.assign(new Error('ENOENT: no such file, open /home/x/secret'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errorCode(Object.assign(new Error('closed'), { code: 'ERR_SERVER_NOT_RUNNING' }))).toBe('ERR_SERVER_NOT_RUNNING');
    expect(errorCode(new TypeError('bad /home/x'))).toBe('TypeError');
    expect(errorCode('a string thrown')).toBe('UNKNOWN');
  });
  it('a code that is not a plain token is not written: the error\'s name instead', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'not a code /home/x' }))).toBe('Error');
    expect(errorCode(Object.assign(new Error('x'), { code: 42 }))).toBe('Error');
  });
});

describe('codeOf', () => {
  it('a LearnError\'s code, else the error\'s name: where it differs from errorCode, both are kept as they were', () => {
    expect(codeOf(new LearnError('AGENT_EXITED', 'the agent at /home/x exited'))).toBe('AGENT_EXITED');
    expect(codeOf(new TypeError('bad /home/x'))).toBe('TypeError');
    expect(codeOf('a string thrown')).toBe('UNKNOWN');
    // A system error is its name here, its code in errorCode; a plain object's code is read by errorCode only.
    const enoent = Object.assign(new Error('ENOENT: no such file, open /home/x/secret'), { code: 'ENOENT' });
    expect([codeOf(enoent), errorCode(enoent)]).toEqual(['Error', 'ENOENT']);
    expect([codeOf({ code: 'ENOENT' }), errorCode({ code: 'ENOENT' })]).toEqual(['UNKNOWN', 'ENOENT']);
  });
});
