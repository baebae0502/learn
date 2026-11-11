import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_CATALOG, installAdapter } from './catalog';
import { compareVersions, createAgentDetector, loginShellPath, run, searchDirs, type DetectDeps } from './detect';
import { launchSpec } from './isolation';

const made: string[] = [];
/** Every folder a test made: the only place a test may execute anything from. */
const roots: string[] = [];
const tempRoot = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-detect-'));
  made.push(d);
  roots.push(d);
  return d;
};

// Never created: the detector only names these, and the user data is not inside the home (so the login command is absolute).
const USERDATA = path.join(os.tmpdir(), `learn-detect-userdata-${process.pid}`);
const HOME = path.join(os.tmpdir(), `learn-detect-home-${process.pid}`);
roots.push(USERDATA, HOME);
afterEach(() => {
  runs.length = 0;
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(USERDATA, { recursive: true, force: true }); // the detector makes the Learn-only folder for --version
});
const PKG = '@agentclientprotocol/claude-agent-acp';

interface FakeLayout { cli?: string; cliOutput?: string; adapter?: string; outside?: boolean; nodeShebang?: boolean }
/** An npm-global-shaped install in a fresh folder; returns the folder to search. */
function fakeInstall(layout: FakeLayout): string {
  const root = tempRoot();
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  if (layout.cli !== undefined || layout.cliOutput !== undefined) {
    const file = path.join(bin, 'claude');
    const out = layout.cliOutput ?? `${layout.cli} (Claude Code)`;
    if (layout.nodeShebang) {
      // the interpreter is a fake script of its own, found only through PATH
      fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\nprintf '%s\\n' '${out}'\n`, { mode: 0o755 });
      fs.writeFileSync(file, '#!/usr/bin/env node\n', { mode: 0o755 });
    } else fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${out}'\n`, { mode: 0o755 });
  }
  if (layout.adapter !== undefined) {
    const pkg = path.join(root, 'lib', 'node_modules', PKG);
    fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: PKG, version: layout.adapter }));
    fs.writeFileSync(path.join(pkg, 'dist', 'index.js'), '');
    if (layout.outside) {
      const stray = path.join(root, 'stray.js');
      fs.writeFileSync(stray, '');
      fs.symlinkSync(stray, path.join(bin, 'claude-agent-acp'));
    } else fs.symlinkSync(path.join(pkg, 'dist', 'index.js'), path.join(bin, 'claude-agent-acp'));
  }
  return bin;
}

type Probe = 'ok' | 'login' | 'old' | 'failed';
const runs: Array<{ file: string; args: string[]; opts: Parameters<DetectDeps['run']>[2] }> = [];
function deps(o: Partial<DetectDeps> & { probe?: Probe } = {}): DetectDeps & { calls: string[] } {
  const calls: string[] = [];
  const { probe = 'ok', ...rest } = o;
  return {
    env: {}, home: HOME, platform: 'linux', searchPath: tempRoot(), loginShellAllowed: false,
    knownDirs: [],
    run: async (file, args, opts) => {
      if (!roots.some((r) => file.startsWith(r + path.sep))) throw new Error(`test refused to run ${file}`);
      calls.push(`run ${path.basename(file)}`);
      runs.push({ file, args, opts });
      return run(file, args, opts);
    },
    loginShellPath: async () => {
      calls.push('loginShell');
      return null;
    },
    probeLogin: async () => {
      calls.push('probe');
      return probe;
    },
    fakeAvailable: true, tutorHome: path.join(USERDATA, 'Tutor'),
    ...rest, calls,
  };
}

describe('detect', () => {
  it('tells the five states of the Claude Code row apart, in the spec\'s order', async () => {
    const state = async (layout: FakeLayout, probe: 'ok' | 'login' | 'old' | 'failed' = 'ok') =>
      (await createAgentDetector(deps({ searchPath: fakeInstall(layout), probe })).report('cached')).agents[0]!;
    expect(await state({})).toMatchObject({ id: 'claude', state: 'missing', command: 'npm install -g @anthropic-ai/claude-code' });
    expect(await state({ cli: '2.1.318' })).toMatchObject({ state: 'adapter', command: 'npm install -g @agentclientprotocol/claude-agent-acp@0.103.0' });
    expect(await state({ cli: '2.1.300', adapter: '0.103.0' })).toMatchObject({ state: 'old', note: null });
    expect(await state({ cli: '2.1.318', adapter: '0.103.0' }, 'login')).toMatchObject({ state: 'login', command: `CLAUDE_CONFIG_DIR="${path.join(USERDATA, 'Tutor', 'agents', 'claude')}" claude auth login` });
    expect(await state({ cli: '2.1.318', adapter: '0.103.0' })).toMatchObject({ state: 'ready', cliVersion: '2.1.318', adapterVersion: '0.103.0' });
  });

  it('keeps a lockdown that was reported while the login check ran', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const d = deps({ searchPath });
    const detector = createAgentDetector(d);
    d.probeLogin = async () => {
      detector.markLockedOut('claude');
      return 'ok';
    };
    expect((await detector.report('cached')).agents[0]).toMatchObject({ state: 'old', note: 'lockdown' });
    expect(detector.cachedReport()!.agents[0]).toMatchObject({ state: 'old', note: 'lockdown' });
  });

  it('says old for an adapter below the minimum', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.99.9' });
    expect((await createAgentDetector(deps({ searchPath })).report('cached')).agents[0]).toMatchObject({ state: 'old', note: null, adapterVersion: '0.99.9' });
  });

  it('turns a throwing login check into adapter and a throwing login shell into nothing, and the report still resolves', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const d = deps({ searchPath });
    d.probeLogin = async () => {
      throw new Error('boom');
    };
    expect((await createAgentDetector(d).report('cached')).agents[0]).toMatchObject({ state: 'adapter' });
    const s = deps({ searchPath: null, env: { PATH: '' }, loginShellAllowed: true });
    s.loginShellPath = async () => {
      throw new Error('boom');
    };
    expect((await createAgentDetector(s).report('research')).agents[0]).toMatchObject({ state: 'missing' });
  });

  it('keeps the file detection verified for the launch although the bin link is retargeted afterwards', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const detector = createAgentDetector(deps({ searchPath }));
    await detector.report('cached');
    const verified = fs.realpathSync(path.join(searchPath, 'claude-agent-acp'));
    const evil = path.join(searchPath, 'evil.js');
    fs.writeFileSync(evil, '');
    fs.rmSync(path.join(searchPath, 'claude-agent-acp'));
    fs.symlinkSync(evil, path.join(searchPath, 'claude-agent-acp'));
    const d = detector.detected('claude')!;
    expect(d.adapterEntry).toBe(verified);
    expect(launchSpec(d, { execPath: '/electron', fakeEntry: '/f', env: {}, cwd: '/c' }).args).toEqual([verified]);
  });

  it('reads --version with the allow-listed environment in the Learn-only folder, and hands the searched folders on as Detected.path', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const d = deps({
      searchPath,
      env: {
        PATH: '/should/not/leak', HOME: '/h', USER: 'u', LANG: 'ko_KR.UTF-8', HTTPS_PROXY: 'http://p:1', ANTHROPIC_API_KEY: 'k', anthropic_api_key: 'k', MY_API_KEY: 'k',
        NODE_OPTIONS: '--inspect', XDG_CACHE_HOME: '/c', ELECTRON_RUN_AS_NODE: '1', CLAUDE_CONFIG_DIR: '/users/own',
      },
    });
    const detector = createAgentDetector(d);
    await detector.report('cached');
    const home = path.join(USERDATA, 'Tutor', 'agents', 'claude');
    const call = runs.find((r) => r.args[0] === '--version')!;
    expect(call.opts.env).toEqual({
      HOME: '/h', USER: 'u', LANG: 'ko_KR.UTF-8', HTTPS_PROXY: 'http://p:1', PATH: searchPath, DISABLE_AUTOUPDATER: '1', CLAUDE_CONFIG_DIR: home,
    });
    expect(call.opts.cwd).toBe(home);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect(detector.detected('claude')!.path).toBe(searchPath);
  });

  it('reads the version of a CLI whose interpreter is only in the searched folder', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0', nodeShebang: true });
    const report = await createAgentDetector(deps({ searchPath, env: { PATH: '/nowhere' } })).report('cached');
    expect(report.agents[0]).toMatchObject({ state: 'ready', cliVersion: '2.1.318' });
  });

  it('keeps the login shell\'s folders for the run: a recheck still finds what only the login shell showed', async () => {
    const found = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const d = deps({ loginShellAllowed: true, searchPath: null, env: { PATH: '' }, probe: 'login' });
    d.loginShellPath = async () => found;
    const detector = createAgentDetector(d);
    expect((await detector.report('research')).agents[0]).toMatchObject({ state: 'login' });
    expect((await detector.report('recheck', 'claude')).agents[0]).toMatchObject({ state: 'login' });
    expect(detector.detected('claude')!.path.split(':')).toContain(found);
    expect(d.calls.filter((c) => c === 'loginShell')).toHaveLength(0);
  });

  it('refuses to run anything outside the test\'s own folders', async () => {
    const d = deps();
    await expect(d.run('/usr/local/bin/claude', ['--version'], { timeoutMs: 100, maxBytes: 10 })).rejects.toThrow('refused');
  });

  it('reports one row, claude', async () => {
    const report = await createAgentDetector(deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) })).report('cached');
    expect(report.agents.map((a) => a.id)).toEqual(['claude']);
    expect(report.agents[0]).toMatchObject({ name: 'Claude Code', minimum: { cli: '2.1.318', adapter: '0.103.0' }, note: null });
  });

  it('says adapter when the login check could not start it, old when it spoke another ACP version', async () => {
    const searchPath = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    expect((await createAgentDetector(deps({ searchPath, probe: 'failed' })).report('cached')).agents[0]).toMatchObject({ state: 'adapter', command: installAdapter(AGENT_CATALOG[0]!) });
    expect((await createAgentDetector(deps({ searchPath, probe: 'old' })).report('cached')).agents[0]).toMatchObject({ state: 'old', note: null });
  });

  it('refuses a bin link that points outside the adapter package, and a version that is not a number', async () => {
    const outside = fakeInstall({ cli: '2.1.318', adapter: '0.103.0', outside: true });
    expect((await createAgentDetector(deps({ searchPath: outside })).report('cached')).agents[0]).toMatchObject({ state: 'adapter' });
    const noVersion = fakeInstall({ cliOutput: 'no digits here', adapter: '0.103.0' });
    expect((await createAgentDetector(deps({ searchPath: noVersion })).report('cached')).agents[0]).toMatchObject({ state: 'old', cliVersion: null });
  });

  it('compares versions number by number', () => {
    expect(compareVersions('2.1.318', '2.1.40')).toBeGreaterThan(0);
    expect(compareVersions('0.103.0', '0.99.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0);
  });

  it('turns an agent into old with the lockdown note once the watch caught it, the fake too', async () => {
    const d = deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) });
    const detector = createAgentDetector(d);
    const before = await detector.report('cached');
    expect(before.agents[0]).toMatchObject({ state: 'ready' });
    expect(before.fake).toEqual({ id: 'fake', name: 'fake', state: 'ready', cliVersion: null, adapterVersion: null, minimum: null, command: null, note: null });
    detector.markLockedOut('claude');
    detector.markLockedOut('fake');
    const after = await detector.report('cached');
    expect(after.agents[0]).toMatchObject({ state: 'old', note: 'lockdown' });
    expect(after.fake).toMatchObject({ state: 'old', note: 'lockdown' });
    expect(detector.cachedReport()).toEqual(after);
  });

  it('turns a ready agent into login with the Learn-only command when a prompt said so', async () => {
    const detector = createAgentDetector(deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) }));
    expect((await detector.report('cached')).agents[0]).toMatchObject({ state: 'ready' });
    detector.markLogin('claude');
    expect(detector.cachedReport()!.agents[0]).toMatchObject({ state: 'login', command: `CLAUDE_CONFIG_DIR="${path.join(USERDATA, 'Tutor', 'agents', 'claude')}" claude auth login` });
  });

  it('answers cached from memory, shares one detection between simultaneous callers, and never starts one for cachedReport', async () => {
    const d = deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) });
    const detector = createAgentDetector(d);
    expect(detector.cachedReport()).toBeNull();
    expect(d.calls).toEqual([]);
    const [a, b] = await Promise.all([detector.report('cached'), detector.report('recheck', 'claude')]);
    expect(b).toEqual(a);
    expect(d.calls.filter((c) => c === 'run claude')).toHaveLength(1);
    expect(d.calls.filter((c) => c === 'probe')).toHaveLength(1);
    await detector.report('cached');
    expect(d.calls.filter((c) => c === 'run claude')).toHaveLength(1);
    expect(detector.detected('claude')).toMatchObject({ cliVersion: '2.1.318', adapterVersion: '0.103.0' });
  });

  it('rechecks one agent by running it again, probe included', async () => {
    const d = deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) });
    const detector = createAgentDetector(d);
    await detector.report('cached');
    await detector.report('recheck', 'claude');
    expect(d.calls.filter((c) => c === 'run claude')).toHaveLength(2);
    expect(d.calls.filter((c) => c === 'probe')).toHaveLength(2);
  });

  it('reads the login shell\'s PATH only on research, only when allowed and only when something is missing, and searches it', async () => {
    const found = fakeInstall({ cli: '2.1.318', adapter: '0.103.0' });
    const shell = (calls: string[]) => async () => {
      calls.push('loginShell');
      return `/nowhere:${found}`;
    };
    const d = deps({ loginShellAllowed: true, searchPath: null, env: { PATH: '' } });
    d.loginShellPath = shell(d.calls);
    const detector = createAgentDetector(d);
    expect((await detector.report('cached')).agents[0]).toMatchObject({ state: 'missing' });
    expect(d.calls).not.toContain('loginShell');
    expect((await detector.report('research')).agents[0]).toMatchObject({ state: 'ready' });
    expect(d.calls.filter((c) => c === 'loginShell')).toHaveLength(1);

    const refused = deps({ loginShellAllowed: false, searchPath: null, env: { PATH: '' } });
    refused.loginShellPath = shell(refused.calls);
    expect((await createAgentDetector(refused).report('research')).agents[0]).toMatchObject({ state: 'missing' });
    expect(refused.calls).not.toContain('loginShell');

    const complete = deps({ loginShellAllowed: true, searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }) });
    complete.loginShellPath = shell(complete.calls);
    await createAgentDetector(complete).report('research');
    expect(complete.calls).not.toContain('loginShell');
  });

  it('has no fake when the app is packaged', async () => {
    expect((await createAgentDetector(deps({ fakeAvailable: false })).report('cached')).fake).toBeNull();
  });
});

describe('searchDirs', () => {
  it('uses only the search path when there is one, split at ":" with no duplicates', () => {
    expect(searchDirs({ env: { PATH: '/p' }, home: '/h', platform: 'linux', searchPath: '/a:/b::/a' })).toEqual(['/a', '/b']);
  });

  it('drops entries that are not absolute, from the search path, PATH and the login shell alike', () => {
    expect(searchDirs({ env: { PATH: 'bin:/p:.' }, home: '/h', platform: 'linux', searchPath: '' , knownDirs: [] }, '/x:rel')).toEqual([]);
    const dirs = searchDirs({ env: { PATH: 'bin:/p:.' }, home: '/h', platform: 'linux', searchPath: null, knownDirs: [] }, '/x:rel');
    expect(dirs.filter((d) => !d.startsWith('/h/'))).toEqual(['/p', '/x']);
    expect(searchDirs({ env: {}, home: '/h', platform: 'linux', searchPath: '/a:rel' })).toEqual(['/a']);
  });

  it('puts PATH first, then the known folders in the spec\'s order, and leaves the macOS-only ones out on Linux', () => {
    const linux = searchDirs({ env: { PATH: '/usr/bin:/usr/local/bin' }, home: '/h', platform: 'linux', searchPath: null });
    expect(linux).toEqual(['/usr/bin', '/usr/local/bin', '/h/.local/bin', '/h/.claude/local', '/h/.npm-global/bin', '/h/.volta/bin', '/h/.bun/bin', '/h/.asdf/shims', '/h/.local/share/mise/shims']);
    const mac = searchDirs({ env: { PATH: '/usr/bin' }, home: '/h', platform: 'darwin', searchPath: null });
    expect(mac.slice(0, 4)).toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin', '/h/.local/bin']);
    expect(mac).toContain('/h/Library/pnpm');
    expect(linux).not.toContain('/h/Library/pnpm');
    expect(linux).not.toContain('/opt/homebrew/bin');
  });

  it('gives the spec\'s known folders by default, exactly and in order, per platform', () => {
    const home = tempRoot();
    for (const v of ['v20.1.0', 'v22.0.0']) fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', v, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(home, '.local', 'share', 'fnm', 'node-versions', 'v24.0.0', 'installation', 'bin'), { recursive: true });
    const h = (p: string) => path.join(home, p);
    const common = [
      h('.local/bin'), h('.claude/local'), h('.npm-global/bin'), h('.volta/bin'), h('.bun/bin'),
    ];
    const tail = [
      h('.nvm/versions/node/v22.0.0/bin'), h('.nvm/versions/node/v20.1.0/bin'), h('.local/share/fnm/node-versions/v24.0.0/installation/bin'),
      h('.asdf/shims'), h('.local/share/mise/shims'),
    ];
    const env = { PATH: '/usr/bin' };
    expect(searchDirs({ env, home, platform: 'darwin', searchPath: null })).toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin', ...common, h('Library/pnpm'), ...tail]);
    expect(searchDirs({ env, home, platform: 'linux', searchPath: null })).toEqual(['/usr/bin', '/usr/local/bin', ...common, ...tail]);
  });

  it('lists nvm and fnm node versions highest first and appends the login shell\'s PATH last', () => {
    const home = tempRoot();
    for (const v of ['v18.2.0', 'v22.19.0', 'v20.10.1']) fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', v, 'bin'), { recursive: true });
    for (const v of ['v24.1.0', 'v9.0.0']) fs.mkdirSync(path.join(home, '.local', 'share', 'fnm', 'node-versions', v, 'installation', 'bin'), { recursive: true });
    const dirs = searchDirs({ env: { PATH: '' }, home, platform: 'linux', searchPath: null }, '/shell/bin');
    const nvm = dirs.filter((d) => d.includes('/.nvm/')).map((d) => path.basename(path.dirname(d)));
    expect(nvm).toEqual(['v22.19.0', 'v20.10.1', 'v18.2.0']);
    const fnm = dirs.filter((d) => d.includes('/fnm/')).map((d) => path.basename(path.dirname(path.dirname(d))));
    expect(fnm).toEqual(['v24.1.0', 'v9.0.0']);
    expect(dirs.at(-1)).toBe('/shell/bin');
  });
});

describe('run', () => {
  const script = (body: string) => {
    const file = path.join(tempRoot(), 'prog');
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return file;
  };
  it('returns what a program prints and its exit code, without a shell', async () => {
    expect(await run(script('echo 1.2.3; exit 3'), [], { timeoutMs: 5000, maxBytes: 4096 })).toEqual({ stdout: '1.2.3\n', code: 3 });
  });
  it('keeps at most maxBytes of a chatty program', async () => {
    const out = await run(script('yes x | head -c 20000'), [], { timeoutMs: 5000, maxBytes: 4096 });
    expect(out.stdout.length).toBe(4096);
  });
  it('stops a program that outlasts its timeout', async () => {
    const started = Date.now();
    const out = await run(script('exec sleep 30'), [], { timeoutMs: 150, maxBytes: 4096 });
    expect(out.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  it('rejects a program that cannot be started', async () => {
    await expect(run(path.join(tempRoot(), 'missing'), [], { timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow();
  });
  it('runs a version read with the 5 s and 4 KiB caps from the domain', async () => {
    const spy = vi.fn(run);
    const detector = createAgentDetector(deps({ searchPath: fakeInstall({ cli: '2.1.318', adapter: '0.103.0' }), run: spy }));
    await detector.report('cached');
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/claude$/), ['--version'], expect.objectContaining({ timeoutMs: 5000, maxBytes: 4096 }));
  });
});

describe('loginShellPath (다시 찾기 only)', () => {
  const ENV = { SHELL: '/bin/zsh', HOME: HOME, PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-never', LANG: 'C.UTF-8' };
  const answering = (stdout: string, code: number | null = 0) => vi.fn<DetectDeps['run']>(async () => ({ stdout, code }));

  it('asks the login shell for its PATH, without a shell of Learn\'s own, within 3 s and 64 KiB, with the allow-listed environment', async () => {
    const r = answering('/opt/x/bin:/usr/bin');
    expect(await loginShellPath(ENV, HOME, r)).toBe('/opt/x/bin:/usr/bin');
    expect(r).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'printf %s "$PATH"'], { timeoutMs: 3000, maxBytes: 65536, env: { SHELL: '/bin/zsh', HOME, PATH: '/usr/bin', LANG: 'C.UTF-8' }, cwd: HOME });
  });
  it('keeps only the last line: what the profile prints before it is not the PATH', async () => {
    expect(await loginShellPath(ENV, HOME, answering('Welcome!\nmotd line\n/a/bin:/b/bin'))).toBe('/a/bin:/b/bin');
  });
  it('null when there is no shell to ask, it fails, it is cut off, or it prints nothing', async () => {
    const r = answering('/a/bin');
    expect(await loginShellPath({ ...ENV, SHELL: undefined }, HOME, r)).toBeNull();
    expect(await loginShellPath({ ...ENV, SHELL: 'zsh' }, HOME, r)).toBeNull();
    expect(r).not.toHaveBeenCalled();
    expect(await loginShellPath(ENV, HOME, answering('/a/bin', 1))).toBeNull();
    expect(await loginShellPath(ENV, HOME, answering('/a/bin', null))).toBeNull();
    expect(await loginShellPath(ENV, HOME, answering('  \n'))).toBeNull();
    expect(await loginShellPath(ENV, HOME, vi.fn<DetectDeps['run']>(async () => { throw new Error('ENOENT'); }))).toBeNull();
  });
});
