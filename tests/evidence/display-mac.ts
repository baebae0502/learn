// Runs displayplacer (macOS, installed by the workflow's "Display spike" step) for env.json and the demo (display.ts).
import fs from 'node:fs';
import path from 'node:path';
import { tryExec } from './capture';
import { modeArguments, parseDisplayplacerList, pickDemoMode, type DisplayList, type DisplayMode, type DisplayScreen } from './display';

/**
 * The binary the workflow's "Display spike" step installed and the list it saved before the tests (outside
 * evidence-results, which Playwright empties when the run starts).
 */
const listFile = (): string | null => process.env['LEARN_DISPLAYPLACER_LIST'] ?? null;
export const displayplacer = (): string | null => {
  const bin = process.env['LEARN_DISPLAYPLACER'];
  return bin && fs.existsSync(bin) ? bin : null;
};

/** The list the workflow saved before the tests (screens and every mode), for env.json `displayModes`. */
export function savedDisplayModes(): { source: string; screens: DisplayScreen[] } | { source: string; error: string } {
  const file = listFile();
  try {
    if (!file) throw new Error('no list');
    const text = fs.readFileSync(file, 'utf8');
    const list = parseDisplayplacerList(text);
    return list.screens.length ? { source: path.basename(file), screens: list.screens } : { source: path.basename(file), error: text.trim().split('\n')[0] ?? 'empty' };
  } catch {
    return { source: 'none', error: process.platform === 'darwin' ? 'no displayplacer list (the workflow step did not run or failed)' : `not darwin (${process.platform})` };
  }
}

/** `displayplacer list` now (null when it fails). */
export async function listDisplays(bin: string): Promise<DisplayList | null> {
  const r = await tryExec(bin, ['list'], 30_000);
  return r.ok ? parseDisplayplacerList(r.stdout) : null;
}

/** Run displayplacer with arrangement arguments; its error text when it fails. */
export async function placeDisplays(bin: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  const r = await tryExec(bin, args, 30_000);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' ') };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sameMode = (a: DisplayMode | null | undefined, b: DisplayMode | null | undefined) =>
  !!a && !!b && a.width === b.width && a.height === b.height && a.scaling === b.scaling && a.hz === b.hz && a.colorDepth === b.colorDepth;
const mainScreen = (list: DisplayList | null) => list?.screens.find((s) => s.main) ?? list?.screens[0] ?? null;
const currentMode = (screen: DisplayScreen | null) => screen?.modes.find((m) => m.current) ?? null;

/** What env.json records as `displaySwitch` (the demo completes it with the screen Electron sees). */
export interface DisplaySwitch {
  /**
   * switched: the screen took the demo's mode (Electron confirms it); current: it was in that mode already;
   * unavailable: no better mode, or nothing changed; failed: displayplacer refused; skipped: not macOS.
   */
  status: 'switched' | 'current' | 'unavailable' | 'failed' | 'skipped';
  reason?: string;
  screen?: string;
  from?: DisplayMode | null;
  to?: DisplayMode | null;
  error?: string;
  /** The main display as the launched app's Electron reads it (bounds in points, scale factor). */
  electron?: unknown;
  /** After the demo: displayplacer put the screens back as they were (null: nothing to put back). */
  restored?: boolean | null;
  restoreError?: string;
}

/**
 * Before the demo launches: the best mode for the recording (display.ts pickDemoMode) on the main screen, if one is
 * better than the current one. `restore()` puts every screen back as the list found it, so the suites after the demo
 * (mockups, perf, shell, spikes in `all`) measure the runner's own screen. Never throws.
 */
export async function switchDisplayForDemo(): Promise<{ result: DisplaySwitch; restore(): Promise<void> }> {
  const none = async () => {};
  if (process.platform !== 'darwin') return { result: { status: 'skipped', reason: `not darwin (${process.platform})` }, restore: none };
  const bin = displayplacer();
  if (!bin) return { result: { status: 'unavailable', reason: 'displayplacer is not installed (LEARN_DISPLAYPLACER unset or missing)' }, restore: none };
  const before = await listDisplays(bin);
  const screen = mainScreen(before);
  if (!before || !screen) return { result: { status: 'unavailable', reason: 'displayplacer list gave no screen' }, restore: none };
  const from = currentMode(screen);
  const to = pickDemoMode(screen);
  const base = { screen: screen.id, from, to };
  if (!to) return { result: { status: 'unavailable', reason: 'no mode at most 1920 wide that holds 1440 × 900 or is HiDPI', ...base }, restore: none };
  if (sameMode(from, to)) return { result: { status: 'current', ...base }, restore: none };
  const placed = await placeDisplays(bin, modeArguments(screen, to));
  if (!placed.ok) return { result: { status: 'failed', error: placed.error ?? 'displayplacer failed', ...base }, restore: none };
  // AppKit reconfigures the screen asynchronously: wait until displayplacer lists the new mode as current.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !sameMode(currentMode(mainScreen(await listDisplays(bin))), to)) await sleep(500);
  await sleep(1000); // the menu bar, the Dock and the work area settle
  const result: DisplaySwitch = { status: 'switched', ...base, restored: null };
  return {
    result,
    async restore() {
      const back = await placeDisplays(bin, before.restore);
      const end = Date.now() + 10_000;
      let now = currentMode(mainScreen(await listDisplays(bin)));
      while (Date.now() < end && !sameMode(now, from)) {
        await sleep(500);
        now = currentMode(mainScreen(await listDisplays(bin)));
      }
      result.restored = back.ok && sameMode(now, from);
      if (!back.ok) result.restoreError = back.error ?? 'displayplacer failed';
      await sleep(1000);
    },
  };
}
