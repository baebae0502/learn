// macOS-only steps of the demo (Task 13 fix round 1: T13-M8, T13-M9, T13-m8). Every one may fail on a runner: the demo
// catches it, writes a note to chapters.json and carries on from a known state (review minor 2). Nothing here runs
// elsewhere.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT, osascript } from '../e2e/helpers';
import { tryExec } from './capture';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  const read = await tryExec('osascript', ['-e', 'tell application "System Events" to get autohide of dock preferences'], 20_000);
  if (!read.ok) throw fail('Dock autohide (read)', read);
  const was = read.stdout.trim() === 'true';
  const set = async (on: boolean) => {
    const r = await tryExec('osascript', ['-e', `tell application "System Events" to set autohide of dock preferences to ${on}`], 20_000);
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

const jxa = async (lines: string[], timeout = 20_000) => {
  const r = await tryExec('osascript', ['-l', 'JavaScript', '-e', lines.join(' ')], timeout);
  if (!r.ok) throw fail('osascript JavaScript', r);
  return JSON.parse(r.stdout.trim()) as Record<string, unknown>;
};

const PRELUDE = [
  "ObjC.import('CoreGraphics');",
  'function loc() { var p = $.CGEventGetLocation($.CGEventCreate(null)); return { x: p.x, y: p.y }; }',
  'function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }',
  'function near(a, b) { return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2; }',
];

/**
 * T13-M8: glides the system cursor to a screen point (top-left global points) in one osascript call, posting
 * kCGEventMouseMoved along an eased path, so the app sees a real pointer move (its hover, and the overlay's cursor that
 * follows pointermove). `moved` is false when posting was refused (the cursor did not arrive); the cursor is then
 * warped there (`warped`), which needs no permission but sends the app no event.
 */
export async function glideCursor(to: { x: number; y: number }, ms = 380, steps = 20): Promise<{ moved: boolean; warped: boolean }> {
  const r = await jxa([
    ...PRELUDE,
    `var to = { x: ${Math.round(to.x)}, y: ${Math.round(to.y)} }, from = loc(), n = ${steps};`,
    'for (var i = 1; i <= n; i++) {',
    '  var t = ease(i / n), p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };',
    '  $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft));',
    `  delay(${(ms / steps / 1000).toFixed(4)});`,
    '}',
    'var moved = near(loc(), to), warped = false;',
    'if (!moved) { $.CGWarpMouseCursorPosition(to); warped = near(loc(), to); }',
    'JSON.stringify({ moved: moved, warped: warped });',
  ]);
  return { moved: r['moved'] === true, warped: r['warped'] === true };
}

/** T13-M8: presses at `from`, drags to `to` and releases, with the system cursor (posted mouse-down, dragged, up). */
export async function dragCursor(from: { x: number; y: number }, to: { x: number; y: number }, ms = 600, steps = 30): Promise<boolean> {
  const r = await jxa([
    ...PRELUDE,
    `var from = { x: ${Math.round(from.x)}, y: ${Math.round(from.y)} }, to = { x: ${Math.round(to.x)}, y: ${Math.round(to.y)} }, n = ${steps};`,
    'function post(type, p) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft)); }',
    'post($.kCGEventLeftMouseDown, from);',
    'delay(0.08);',
    'for (var i = 1; i <= n; i++) {',
    '  var t = ease(i / n);',
    '  post($.kCGEventLeftMouseDragged, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });',
    `  delay(${(ms / steps / 1000).toFixed(4)});`,
    '}',
    'post($.kCGEventLeftMouseUp, to);',
    'JSON.stringify({ moved: near(loc(), to) });',
  ]);
  return r['moved'] === true;
}

/**
 * T13-m8: a small Finder window at known screen bounds [left, top, right, bottom], in front, so "another app in front"
 * shows another app. `closeFinderWindow` closes it again before Learn comes back.
 */
export function openFinderWindow(bounds: readonly [number, number, number, number]): void {
  osascript(['tell application "Finder"', 'make new Finder window to (path to home folder)', `set bounds of front window to {${bounds.map(Math.round).join(', ')}}`, 'activate', 'end tell'].join('\n'));
}
export function closeFinderWindow(): void {
  osascript('tell application "Finder" to close front window');
}
