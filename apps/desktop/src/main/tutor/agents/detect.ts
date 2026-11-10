import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TUTOR_TIMEOUTS, type AgentId, type AgentState, type AgentStatus, type AgentsReport, type RealAgentId } from '@learn/domain';
import { AGENT_CATALOG, installAdapter, type AgentCatalogEntry } from './catalog';
import { ENV_ALLOW, agentHome, agentHomePath, loginCommand } from './isolation';

/** path: the ':'-joined absolute folders searched for it, login shell's included; the agent's PATH. */
export interface Detected { entry: AgentCatalogEntry; path: string; cliPath: string | null; cliVersion: string | null; adapterEntry: string | null; adapterVersion: string | null }
export interface DetectDeps {
  env: NodeJS.ProcessEnv; home: string; platform: NodeJS.Platform;
  /** E2E (LEARN_E2E): LEARN_AGENT_SEARCH_PATH, or an empty folder when unset (I8). Live (LEARN_AGENT_LIVE=1): LEARN_AGENT_LIVE_PATH. Otherwise null. */
  searchPath: string | null;
  /** false under E2E and live runs. */
  loginShellAllowed: boolean;
  /** Replaces the fixed system folders (/usr/local/bin, /opt/homebrew/bin) so a test never reaches a real CLI. */
  knownDirs?: readonly string[];
  run(file: string, args: string[], o: { timeoutMs: number; maxBytes: number; env?: Record<string, string>; cwd?: string }): Promise<{ stdout: string; code: number | null }>;
  /** $SHELL -ilc 'printf %s "$PATH"', 3 s, 64 KiB. */
  loginShellPath(): Promise<string | null>;
  /** Task 12 runs it through the supervisor. */
  probeLogin(d: Detected): Promise<'ok' | 'login' | 'old' | 'failed'>;
  /** !app.isPackaged */
  fakeAvailable: boolean;
  /** tutorHome(...): the login command names agentHome(tutorHome, agent). */
  tutorHome: string;
}

const VERSION = /(\d+\.\d+\.\d+)/;

/** A program run without a shell: output capped at maxBytes, killed at timeoutMs (code null), rejected when it cannot start. */
export function run(file: string, args: string[], o: { timeoutMs: number; maxBytes: number; env?: Record<string, string>; cwd?: string }): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], shell: false, detached: true, ...(o.env ? { env: o.env } : {}), ...(o.cwd ? { cwd: o.cwd } : {}) });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks).toString('utf8'), code });
    };
    const stop = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      child.stdout.destroy();
    };
    const timer = setTimeout(() => {
      stop();
      finish(null);
    }, o.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      const room = o.maxBytes - size;
      if (room > 0) {
        chunks.push(chunk.subarray(0, room));
        size += Math.min(room, chunk.length);
      }
      if (size >= o.maxBytes) {
        stop();
        finish(null);
      }
    });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => finish(code));
  });
}

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const versionDirs = (root: string, suffix: string): string[] => {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  return names
    .sort((a, b) => compareVersions(b.replace(/^v/, ''), a.replace(/^v/, '')))
    .map((n) => path.join(root, n, suffix));
};

export function searchDirs(deps: Pick<DetectDeps, 'env' | 'home' | 'platform' | 'searchPath' | 'knownDirs'>, extraPath?: string): string[] {
  const split = (p: string | undefined) => (p ?? '').split(':').filter((d) => d !== '' && path.isAbsolute(d));
  const out: string[] = [];
  const add = (dirs: string[]) => {
    for (const d of dirs) if (!out.includes(d)) out.push(d);
  };
  if (deps.searchPath !== null) {
    add(split(deps.searchPath));
    return out;
  }
  const h = deps.home;
  const mac = deps.platform === 'darwin';
  add(split(deps.env.PATH));
  add([
    ...(deps.knownDirs ?? [...(mac ? ['/opt/homebrew/bin'] : []), '/usr/local/bin']), path.join(h, '.local/bin'), path.join(h, '.claude/local'),
    path.join(h, '.npm-global/bin'), path.join(h, '.volta/bin'), path.join(h, '.bun/bin'),
    ...(mac ? [path.join(h, 'Library/pnpm')] : []),
    ...versionDirs(path.join(h, '.nvm/versions/node'), 'bin'),
    ...versionDirs(path.join(h, '.local/share/fnm/node-versions'), 'installation/bin'),
    path.join(h, '.asdf/shims'), path.join(h, '.local/share/mise/shims'),
  ]);
  add(split(extraPath));
  return out;
}

/** A file the path leads to; the CLI must also be executable, the adapter's entry is a script Electron's node runs. */
const isFile = (file: string, executable: boolean): boolean => {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (executable) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The adapter's entry file, if the bin link resolves to dist/index.js inside the package of that name; and the package's version. */
function readAdapter(binFile: string, pkgName: string): { entry: string; version: string | null } | null {
  let real: string;
  try {
    real = fs.realpathSync(binFile);
  } catch {
    return null;
  }
  let dir = path.dirname(real);
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
      if (pkg.name === pkgName) {
        if (real !== path.join(dir, 'dist', 'index.js')) return null;
        return { entry: real, version: typeof pkg.version === 'string' ? (VERSION.exec(pkg.version)?.[1] ?? null) : null };
      }
    } catch {
      // not a package folder; keep going up
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export interface AgentDetector {
  /** One detection in flight at a time: a second caller shares it (I5). */
  report(mode: 'cached' | 'recheck' | 'research', agent?: AgentId): Promise<AgentsReport>;
  /** The report of this run if there is one — never starts a detection (tutor:ask reads only this, I5). */
  cachedReport(): AgentsReport | null;
  detected(agent: RealAgentId): Detected | null;
  markLockedOut(agent: AgentId): void;
  markLogin(agent: AgentId): void;
}

export function createAgentDetector(deps: DetectDeps): AgentDetector {
  const detectedBy = new Map<RealAgentId, Detected>();
  const statusBy = new Map<RealAgentId, AgentStatus>();
  const lockedOut = new Set<AgentId>();
  const loginMarked = new Set<AgentId>();
  /** What the login shell showed on a research: kept for the run, so a recheck finds the same things. */
  let loginShellDirs: string | undefined;
  let hasReport = false;
  let inflight: Promise<AgentsReport> | null = null;

  const status = (e: AgentCatalogEntry, d: Detected, state: AgentState, command: string | null, note: 'lockdown' | null): AgentStatus =>
    ({ id: e.id, name: e.name, state, cliVersion: d.cliVersion, adapterVersion: d.adapterVersion, minimum: e.minimum, command, note });
  const loginStatus = (e: AgentCatalogEntry, d: Detected) =>
    status(e, d, 'login', loginCommand(e.id, agentHomePath(deps.tutorHome, e.id), deps.home), null);
  const lockStatus = (e: AgentCatalogEntry, d: Detected) => status(e, d, 'old', null, 'lockdown');

  async function find(e: AgentCatalogEntry): Promise<Detected> {
    const dirs = searchDirs(deps, loginShellDirs);
    const d: Detected = { entry: e, path: dirs.join(':'), cliPath: null, cliVersion: null, adapterEntry: null, adapterVersion: null };
    for (const dir of dirs) {
      const file = path.join(dir, e.cli);
      if (isFile(file, true)) {
        d.cliPath = file;
        break;
      }
    }
    if (d.cliPath !== null) {
      try {
        const home = agentHome(deps.tutorHome, e.id);
        const env: Record<string, string> = {};
        for (const key of ENV_ALLOW) {
          const value = deps.env[key];
          if (value !== undefined) env[key] = value;
        }
        env.PATH = d.path;
        env.DISABLE_AUTOUPDATER = '1';
        env.CLAUDE_CONFIG_DIR = home;
        const out = await deps.run(d.cliPath, ['--version'], { timeoutMs: TUTOR_TIMEOUTS.versionMs, maxBytes: 4096, env, cwd: home });
        d.cliVersion = VERSION.exec(out.stdout)?.[1] ?? null;
      } catch {
        d.cliVersion = null;
      }
    }
    for (const dir of dirs) {
      const file = path.join(dir, e.adapterBin);
      if (!isFile(file, false)) continue;
      const found = readAdapter(file, e.adapterPackage);
      if (found) {
        d.adapterEntry = found.entry;
        d.adapterVersion = found.version;
        break;
      }
    }
    return d;
  }

  async function judge(e: AgentCatalogEntry, d: Detected): Promise<AgentStatus> {
    if (d.cliPath === null) return status(e, d, 'missing', e.installCli, null);
    if (d.adapterEntry === null) return status(e, d, 'adapter', installAdapter(e), null);
    const min = e.minimum;
    if (lockedOut.has(e.id) || min === null) return lockStatus(e, d);
    if (d.cliVersion === null || d.adapterVersion === null || compareVersions(d.cliVersion, min.cli) < 0 || compareVersions(d.adapterVersion, min.adapter) < 0) {
      return status(e, d, 'old', null, null);
    }
    let probe: Awaited<ReturnType<DetectDeps['probeLogin']>>;
    try {
      probe = await deps.probeLogin(d);
    } catch {
      probe = 'failed';
    }
    if (lockedOut.has(e.id)) return lockStatus(e, d);
    if (probe === 'failed') return status(e, d, 'adapter', installAdapter(e), null);
    if (probe === 'old') return status(e, d, 'old', null, null);
    if (probe === 'login' || loginMarked.has(e.id)) return loginStatus(e, d);
    return status(e, d, 'ready', null, null);
  }

  async function detectOne(e: AgentCatalogEntry): Promise<void> {
    loginMarked.delete(e.id);
    const d = await find(e);
    detectedBy.set(e.id, d);
    statusBy.set(e.id, await judge(e, d));
  }

  const fakeStatus = (): AgentStatus | null => {
    if (!deps.fakeAvailable) return null;
    const locked = lockedOut.has('fake');
    return { id: 'fake', name: 'fake', state: locked ? 'old' : 'ready', cliVersion: null, adapterVersion: null, minimum: null, command: null, note: locked ? 'lockdown' : null };
  };
  const build = (): AgentsReport => ({ agents: AGENT_CATALOG.map((e) => ({ ...statusBy.get(e.id)! })), fake: fakeStatus() });

  async function detect(mode: 'cached' | 'recheck' | 'research', agent: AgentId | undefined): Promise<AgentsReport> {
    const entries = mode === 'recheck' && agent !== undefined && hasReport ? AGENT_CATALOG.filter((e) => e.id === agent) : AGENT_CATALOG;
    for (const e of entries) await detectOne(e);
    if (mode === 'research' && deps.loginShellAllowed && entries.some((e) => detectedBy.get(e.id)!.cliPath === null || detectedBy.get(e.id)!.adapterEntry === null)) {
      let extra: string | null = null;
      try {
        extra = await deps.loginShellPath();
      } catch {
        extra = null;
      }
      if (extra !== null) {
        loginShellDirs = extra;
        for (const e of entries) {
          const d = detectedBy.get(e.id)!;
          if (d.cliPath === null || d.adapterEntry === null) await detectOne(e);
        }
      }
    }
    hasReport = true;
    return build();
  }

  return {
    report(mode, agent) {
      if (inflight) return inflight;
      if (mode === 'cached' && hasReport) return Promise.resolve(build());
      const p = detect(mode, agent).finally(() => {
        inflight = null;
      });
      inflight = p;
      return p;
    },
    cachedReport: () => (hasReport ? build() : null),
    detected: (agent) => detectedBy.get(agent) ?? null,
    markLockedOut(agent) {
      lockedOut.add(agent);
      if (agent === 'fake') return;
      const s = statusBy.get(agent);
      const d = detectedBy.get(agent);
      const e = AGENT_CATALOG.find((x) => x.id === agent);
      if (s && d && e && (s.state === 'ready' || s.state === 'login')) statusBy.set(agent, lockStatus(e, d));
    },
    markLogin(agent) {
      if (agent === 'fake') return;
      loginMarked.add(agent);
      const s = statusBy.get(agent);
      const d = detectedBy.get(agent);
      const e = AGENT_CATALOG.find((x) => x.id === agent);
      if (s && d && e && s.state === 'ready') statusBy.set(agent, loginStatus(e, d));
    },
  };
}
