// Evidence capture helpers. Layout:
//   evidence-results/env.json, baseline.json, …     summaries (JSON)
//   evidence-results/<label>/*.png|*.mov            captures
//   evidence-results/<label>/manifest.json          one entry per capture, paths relative to evidence-results/
// macOS-only captures (screencapture) are recorded as `skipped` on other platforms.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import { ROOT } from '../e2e/helpers';

const execFileP = promisify(execFile);

export const IS_MAC = process.platform === 'darwin';
export const EVIDENCE_ROOT = path.join(ROOT, 'evidence-results');
/** Label of this evidence run (workflow input); everything captured goes under evidence-results/<label>/. */
export const LABEL = /^[A-Za-z0-9._-]{1,64}$/.test(process.env['EVIDENCE_LABEL'] ?? '') ? process.env['EVIDENCE_LABEL']! : 'local';
export const OUT = path.join(EVIDENCE_ROOT, LABEL);

export type EntryKind = 'page' | 'window' | 'fullscreen' | 'recording' | 'data';

export interface ManifestEntry {
  /** Path relative to evidence-results/ (null when skipped or failed). */
  file: string | null;
  kind: EntryKind;
  description: string;
  platform: string;
  bytes?: number;
  skipped?: string;
  error?: string;
  at: string;
}

const MANIFEST = path.join(OUT, 'manifest.json');

function readManifest(): ManifestEntry[] {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as ManifestEntry[];
  } catch {
    return [];
  }
}

/** Append one entry to manifest.json (workers: 1, so a read-modify-write is safe). */
export function record(entry: Omit<ManifestEntry, 'platform' | 'at'>): ManifestEntry {
  fs.mkdirSync(OUT, { recursive: true });
  const full: ManifestEntry = { ...entry, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() };
  if (full.file && full.bytes === undefined) {
    try {
      full.bytes = fs.statSync(path.join(EVIDENCE_ROOT, full.file)).size;
    } catch {
      /* missing file stays without size */
    }
  }
  // A file rewritten later (e.g. baseline.json merged after each test) keeps one, latest entry.
  const all = readManifest().filter((e) => !full.file || e.file !== full.file);
  all.push(full);
  fs.writeFileSync(MANIFEST, `${JSON.stringify(all, null, 2)}\n`);
  return full;
}

/** Absolute path for an output file in evidence-results/<label>/ and its manifest path. */
export function outFile(name: string): { abs: string; rel: string } {
  fs.mkdirSync(OUT, { recursive: true });
  return { abs: path.join(OUT, name), rel: `${LABEL}/${name}` };
}

/** JSON summary at the root of evidence-results/ (env.json, baseline.json, …). */
export function writeJson(name: string, data: unknown, description: string): string {
  fs.mkdirSync(EVIDENCE_ROOT, { recursive: true });
  const file = path.join(EVIDENCE_ROOT, name);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  record({ file: name, kind: 'data', description });
  return file;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Playwright page screenshot (renderer contents only, no OS chrome). Works everywhere. */
export async function pageShot(page: Page, name: string, description: string): Promise<ManifestEntry> {
  const { abs, rel } = outFile(`${name}.page.png`);
  await page.screenshot({ path: abs });
  return record({ file: rel, kind: 'page', description });
}

/** Bring the app to the front so traffic lights render in their active colors. */
export async function focusApp(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: a, BrowserWindow }) => {
    a.focus({ steal: true });
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'));
    w?.show();
    w?.focus();
    w?.moveTop();
  });
  await sleep(400);
}

/** CGWindowID of the main window: getMediaSourceId() is `window:<CGWindowID>:0` on macOS. */
export async function cgWindowId(app: ElectronApplication): Promise<string> {
  const sourceId = await app.evaluate(
    ({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('window=main'))?.getMediaSourceId() ?? '',
  );
  const m = /^window:(\d+):/.exec(sourceId);
  if (!m) throw new Error(`unexpected media source id: ${JSON.stringify(sourceId)}`);
  return m[1]!;
}

async function screencapture(args: string[], file: string): Promise<void> {
  await execFileP('screencapture', [...args, file], { timeout: 30_000 });
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error(`screencapture wrote no file: ${file}`);
}

/**
 * macOS window capture via `screencapture -l<CGWindowID>`: includes title bar and traffic lights. The app is brought to
 * the front first (active colours) unless `focus: false` — an inactive window as it looks behind another app.
 */
export async function nativeWindowShot(app: ElectronApplication, name: string, description: string, opts: { focus?: boolean } = {}): Promise<ManifestEntry> {
  if (!IS_MAC) return record({ file: null, kind: 'window', description, skipped: `screencapture needs darwin (running on ${process.platform})` });
  const { abs, rel } = outFile(`${name}.window.png`);
  try {
    if (opts.focus !== false) await focusApp(app);
    const id = await cgWindowId(app);
    await screencapture(['-x', '-o', `-l${id}`], abs);
    return record({ file: rel, kind: 'window', description: `${description} (CGWindowID ${id})` });
  } catch (e) {
    return record({ file: null, kind: 'window', description, error: String((e as Error).message ?? e) });
  }
}

/** Whole main display via `screencapture -x`: includes the macOS menu bar. */
export async function fullScreenShot(name: string, description: string): Promise<ManifestEntry> {
  if (!IS_MAC) return record({ file: null, kind: 'fullscreen', description, skipped: `screencapture needs darwin (running on ${process.platform})` });
  const { abs, rel } = outFile(`${name}.screen.png`);
  try {
    await screencapture(['-x'], abs);
    return record({ file: rel, kind: 'fullscreen', description });
  } catch (e) {
    return record({ file: null, kind: 'fullscreen', description, error: String((e as Error).message ?? e) });
  }
}

/** page + window + full screen in one call. */
export async function allShots(app: ElectronApplication, page: Page, name: string, description: string): Promise<ManifestEntry[]> {
  const out = [await pageShot(page, name, description)];
  out.push(await nativeWindowShot(app, name, description));
  out.push(await fullScreenShot(name, description));
  return out;
}

export interface Recording {
  file: string | null;
  /** Resolves when screencapture exits (after `seconds`). */
  done: Promise<ManifestEntry>;
}

/**
 * Screen recording with `screencapture -v -V <seconds>` in the background (darwin only).
 * Elsewhere this records a skip; use Playwright `recordVideo` (launch option) as the fallback.
 */
export function startRecording(seconds: number, name: string, description: string): Recording {
  if (!IS_MAC) {
    return { file: null, done: Promise.resolve(record({ file: null, kind: 'recording', description, skipped: `screencapture needs darwin (running on ${process.platform})` })) };
  }
  const { abs: target, rel: file } = outFile(`${name}.mov`);
  let stderr = '';
  const child: ChildProcess = spawn('screencapture', ['-v', '-V', String(seconds), '-x', target], { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const done = new Promise<ManifestEntry>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGINT'), (seconds + 30) * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(record({ file: null, kind: 'recording', description, error: e.message }));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const ok = fs.existsSync(target) && fs.statSync(target).size > 0;
      resolve(
        ok
          ? record({ file, kind: 'recording', description: `${description} (${seconds}s, exit ${code ?? signal})` })
          : record({ file: null, kind: 'recording', description, error: `screencapture exit ${code ?? signal}: ${stderr.trim()}` }),
      );
    });
  });
  return { file, done };
}

export interface Screencast {
  stop(): Promise<ManifestEntry>;
}

/**
 * Renderer-only fallback recording through CDP Page.startScreencast: JPEG frames plus frames.json
 * (timestamps) in evidence-results/<label>/<name>.frames/. Assemble on the server with ffmpeg.
 * Works on every platform. (Playwright `recordVideo` is not usable here: with Playwright 1.64.1 and
 * Electron 44 the first window stays paused before navigation, see docs/mac-verification.md.)
 */
export async function startScreencast(page: Page, name: string, description: string): Promise<Screencast> {
  const { abs: dir, rel } = outFile(`${name}.frames`);
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: Array<{ file: string; timestamp: number | undefined }> = [];
  cdp.on('Page.screencastFrame', (f) => {
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
    frames.push({ file, timestamp: f.metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      const ts = frames.map((f) => f.timestamp).filter((t): t is number => typeof t === 'number');
      const seconds = ts.length > 1 ? ts.at(-1)! - ts[0]! : 0;
      fs.writeFileSync(path.join(dir, 'frames.json'), `${JSON.stringify({ seconds, frames }, null, 2)}\n`);
      return record({
        file: frames.length ? rel : null,
        kind: 'recording',
        description: `${description} (CDP screencast, ${frames.length} frames over ${seconds.toFixed(1)}s)`,
        ...(frames.length ? {} : { error: 'no screencast frames received' }),
      });
    },
  };
}

export interface PlatformFont {
  familyName: string;
  postScriptName?: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/** Fonts Chromium actually used to draw the first node matching `selector` (CDP CSS.getPlatformFontsForNode). */
export async function platformFonts(page: Page, selector: string): Promise<{ selector: string; text: string; cssFontFamily: string; fonts: PlatformFont[] }> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no node for ${selector}`);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    const meta = await page.locator(selector).first().evaluate((el) => ({
      text: (el.textContent ?? '').trim().slice(0, 60),
      cssFontFamily: getComputedStyle(el).fontFamily,
    }));
    return { selector, ...meta, fonts: fonts as PlatformFont[] };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Run a command and capture its output; never throws (evidence records failures instead). */
export async function tryExec(cmd: string, args: string[], timeout = 30_000): Promise<{ ok: boolean; stdout: string; stderr: string; ms: number }> {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString(), ms: Date.now() - t0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message), ms: Date.now() - t0 };
  }
}

/** Names of the menu bar items System Events sees for `processName` (item 2 is the app menu). */
export async function menuBarNames(processName: string) {
  return tryExec('osascript', ['-e', `tell application "System Events" to get name of every menu bar item of menu bar 1 of process "${processName}"`], 20_000);
}

/**
 * The items of menu-bar menu `index` as System Events sees them (what AppKit shows, including items it adds itself),
 * one entry per item; a separator is "-". Null when System Events refuses or fails.
 */
export async function menuItemNames(processName: string, index: number): Promise<string[] | null> {
  const script = [
    'set out to {}',
    'tell application "System Events"',
    `tell process "${processName}"`,
    `repeat with i in (menu items of menu 1 of menu bar item ${index} of menu bar 1)`,
    'set n to name of i',
    'if n is missing value then set n to "-"',
    'set end of out to n',
    'end repeat',
    'end tell',
    'end tell',
    "set AppleScript's text item delimiters to linefeed",
    'return out as text',
  ];
  const r = await tryExec('osascript', script.flatMap((l) => ['-e', l]), 20_000);
  return r.ok ? r.stdout.trim().split('\n') : null;
}

export const pressEscape = () => tryExec('osascript', ['-e', 'tell application "System Events" to key code 53'], 10_000);

/**
 * Open menu bar item `index` of `processName` two ways and capture the screen each time.
 * Run 39443865113 showed that `click` under `ignoring application responses` returned at once but no
 * open menu was captured, so: (a) the plain, blocking AXPress click run in the background, and
 * (b) the keyboard: ⌃F2 focuses the menu bar (Apple menu), → moves to item `index`, ↓ opens it.
 */
export async function captureOpenMenu(app: ElectronApplication, processName: string, index: number, prefix: string, what: string) {
  await focusApp(app);
  const child = spawn('osascript', ['-e', `tell application "System Events" to tell process "${processName}" to click menu bar item ${index} of menu bar 1`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<string>((resolve) => child.on('exit', (code, signal) => resolve(`exit ${code ?? signal}`)));
  await sleep(1500);
  const runningAfterDelay = child.exitCode === null && child.signalCode === null;
  const clickShot = await fullScreenShot(`${prefix}-click`, `${what}: blocking System Events click, captured while it runs`);
  child.kill('SIGTERM');
  // A pending AXPress keeps System Events busy; restart it only on throwaway CI machines.
  const unblock = process.env['CI'] ? await tryExec('killall', ['System Events']) : { ok: false, skipped: 'not CI' };
  await sleep(800);
  await pressEscape();
  await sleep(300);
  const click = {
    shot: clickShot.file,
    osascriptStillRunningAfter1500ms: runningAfterDelay,
    osascript: await Promise.race([exited, sleep(5000).then(() => 'still running')]),
    stderr: stderr.trim(),
    killallSystemEvents: 'skipped' in unblock ? unblock.skipped : unblock.ok,
  };

  await focusApp(app);
  const keys = ['tell application "System Events"', 'key code 120 using control down', 'delay 0.4'];
  for (let i = 1; i < index; i++) keys.push('key code 124', 'delay 0.15');
  keys.push('key code 125', 'end tell');
  const typed = await tryExec('osascript', keys.flatMap((l) => ['-e', l]), 20_000);
  await sleep(1200);
  const keyShot = await fullScreenShot(`${prefix}-keyboard`, `${what}: ⌃F2, → ×${index - 1}, ↓ via System Events`);
  await pressEscape();
  await pressEscape();
  const keyboard = { shot: keyShot.file, ok: typed.ok, stderr: typed.stderr.trim() };
  return { click, keyboard };
}

/** RGB at points of a PNG (device pixels), decoded by the app page's own canvas (no image library needed). */
export async function pngPixels(page: Page, rel: string, points: ReadonlyArray<readonly [number, number]>): Promise<number[][]> {
  const b64 = fs.readFileSync(path.join(EVIDENCE_ROOT, rel)).toString('base64');
  return page.evaluate(async ({ b64, points }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]);
  }, { b64, points });
}

/**
 * Geometric centroid (device px: pixel i covers [i, i + 1), so the centre of pixels 19–30 is 25.0) and size of the
 * pixels in `box` whose RGB satisfies `match` (e.g. the red close button).
 */
export async function pngCentroid(page: Page, rel: string, box: { x: number; y: number; w: number; h: number }, match: 'red' | 'green'): Promise<{ x: number; y: number; n: number; width: number } | null> {
  const b64 = fs.readFileSync(path.join(EVIDENCE_ROOT, rel)).toString('base64');
  return page.evaluate(async ({ b64, box, match }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(box.x, box.y, box.w, box.h).data;
    // Fixed predicates (the page's CSP has no unsafe-eval): macOS close (#ff5f57-ish) and zoom (#28c840-ish) buttons.
    const test = (r: number, g: number, b: number) => (match === 'red' ? r > 200 && g > 60 && g < 130 && b > 50 && b < 120 : r < 120 && g > 150 && b < 120);
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
      const i = (y * box.w + x) * 4;
      if (test(d[i]!, d[i + 1]!, d[i + 2]!)) { sx += x; sy += y; n++; }
    }
    return n ? { x: box.x + sx / n + 0.5, y: box.y + sy / n + 0.5, n, width: img.naturalWidth } : null;
  }, { b64, box, match });
}
