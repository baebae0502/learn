import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tutorEnvPolicy } from './env-policy';

const USERDATA = '/u/Learn';
const TUTOR = path.join(USERDATA, 'Tutor');
const EMPTY = path.join(TUTOR, 'e2e-empty-path');
/** Every variable the policy could read, all set. */
const ALL = {
  LEARN_E2E: '1', LEARN_AGENT_SEARCH_PATH: '/t/npm/bin', LEARN_AGENT_LIVE: '1', LEARN_AGENT_LIVE_PATH: '/live/bin', LEARN_AGENT_LIVE_HOME: '/live/home',
};
const policy = (env: NodeJS.ProcessEnv, isPackaged = false) => tutorEnvPolicy({ isPackaged, env, userData: USERDATA });

describe('tutorEnvPolicy: what the tutor reads from LEARN_E2E and LEARN_AGENT_*', () => {
  it('neither: the normal search, the login shell allowed, the Learn-only folder, the fake shown unpackaged', () => {
    expect(policy({ PATH: '/usr/bin' })).toEqual({
      e2e: false, live: false, searchPath: null, emptySearchFolder: null, tutorHome: TUTOR, loginShellAllowed: true, fakeAvailable: true, fakeLog: null,
    });
  });

  it('packaged: every LEARN_AGENT_* and LEARN_E2E value is ignored', () => {
    expect(policy(ALL, true)).toEqual({
      e2e: false, live: false, searchPath: null, emptySearchFolder: null, tutorHome: TUTOR, loginShellAllowed: true, fakeAvailable: false, fakeLog: null,
    });
  });

  it('E2E: its test install when LEARN_AGENT_SEARCH_PATH is set; no login shell; the fake log in userData', () => {
    expect(policy({ LEARN_E2E: '1', LEARN_AGENT_SEARCH_PATH: '/t/npm/bin' })).toEqual({
      e2e: true, live: false, searchPath: '/t/npm/bin', emptySearchFolder: null, tutorHome: TUTOR, loginShellAllowed: false, fakeAvailable: true,
      fakeLog: path.join(USERDATA, 'fake-agent.log'),
    });
  });

  it('E2E without LEARN_AGENT_SEARCH_PATH (unset or empty): the empty folder, which the caller makes', () => {
    for (const env of [{ LEARN_E2E: '1' }, { LEARN_E2E: '1', LEARN_AGENT_SEARCH_PATH: '' }]) {
      expect(policy(env)).toMatchObject({ e2e: true, searchPath: EMPTY, emptySearchFolder: EMPTY, loginShellAllowed: false });
    }
  });

  it('E2E comes before live: LEARN_AGENT_LIVE_PATH never wins (a live E2E passes LEARN_AGENT_SEARCH_PATH itself); its home is still the live one', () => {
    expect(policy(ALL)).toMatchObject({ e2e: true, live: true, searchPath: '/t/npm/bin', emptySearchFolder: null, tutorHome: '/live/home', loginShellAllowed: false });
    const { LEARN_AGENT_SEARCH_PATH: _given, ...without } = ALL;
    expect(policy(without)).toMatchObject({ e2e: true, live: true, searchPath: EMPTY, emptySearchFolder: EMPTY });
  });

  it('live without E2E: LEARN_AGENT_LIVE_PATH and LEARN_AGENT_LIVE_HOME, no login shell', () => {
    const { LEARN_E2E: _e2e, ...live } = ALL;
    expect(policy(live)).toEqual({
      e2e: false, live: true, searchPath: '/live/bin', emptySearchFolder: null, tutorHome: '/live/home', loginShellAllowed: false, fakeAvailable: true, fakeLog: null,
    });
    // No search path given: nothing is searched (an empty list), never the normal search.
    expect(policy({ LEARN_AGENT_LIVE: '1' })).toMatchObject({ live: true, searchPath: '', tutorHome: TUTOR });
  });

  it('a live home that is not an absolute path is not used: the Learn-only folder', () => {
    for (const home of ['relative/home', '', './x']) {
      expect(policy({ LEARN_AGENT_LIVE: '1', LEARN_AGENT_LIVE_PATH: '/live/bin', LEARN_AGENT_LIVE_HOME: home })).toMatchObject({ live: true, tutorHome: TUTOR });
    }
  });

  it('only LEARN_AGENT_LIVE=1 makes a live run, and only LEARN_E2E=1 an E2E one: the other variables alone change nothing', () => {
    const { LEARN_E2E: _e2e, LEARN_AGENT_LIVE: _live, ...rest } = ALL;
    for (const env of [rest, { ...rest, LEARN_AGENT_LIVE: 'true' }, { ...rest, LEARN_E2E: 'yes' }]) {
      expect(policy(env)).toMatchObject({ e2e: false, live: false, searchPath: null, tutorHome: TUTOR, loginShellAllowed: true });
    }
  });
});
