// macOS-only steps of the demo (Task 13 fix round 1: T13-M8, T13-M9, T13-m8). Every one may fail on a runner: the demo
// catches it, writes a note to chapters.json and carries on from a known state (review minor 2). Nothing here runs
// elsewhere.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, osascript } from '../e2e/helpers';
import { tryExec } from './capture';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every Apple Event the demo sends may take this long at most (T13R2-m7): a stuck one must not freeze the picture. */
export const OSASCRIPT_MS = 5000;
const fail = (what: string, r: { stderr: string; stdout: string }) => new Error(`${what}: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? 'failed'}`);

/**
 * T13-M9: a copy of the dev Electron.app named "Learn" (CFBundleName / CFBundleDisplayName), re-signed ad hoc, so the
 * menu bar and the Dock say Learn instead of Electron. The executable keeps its name, so `app.isPackaged` stays false
 * and the demo overlay still runs. The repo has no app icon, so CFBundleIconFile is left alone. Throws on failure.
 */
export async function renamedElectron(dir: string): Promise<string> {
  const exe = createRequire(path.join(ROOT, 'apps/desktop/package.json'))('electron') as string;
  const bundle = path.resolve(exe, '../../..');
  if (!bundle.endsWith('.app')) throw new Error(`not an app bundle: ${path.basename(bundle)}`);
  const copy = path.join(dir, 'Learn.app');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ditto = await tryExec('ditto', [bundle, copy], 180_000);
  if (!ditto.ok) throw fail('ditto', ditto);
  const plist = path.join(copy, 'Contents', 'Info.plist');
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    const set = await tryExec('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Learn`, plist]);
    if (!set.ok) {
      const add = await tryExec('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string Learn`, plist]);
      if (!add.ok) throw fail(`PlistBuddy ${key}`, add);
    }
  }
  const sign = await tryExec('codesign', ['--force', '--deep', '--sign', '-', copy], 300_000);
  if (!sign.ok) throw fail('codesign', sign);
  const executable = path.join(copy, 'Contents', 'MacOS', path.basename(exe));
  if (!fs.existsSync(executable)) throw new Error('no executable in the copy');
  return executable;
}

/**
 * T13-M9 / T13-m7: hides the Dock (autohide) for the demo, so the window gets the screen's height and no badge sits
 * under it. Returns the restore, which puts the setting back and waits for the Dock to settle before the next suite.
 */
export async function hideDock(): Promise<() => Promise<void>> {
  const read = await tryExec('osascript', ['-e', 'tell application "System Events" to get autohide of dock preferences'], OSASCRIPT_MS);
  if (!read.ok) throw fail('Dock autohide (read)', read);
  const was = read.stdout.trim() === 'true';
  const set = async (on: boolean) => {
    const r = await tryExec('osascript', ['-e', `tell application "System Events" to set autohide of dock preferences to ${on}`], OSASCRIPT_MS);
    if (!r.ok) throw fail('Dock autohide (set)', r);
  };
  if (!was) {
    await set(true);
    await sleep(1500); // the Dock slides away and the work area grows
  }
  return async () => {
    if (was) return;
    await set(false);
    await sleep(2000); // the Dock is back and the work area is the one the other suites measured
  };
}

/** Built-in solid desktop pictures, the first one present is used: neutral, so a dark window's edge and shadow show. */
const DESKTOP_PICTURES = ['Stone.png', 'Silver.png', 'Space Gray.png'].map((f) => `/System/Library/Desktop Pictures/Solid Colors/${f}`);

/** What restoring the desktops' pictures can do: put back the ones that had a picture; skip (and say) the others. */
export function restorePlan(was: ReadonlyArray<string | null>): { set: Array<[number, string]>; skipped: number[] } {
  const set: Array<[number, string]> = [];
  const skipped: number[] = [];
  was.forEach((picture, i) => (typeof picture === 'string' && picture.length > 0 && picture !== 'null' ? set.push([i, picture]) : skipped.push(i)));
  return { set, skipped };
}

/** The desktops whose picture did not become `picture` (read back after setting it: macOS may ignore it silently). */
export const unchangedDesktops = (picture: string, readBack: ReadonlyArray<string | null>): number[] => readBack.flatMap((p, i) => (p === picture ? [] : [i]));

/**
 * Critique mac1 n3: a neutral built-in desktop picture behind the demo instead of the runner's black one. Returns the
 * restore, which puts back every desktop's own picture, and notes for what did not go as asked: a desktop whose picture
 * did not change (read back), one with no picture of its own to put back (null / missing value). Throws when it could
 * not set the picture at all (after trying to put back the ones it may have changed).
 */
export async function neutralDesktop(): Promise<{ restore: () => Promise<string[]>; notes: string[] }> {
  const picture = DESKTOP_PICTURES.find((f) => fs.existsSync(f));
  if (!picture) throw new Error('no built-in solid desktop picture found');
  const read = async () => {
    const r = await tryExec('osascript', ['-l', 'JavaScript', '-e', "JSON.stringify(Application('System Events').desktops().map(function (d) { return d.picture(); }))"], OSASCRIPT_MS);
    if (!r.ok) throw fail('desktop picture (read)', r);
    return (JSON.parse(r.stdout.trim()) as Array<string | null>).map((p) => (typeof p === 'string' ? p : null));
  };
  const setEach = async (pairs: Array<[number, string]>) => {
    if (pairs.length === 0) return;
    const lines = pairs.map(([i, p]) => `Application('System Events').desktops()[${i}].picture = ${JSON.stringify(p)};`);
    const r = await tryExec('osascript', ['-l', 'JavaScript', '-e', [...lines, 'true'].join(' ')], OSASCRIPT_MS);
    if (!r.ok) throw fail('desktop picture (set)', r);
  };
  const was = await read();
  const plan = restorePlan(was);
  const restore = async () => {
    await setEach(plan.set);
    return plan.skipped.map((i) => `desktop ${i + 1} had no picture of its own to put back: it keeps the neutral one`);
  };
  try {
    await setEach(was.map((_, i) => [i, picture] as [number, string]));
  } catch (e) {
    await restore().catch(() => {}); // a desktop set before the failure goes back
    throw e;
  }
  const notes = unchangedDesktops(picture, await read().catch(() => was)).map((i) => `desktop ${i + 1}: its picture did not change to ${path.basename(picture)}`);
  return { restore, notes };
}

const jxa = async (script: string | string[], timeout = OSASCRIPT_MS) => {
  const r = await tryExec('osascript', ['-l', 'JavaScript', '-e', Array.isArray(script) ? script.join(' ') : script], timeout);
  if (!r.ok) throw fail('osascript JavaScript', r);
  return JSON.parse(r.stdout.trim()) as Record<string, unknown>;
};

/**
 * Shared by the cursor scripts. `nap` sleeps precisely (NSThread), unlike `delay`, whose overhead stretched a 20-step
 * glide of 420 ms to 0.9–1.4 s (critique mac1 m1). `path` moves along an eased path on a wall-clock schedule at about
 * 120 Hz: each tick puts the cursor where the curve is at that moment, so the travel takes `ms` however long a post
 * takes; then it waits 50 ms (the event queue) and says whether the cursor arrived.
 */
/** How often the cursor scripts post a move while gliding or dragging (Hz). */
export const GLIDE_HZ = 120;

const prelude = (hz: number = GLIDE_HZ) => [
  "ObjC.import('CoreGraphics'); ObjC.import('Foundation');",
  'function loc() { var p = $.CGEventGetLocation($.CGEventCreate(null)); return { x: p.x, y: p.y }; }',
  'function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }',
  'function near(a, b) { return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2; }',
  'function nap(s) { if (s > 0) $.NSThread.sleepForTimeInterval(s); }',
  'function path(from, to, ms, move) {',
  `  var start = Date.now(), tick = 1000 / ${hz}, k = 0;`,
  '  for (;;) {',
  '    var t = Math.min(1, (Date.now() - start) / ms), e = ease(t);',
  '    move({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });',
  '    if (t >= 1) break;',
  // The next tick still ahead (one that slow posts made us miss is skipped): always forward, never a busy loop.
  '    k = Math.max(k + 1, Math.floor((Date.now() - start) / tick) + 1);',
  '    nap((start + k * tick - Date.now()) / 1000);',
  '  }',
  '  nap(0.05);',
  '  return near(loc(), to);',
  '}',
  'function post(type, p) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft)); }',
  'function warp(p) { $.CGWarpMouseCursorPosition(p); }',
];

/**
 * T13-M8: glides the system cursor to a screen point (top-left global points) in one osascript call, posting
 * kCGEventMouseMoved along an eased path in `ms` (prelude path), so the app sees a real pointer move (its hover).
 * `moved` is false when posting was refused (the cursor did not arrive); the cursor then goes the same eased way by
 * warps (`warped`), which needs no permission but sends the app no event. `warpOnly` goes by warps at once, for a
 * run where posting was already refused (no glide spent on the refused path first, round 3 n4).
 */
export async function glideCursor(to: { x: number; y: number }, opts: { ms?: number; warpOnly?: boolean; hz?: number } = {}): Promise<{ moved: boolean; warped: boolean }> {
  const r = await jxa(glideScript(to, opts));
  return { moved: r['moved'] === true, warped: r['warped'] === true };
}

/** The JXA of glideCursor (exported for its unit test, which runs it against a simulated CoreGraphics). */
export function glideScript(to: { x: number; y: number }, opts: { ms?: number; warpOnly?: boolean; hz?: number } = {}): string {
  return [
    ...prelude(opts.hz),
    `var to = { x: ${Math.round(to.x)}, y: ${Math.round(to.y)} }, ms = ${Math.round(opts.ms ?? 420)};`,
    `var moved = ${opts.warpOnly ? 'false' : 'path(loc(), to, ms, function (p) { post($.kCGEventMouseMoved, p); })'};`,
    'var warped = moved ? false : path(loc(), to, ms, warp);',
    'JSON.stringify({ moved: moved, warped: warped });',
  ].join(' ');
}

/** Re-review minor 2: lets the left button go where the cursor is (after a press-drag that failed half-way). */
export async function releaseMouse(): Promise<void> {
  await jxa([...prelude(), 'post($.kCGEventLeftMouseUp, loc());', "JSON.stringify({ ok: true });"]);
}

/**
 * T13-M8: presses at `from`, drags to `to` in `ms` (the same 120 Hz schedule) and releases, with the system cursor
 * (posted mouse-down, dragged, up). The arrival is checked 50 ms after the release, as a glide's is (round 3 n4).
 */
export async function dragCursor(from: { x: number; y: number }, to: { x: number; y: number }, ms = 600): Promise<boolean> {
  return (await jxa(dragScript(from, to, ms)))['moved'] === true;
}

/** The JXA of dragCursor (exported for its unit test). */
export function dragScript(from: { x: number; y: number }, to: { x: number; y: number }, ms = 600): string {
  return [
    ...prelude(),
    `var from = { x: ${Math.round(from.x)}, y: ${Math.round(from.y)} }, to = { x: ${Math.round(to.x)}, y: ${Math.round(to.y)} };`,
    'post($.kCGEventLeftMouseDown, from);',
    'nap(0.08);',
    `path(from, to, ${Math.round(ms)}, function (p) { post($.kCGEventLeftMouseDragged, p); });`,
    'post($.kCGEventLeftMouseUp, to);',
    'nap(0.05);',
    'JSON.stringify({ moved: near(loc(), to) });',
  ].join(' ');
}

/**
 * T13-m8 / T13R2-n6 / critique mac1 m5: a Finder window on `folder` (the demo's own material, the files that were
 * dragged in) in list view at known screen bounds [left, top, right, bottom] (about 680 × 380: every file and the
 * sidebar readable), in front, so "another app in front" shows another app. The folder is passed as an alias (re-review
 * minor 1). `closeFinderWindow` closes it again before Learn comes back.
 */
export function openFinderWindow(folder: string, bounds: readonly [number, number, number, number]): void {
  osascript(
    [
      'tell application "Finder"',
      `make new Finder window to (POSIX file ${JSON.stringify(folder)} as alias)`,
      'set current view of front window to list view',
      `set bounds of front window to {${bounds.map(Math.round).join(', ')}}`,
      'activate',
      'end tell',
    ].join('\n'),
  );
}
export function closeFinderWindow(): void {
  osascript('tell application "Finder" to close front window');
}
