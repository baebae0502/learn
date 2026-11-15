import path from 'node:path';
import { isE2E } from '../deterministic';
import { tutorHome } from './agents/isolation';

export interface TutorEnvPolicy {
  /** LEARN_E2E=1 in an unpackaged build. */
  e2e: boolean;
  /** LEARN_AGENT_LIVE=1 in an unpackaged build: a live run against the real agent. */
  live: boolean;
  /** Where detection looks: E2E's test install or its empty folder, a live run's own folders, or null (the normal search). */
  searchPath: string | null;
  /** The empty folder an E2E search falls back to, which the caller makes; null when there is none to make. */
  emptySearchFolder: string | null;
  /** The base of the agents' folders: a live run's own login folder, else <userData>/Tutor. */
  tutorHome: string;
  /** 다시 찾기 may read the login shell's PATH: never under E2E or in a live run. */
  loginShellAllowed: boolean;
  /** The fake agent is offered: unpackaged builds only. */
  fakeAvailable: boolean;
  /** The fake agents' log (E2E only). */
  fakeLog: string | null;
}

/**
 * What the tutor takes from the environment, and nothing more: a packaged app reads none of these variables. E2E comes
 * before a live run, so an E2E run never finds the machine's real agent unless the test names its folder itself
 * (LEARN_AGENT_SEARCH_PATH). No I/O: the caller makes the empty folder.
 */
export function tutorEnvPolicy(o: { isPackaged: boolean; env: NodeJS.ProcessEnv; userData: string }): TutorEnvPolicy {
  const e2e = isE2E(o.isPackaged, o.env);
  const live = !o.isPackaged && o.env['LEARN_AGENT_LIVE'] === '1';
  const empty = path.join(o.userData, 'Tutor', 'e2e-empty-path');
  const given = e2e ? o.env['LEARN_AGENT_SEARCH_PATH'] || null : null;
  return {
    e2e,
    live,
    searchPath: e2e ? (given ?? empty) : live ? (o.env['LEARN_AGENT_LIVE_PATH'] ?? '') : null,
    emptySearchFolder: e2e && given === null ? empty : null,
    tutorHome: tutorHome(o.userData, { live, liveHome: live ? o.env['LEARN_AGENT_LIVE_HOME'] : undefined }),
    loginShellAllowed: !e2e && !live,
    fakeAvailable: !o.isPackaged,
    fakeLog: e2e ? path.join(o.userData, 'fake-agent.log') : null,
  };
}
