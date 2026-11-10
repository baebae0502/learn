import { afterEach, describe, expect, it, vi } from 'vitest';
import { tutorLog } from './log';

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
