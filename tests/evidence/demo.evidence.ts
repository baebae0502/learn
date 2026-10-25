// @demo — a 2–4 minute macOS screen recording of the M4 library (table, quick search, item panel, palette items, copy
// export) with a chapter list (m4-demo.chapters.txt / .json), a caption per chapter on screen, and the chapters embedded
// in the video afterwards (scripts/finish-demo.sh on the server, scripts/record-demo-linux.sh on Linux). Elsewhere
// (Linux CI) the same script runs at 1/10 pace, unrecorded.
//
// Honest, readable, polished, safe (Task 13 fix rounds 1 and 2):
// - Every synthetic step is said: the drag "스크립트로 재현합니다" (in its caption, and a lasting tag while it is on
//   screen), ⌘O "건너뜁니다" the file panel; in the chapter line and on screen.
// - Real-looking content (demo-media.ts) in a readable library folder. Every state stays up long enough to read: a key
//   whose result is the point keeps 2.5 s on the result after its pill has gone (afterKey); a caption stays as long as
//   it takes to read. The pointer glides to what it clicks, rests on it, and parks clear of the pill, the caption and
//   the toasts.
// - On macOS one pointer: the system cursor moves (posted CGEvents, on a 120 Hz schedule), and the overlay draws only
//   a ring while a button is down (critique mac1 M1); with synthetic input (Linux) the overlay's disc is the pointer.
//   The app is a copy named Learn; the Dock is hidden; a neutral built-in desktop picture is behind it. A Mac-only
//   chapter is captioned only once it has visibly started, and is dropped with a note if it fails; every Apple Event
//   may take 5 s at most, and a core shortcut that times out runs from its menu item instead (round 3 m2).
// - The recording starts 1.5 s before the demo (screencapture warms up on a frozen frame, mac1 m2), runs
//   RECORD_SECONDS and is trimmed to the demo afterwards, with the start offset (negative: the pre-roll) measured here.
//
// Display spike (Task 13): before launching, the demo switches the main screen to the best mode displayplacer lists
// (display.ts) and puts it back afterwards; env.json records displayModes and displaySwitch. That, the Dock and the
// desktop picture change only on a CI runner (HOST_CHANGES, final review m9).
//
// scripts/record-demo-linux.sh records it on Linux too: LEARN_DEMO_PACE=1 (full pace), LEARN_DEMO_SCALE=2
// (--force-device-scale-factor) and LEARN_DEMO_GRAB=<w>x<h>+<x>,<y> (ffmpeg x11grab of exactly the window).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { acceleratorLabel } from '../../packages/domain/src/accelerator';
import { commandById, commandLabel, type CommandId } from '../../packages/domain/src/commands';
import { layout, motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import {
  NativeInputNotPermitted, ROOT, bringAppToFront, closeSheet, drag, dropSource, expectWindow, frontmostProcess, launch, mainWindow, nativeKeystroke, osascript, osascriptLimits,
  rowByTitle, runMenuCommand, seedMetadata, stubSaveDialog, stubShell, type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionSpot, desktopSpot } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, arrangeFinderWindow, closeFinderWindow, dragCursor, glideCursor, hideDock, neutralDesktop, releaseMouse, renamedElectron } from './demo-mac';
import { DEMO_METADATA, PALETTE_TITLE, PDF_FOOTER, READ_TITLE, writeDemoMedia } from './demo-media';
import { RecordingLost, exitedEarly, lossOf, recordingLoss, type RecordingEnd } from './demo-loss';
import { mergeEnv } from './env';

const PACE = IS_MAC || process.env['LEARN_DEMO_PACE'] === '1' ? 1 : 0.1;
/**
 * The macOS recording's fixed length (screencapture -V): longer than any plausible demo (Linux at full pace 142 s with
 * the M4 chapters; macOS adds the Finder chapter and System Events, about 162 s), then trimmed on the server
 * to the demo plus 3 s (scripts/finish-demo.sh, from chapters.json `demoSeconds` and `offset`). A demo that still
 * outran it fails at the end, after its files are written.
 */
const RECORD_SECONDS = 280;
/**
 * The recording starts this long before the demo: its first frames show the painted first screen (mac1 m2).
 * screencapture warmed up on frozen frames for about 1.1 s on the runner: 2.5 s there (Mac risk 2).
 */
/**
 * Before chapter 1. On macOS screencapture shows nothing moving for its first seconds (Mac run 3, critique m2: the file
 * stood still to 3.42 s although the page had started the caption at about 1.6 s), so chapter 1 starts after that;
 * scripts/finish-demo.sh cuts the still head back to 0.5 s and moves the chapters with it.
 */
const PRE_ROLL_MS = IS_MAC ? 4500 : 1500;
/** The Finder window in front (chapter 11): wide enough for the list view's Name, Size and Kind. */
const FINDER_W = 680;
/** One PDF printed by Chromium may take this long; then the rest are fixture copies (re-review Important 1). */
const PRINT_MS = 20_000;
/** The overlay's pill: shown 1.9 s (DemoOverlay PILL_MS), then an exit of 0.75 × --duration-base. */
const PILL_GONE_MS = 1900 + Math.round(motion.base * 0.75);
const SCALE = !IS_MAC && /^[1-4]$/.test(process.env['LEARN_DEMO_SCALE'] ?? '') ? Number(process.env['LEARN_DEMO_SCALE']) : 1;
const GRAB = (() => {
  const m = IS_MAC ? null : /^(\d+)x(\d+)\+(\d+),(\d+)$/.exec(process.env['LEARN_DEMO_GRAB'] ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null;
})();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The platform's add-to-selection modifier for a click (⌘ on macOS, Ctrl elsewhere). */
const MOD = IS_MAC ? 'Meta' : 'Control';
/** The opened PDF's title after the item panel chapter adds to it. */
const EDITED_TITLE = `${READ_TITLE} (4주차)`;

/**
 * One way to take the recording. Mac run 39779536146 lost it: screencapture exited 8 s in, at 1600 × 900 ("capture
 * error"), while the same image recorded 280 s in that mode before (run 39729419115) and 10 s at 1024 × 768 later the
 * same run. So a lost recording stops the attempt at its next step and the demo runs again: once in the same mode,
 * then in the runner's own mode, and last through the main window's CDP screencast, which needs nothing installed
 * (its frames are encoded on the server by scripts/evidence.sh); each only while the demo's budget holds a full run.
 */
interface DemoPlan {
  display: 'switch' | 'native';
  capture: 'screencapture' | 'screencast';
  why: string;
}
/**
 * The display mode, the Dock and the desktop picture are the machine's own settings: the demo changes them only on a
 * throwaway CI runner, as baseline.evidence.ts touches the real home only there (final review m9). On a developer's Mac
 * it records over what is there; the app copy named Learn lives in the run's own folder and is made anywhere.
 */
const HOST_CHANGES = IS_MAC && Boolean(process.env['CI']);
const NOT_CI = 'not a CI runner: the display mode, the Dock and the desktop picture stay as they are';
const PLANS: readonly DemoPlan[] = IS_MAC
  ? [
      { display: 'switch', capture: 'screencapture', why: 'the first attempt' },
      { display: 'switch', capture: 'screencapture', why: 'once more in the same display mode after a lost recording' },
      { display: 'native', capture: 'screencapture', why: "in the runner's own display mode after two lost recordings" },
      { display: 'native', capture: 'screencast', why: 'the main window only (CDP screencast) after three lost recordings' },
    ]
  : [{ display: 'switch', capture: 'screencapture', why: 'the only attempt' }];
/**
 * The demo's whole budget, attempts included. The `all` evidence step (playwright.evidence.config.ts globalTimeout
 * 1440 s, step limit 25 min), recomputed for M4 from the last Mac time of each suite:
 * - typically 884 s: the rest of the suite 578 s (baseline and mockups 39 s, shell and spikes 238 s, perf 170 s,
 *   library 131 s), the demo 297 s, Playwright's own 9 s;
 * - at worst 1410 s: the rest 723 s with a 1.25 runner margin, plus 4.5 s for three opaque retakes and 60 s for four
 *   JXA handler lookups that each hit their 15 s limit, 45 s for the open panel's bounded waits, the demo at its own
 *   limit (463.5 + 60 s), the afterAll's restores after a timeout (RESTORE_HOOK_MS, 45 s) and Playwright's 9 s. That
 *   leaves 30 s to the globalTimeout.
 * The budget is cut from 560 s so the worst case fits the job's 45 minutes (5 set-up, 25 evidence, 15 functional
 * E2E); it still holds one full attempt and a retry of an attempt that ended early. The longer Mac pre-roll and the
 * wait for the drop toast fall inside the demo's own budget.
 */
const DEMO_BUDGET_MS = 463_500;
/** One full attempt: set-up, the fixed-length recording, teardown (Mac run 39779536146: 304 s). */
const FULL_ATTEMPT_MS = 320_000;
/** Set when this attempt's recording ended early (screencapture exited before RECORD_SECONDS). */
let lostRecording: string | null = null;
const stopIfLost = () => {
  if (lostRecording) throw new RecordingLost(lostRecording);
};
/** Time to look at a settled state (not a wait for one: those are expect / waitFor). A lost recording stops here. */
const pause = async (ms: number) => {
  await sleep(ms * PACE);
  stopIfLost();
};

/**
 * What the demo changed on the runner (display mode, Dock, desktop picture) and the app it launched: each undone once,
 * in reverse order, each on its own (one that fails or hangs past RESTORE_MS does not skip the next; re-review m3). The
 * attempt's `finally` runs them, and the file's afterAll runs any left: a test timeout abandons the attempt before its
 * `finally` (re-review m2), and the shell captures after the demo need the runner's own 1024 × 768 mode.
 */
const pendingRestores: Array<{ what: string; run: () => Promise<unknown> }> = [];
const RESTORE_MS = 10_000;
/** The afterAll's own limit: the four restores at their limit, and a margin. */
const RESTORE_HOOK_MS = 45_000;
const onRestore = (what: string, run: () => Promise<unknown>) => void pendingRestores.push({ what, run });
const within = <T>(work: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([work, sleep(ms).then(() => Promise.reject(new Error(`${what}: no answer within ${ms / 1000} s`)))]);
/** Restore runs one at a time: an afterAll that starts while an abandoned attempt's `finally` restores waits for it. */
let restoring: Promise<void> = Promise.resolve();
function runRestores(notes: string[]): Promise<void> {
  const run = restoring.then(async () => {
    for (let r = pendingRestores.pop(); r; r = pendingRestores.pop()) {
      await within(r.run(), RESTORE_MS, `restoring ${r.what}`).catch((e: unknown) => notes.push(`restoring ${r!.what} failed: ${errorText(e)}`));
    }
  });
  restoring = run.catch(() => {});
  return run;
}
test.afterAll(async () => {
  test.setTimeout(RESTORE_HOOK_MS);
  const notes: string[] = [];
  if (pendingRestores.length > 0) notes.push(`${pendingRestores.length} restores left by an attempt that did not finish (a test timeout)`);
  await runRestores(notes);
  if (notes.length > 0) console.warn(`[demo] ${notes.join('; ')}`);
});
/** A recording's stop (or its end) may take this long; then it counts as having left no file. */
const STOP_MS = 30_000;
/**
 * T13R2-m2: after a key whose result is the point (open, close, fold, theme, ⌘O, ⌘1, ⌘K), the result stays on screen
 * 2.5 s once its pill has gone, counted from when the key went out. Stops inside a typed sequence (the 초성 letters,
 * consecutive F6 stops) may be read together with their pill.
 */
const afterKey = (pressedAt: number, result = 2500) => sleep(Math.max(0, pressedAt + (PILL_GONE_MS + result) * PACE - Date.now()));
/** T13R2-m3: a caption stays as long as it takes to read at 12 characters a second, 3.5–6.5 s. */
const captionMs = (text: string) => Math.min(6500, Math.max(3500, Math.round((text.length / 12) * 1000)));
/** A shortcut as this platform's menus write it (⌘O on macOS, Ctrl+O elsewhere). */
const key = (accelerator: string) => acceleratorLabel(accelerator, process.platform);
const label = (id: CommandId) => commandLabel(commandById(id), process.platform);
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Which pane holds the focus (data-pane), or null. */
const inPane = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
const isDark = (page: Page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * The demo's library folder, a path a viewer can read (the settings window shows it): on a CI runner (ephemeral)
 * ~/Learn 라이브러리, never on a developer's machine, where it lives under the temp folder. Never an existing folder.
 */
function libraryFolder(work: string): string {
  const home = path.join(os.homedir(), 'Learn 라이브러리');
  return process.env['CI'] && !fs.existsSync(home) ? home : path.join(work, 'Learn 라이브러리');
}

/**
 * Prints an HTML file to PDF in the launched app: a hidden window loads it, waits for its fonts, and Chromium prints it
 * with the page's own size and margins and a page-number footer. Chromium subsets the font (T13R2-n1). At most
 * PRINT_MS: a print that takes longer throws, and its hidden window is destroyed from here (every window this made is
 * kept in a list for that); one that fails destroys its own.
 */
const printPdfWith = (app: ElectronApplication) => async (htmlFile: string): Promise<Buffer> => {
  const print = app.evaluate(
    async ({ BrowserWindow }, { file, footer }) => {
      const g = globalThis as { __learnDemoPrints?: Electron.BrowserWindow[] };
      const w = new BrowserWindow({ show: false, width: 820, height: 1160, webPreferences: { sandbox: true } });
      (g.__learnDemoPrints ??= []).push(w);
      try {
        await w.loadFile(file);
        await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)', true);
        const pdf = await w.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer });
        return Buffer.from(pdf).toString('base64');
      } finally {
        if (!w.isDestroyed()) w.destroy();
      }
    },
    { file: htmlFile, footer: PDF_FOOTER },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`printing took over ${PRINT_MS / 1000} s`)), PRINT_MS);
  });
  try {
    return Buffer.from(await Promise.race([print, limit]), 'base64');
  } catch (e) {
    void print.catch(() => {}); // it may still settle after the limit
    await app
      .evaluate(() => {
        for (const w of (globalThis as { __learnDemoPrints?: Electron.BrowserWindow[] }).__learnDemoPrints ?? []) if (!w.isDestroyed()) w.destroy();
      })
      .catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

type WindowKind = 'main' | 'settings';
/**
 * How the demo moves the pointer. synthetic: Playwright's mouse, drawn by the overlay as a disc that follows it (Linux;
 * macOS when the system cursor cannot be moved at all). system: macOS, the system cursor through posted CGEvents; the
 * overlay draws only a ring while a button is down, the arrow is the one pointer (T13-M8 a, mac1 M1). warp: macOS when
 * posting is refused: the system cursor is warped along the same path (T13-M8 b), the overlay as for system;
 * Playwright's mouse still gives the hover.
 */
type CursorMode = 'synthetic' | 'system' | 'warp';
/** What the overlay draws for a cursor mode (DemoOverlay PointerMode). */
const overlayMode = (mode: CursorMode) => (mode === 'synthetic' ? 'follow' : 'clicks');

async function demoAttempt(plan: DemoPlan, history: readonly string[]): Promise<{ lost: string | null }> {
  lostRecording = null;
  const work = path.join(os.tmpdir(), 'learn-demo');
  fs.mkdirSync(work, { recursive: true });
  const libraryDir = libraryFolder(work);
  // A local folder left by an interrupted run would start the demo with its items (CI's home folder is never reused).
  if (libraryDir.startsWith(work)) fs.rmSync(libraryDir, { recursive: true, force: true });
  const userData = fs.mkdtempSync(path.join(work, 'userdata-'));
  const materialDir = path.join(work, '자료');
  const notes: string[] = [];
  const input = { native: 0, menu: 0 };
  const chapters: Array<{ at: number; ms: number; title: string }> = [];
  let s: Session | null = null;
  let rec: Recording | null = null;
  /** x11grab recordings end when told; macOS screencapture after RECORD_SECONDS. */
  let stopRec: StoppableRecording['stop'] | null = null;
  let started = Date.now();
  let recordingExitMs: number | null = null;
  /** Linux x11grab: when ffmpeg had opened the screen (macOS: derived from screencapture's exit). */
  let recordingStartMs: number | null = null;
  let demoSeconds = 0;
  /** The demo's last chapter has ended: the recording's remaining seconds are only its tail. */
  let demoEnded = false;
  /** Why this attempt's recording is lost (demo-loss.ts), set in the `finally`. */
  let loss: string | null = null;
  let screen: unknown = null;
  // Widened on purpose: glide() changes it from inside a closure, where narrowing cannot see.
  let cursor = (IS_MAC ? 'system' : 'synthetic') as CursorMode;
  const osascriptBefore = osascriptLimits.timeoutMs;
  if (IS_MAC) osascriptLimits.timeoutMs = OSASCRIPT_MS; // T13R2-m7: a stuck Apple Event may freeze the picture 5 s at most
  /** A macOS-only step: any failure is a note, then `recover` puts a known state back (review minor 2). */
  const macStep = async (what: string, run: () => Promise<void>, recover: () => Promise<void> = async () => {}) => {
    try {
      await run();
    } catch (e) {
      notes.push(`${what}: ${errorText(e)}`);
      await recover().catch((e2: unknown) => notes.push(`${what}: recovering failed: ${errorText(e2)}`));
    }
  };

  const display: { result: DisplaySwitch; restore(): Promise<void> } =
    plan.display === 'switch' && (HOST_CHANGES || !IS_MAC)
      ? await switchDisplayForDemo()
      : { result: { status: 'skipped', reason: IS_MAC && !HOST_CHANGES ? NOT_CI : plan.why }, restore: async () => {} };
  onRestore('the display mode', () => display.restore());
  let launchOptions: LaunchOptions = {
    env: { LEARN_DEMO_OVERLAY: '1' },
    // The page follows the theme pref through nativeTheme, as on a user's Mac (no light emulation; Task 8 M1).
    colorScheme: null,
    ...(SCALE !== 1 ? { args: [`--force-device-scale-factor=${SCALE}`] } : {}),
  };
  if (IS_MAC) {
    if (HOST_CHANGES) {
      await macStep('Dock autohide', async () => {
        onRestore('the Dock', await hideDock());
      });
      await macStep('a neutral desktop picture (the runner\'s own stays)', async () => {
        const desktop = await neutralDesktop();
        onRestore('the desktop picture', async () => notes.push(...(await desktop.restore())));
        notes.push(...desktop.notes);
      });
    } else notes.push(NOT_CI);
    await macStep('the app copy named Learn (the plain Electron binary runs instead)', async () => {
      const executablePath = await renamedElectron(path.join(work, 'app'));
      launchOptions = { ...launchOptions, executablePath, args: [path.join(ROOT, 'apps/desktop')] };
    });
  } else notes.push('the Finder-in-front chapter is macOS only: not in this recording');

  try {
    s = await launch(libraryDir, userData, launchOptions);
    const app = s.app;
    onRestore('the app (closing it)', () => app.close());
    const page = s.page;
    // The study material, printed by Chromium in the launched app before anything is recorded; if printing fails or
    // takes too long, fixture copies under the same names (a note says so; the demo stays the same).
    const media = await writeDemoMedia(materialDir, printPdfWith(app), (text) => notes.push(text));
    // The screen as Electron reads it now (after a display switch: the re-read the spike asks for).
    screen = await app.evaluate(({ BrowserWindow, screen }) => {
      const d = screen.getPrimaryDisplay();
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'));
      return { display: { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }, window: w?.getBounds() ?? null, content: w?.getContentBounds() ?? null };
    });
    const shownDisplay = (screen as { display: { bounds: { x: number; y: number; width: number; height: number } } }).display;
    display.result.electron = shownDisplay;
    if (display.result.status === 'switched') {
      const d = shownDisplay.bounds;
      const to = display.result.to!;
      // displayplacer said yes; the screen the app got is what counts.
      if (d.width !== to.width || d.height !== to.height) {
        const from = display.result.from;
        display.result.status = from && d.width === from.width && d.height === from.height ? 'unavailable' : 'switched';
        display.result.reason = `Electron reads ${d.width}×${d.height} after asking for ${to.width}×${to.height}`;
      }
    }
    if (GRAB) {
      // The recorded region must be the window itself, at @SCALE: no 1 px shrink, no strip of the X root around it.
      const want = { x: GRAB.x / SCALE, y: GRAB.y / SCALE, width: GRAB.width / SCALE, height: GRAB.height / SCALE };
      expect((screen as { window: unknown }).window, 'the window fills the recorded region').toEqual(want);
      expect((screen as { content: unknown }).content, 'the page fills the window (frameless)').toEqual(want);
    }

    // ---- input helpers -------------------------------------------------------------------------------------------
    const settingsPages: Page[] = [];
    /** Screen origin of a window's page (content bounds: CSS px = points at zoom 1). */
    const originOf = (kind: WindowKind) =>
      app.evaluate(({ BrowserWindow }, kind) => {
        const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes(`window=${kind}`));
        if (!w) throw new Error(`no ${kind} window`);
        return w.getContentBounds();
      }, kind);
    const pointerEvent = (p: Page, detail: { hidden?: boolean; mode?: 'follow' | 'clicks' }) =>
      p.isClosed() ? Promise.resolve() : p.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-pointer', { detail })), detail).catch(() => {});
    const drawnCursor = (p: Page, shown: boolean) => pointerEvent(p, { hidden: !shown });
    /** Tells a window's overlay what to draw for the current cursor mode (a disc that follows, or click rings only). */
    const drawFor = (p: Page) => pointerEvent(p, { mode: overlayMode(cursor) });
    /** The cursor mode changed: every window's overlay follows. */
    const switchCursor = async (next: CursorMode) => {
      cursor = next;
      for (const p of [page, ...settingsPages]) await drawFor(p);
    };
    /**
     * One pointer across windows: the window the pointer is in draws it, the one it left does not (each window's overlay
     * keeps its last position, so it would show a second cursor there). 'elsewhere': another app's window (Finder).
     */
    let pointerIn: WindowKind | 'elsewhere' = 'main';
    const pageOf = (kind: WindowKind | 'elsewhere') => (kind === 'main' ? page : kind === 'settings' ? settingsPages.at(-1) : undefined);
    const pointerTo = async (kind: WindowKind | 'elsewhere') => {
      if (kind === pointerIn) return;
      const left = pageOf(pointerIn);
      if (left) await drawnCursor(left, false);
      const entered = pageOf(kind);
      if (entered) await drawnCursor(entered, true);
      pointerIn = kind;
    };
    /** Where Playwright's mouse is in each page (it moves only when told): the start of the next synthetic glide. */
    const mouseAt = new Map<Page, { x: number; y: number }>();
    /**
     * Moves the pointer to (x, y) of a window's page, as the current cursor mode does it: about 420 ms along an eased
     * path (T13R2-m4), Playwright's mouse step by step, or the system cursor in one osascript call.
     */
    const glide = async (p: Page, kind: WindowKind, x: number, y: number) => {
      await pointerTo(kind);
      if (cursor !== 'synthetic') {
        const o = await originOf(kind);
        const to = { x: o.x + x, y: o.y + y };
        const once = () => glideCursor(to, { warpOnly: cursor === 'warp' });
        // A glide that throws (a stuck Apple Event) is tried once more before the mode changes (round 3 m2).
        const r = await once()
          .catch(async (e: unknown) => {
            notes.push(`moving the system cursor failed (${errorText(e)}): tried once more`);
            return once();
          })
          .catch((e: unknown) => {
            notes.push(`moving the system cursor failed again (${errorText(e)}): the drawn cursor only`);
            return { moved: false, warped: false };
          });
        if ((cursor === 'system' && !r.moved) || (cursor === 'warp' && !r.warped)) {
          await switchCursor(r.warped ? 'warp' : 'synthetic');
          notes.push(
            r.warped
              ? 'posting mouse events was refused: the system cursor glides by warps; the overlay still draws click rings only (T13-M8 b)'
              : 'the system cursor could not be moved: the drawn cursor follows Playwright\'s mouse (two pointers may show)',
          );
        }
        if (cursor === 'system') return;
        if (cursor === 'warp') {
          await p.mouse.move(x, y); // the hover only: the system cursor is the pointer
          mouseAt.set(p, { x, y });
          return;
        }
      }
      const from = mouseAt.get(p) ?? { x, y }; // a window's first glide starts where it is going
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps);
        await p.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
        await pause(21);
      }
      mouseAt.set(p, { x, y });
    };
    /** Glides onto the middle of an element, rests on it, presses it (where the pointer already is), and stays a beat. */
    const glideClick = async (p: Page, kind: WindowKind, target: Locator, opts: { modifiers?: Array<'Shift' | 'Meta' | 'Control'>; button?: 'right' } = {}) => {
      const box = (await target.boundingBox())!;
      await glide(p, kind, box.x + box.width / 2, box.y + box.height / 2);
      await pause(250);
      await target.click({ ...(opts.modifiers ? { modifiers: opts.modifiers } : {}), ...(opts.button ? { button: opts.button } : {}) });
      await pause(400);
    };
    /** Glides onto a table row, rests, and double-clicks it: a single click only selects (M4 spec 3.3). */
    const glideOpen = async (p: Page, kind: WindowKind, target: ReturnType<Page['getByTestId']>) => {
      const box = (await target.boundingBox())!;
      await glide(p, kind, box.x + box.width / 2, box.y + box.height / 2);
      await pause(250);
      await target.dblclick();
      await pause(400);
    };
    /**
     * Rests the pointer where it hovers nothing and covers no overlay element (demo.css): the main window's empty
     * sidebar bottom (x 120, 72 from the bottom); the settings window's empty header corner.
     */
    const park = async (p: Page, kind: WindowKind) => {
      const { w, h } = await p.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      if (kind === 'main') await glide(p, kind, 120, h - 72);
      else await glide(p, kind, w - 40, 18);
    };
    /**
     * A caption on a page (an empty text clears it): bottom-left, above the pill band, at most `maxWidth` wide; or at
     * the top (`place`, `top` px down) where the bottom holds the page's own text (the settings window's 라이브러리
     * 위치 card, mac1 m3).
     */
    type Captioned = { target: Page; place?: 'top'; top?: number; maxWidth?: number };
    const caption = ({ target, place, top, maxWidth }: Captioned, text: string) =>
      target.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-caption', { detail })), {
        text,
        ms: text ? captionMs(text) : 1,
        ...(place ? { place } : {}),
        ...(top !== undefined ? { top } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
      });
    let lastCaptioned: Captioned = { target: page };
    /** A chapter starts: its time, and its title as the on-screen caption in the window it is about (T13-m4, R2-m6). */
    const chapter = async (title: string, where: Page | Captioned = page) => {
      stopIfLost();
      const ms = Date.now() - started;
      chapters.push({ at: Math.floor(ms / 1000), ms, title });
      lastCaptioned = 'target' in where ? where : { target: where };
      await caption(lastCaptioned, title);
    };
    /**
     * Where a settings chapter is captioned (mac1 m3, concern 4; demo-geometry.ts): in the main window (it shows a
     * caption while not key) where the settings window leaves its caption box free, else there at a narrower width,
     * left of the settings window; only when even that leaves no room, at the top of the settings window. A chapter
     * that clicks a theme tile (`clicksTiles`) then has it under the tiles, never over 외관 or a tile.
     */
    const captionFor = async (settings: Page, opts: { clicksTiles?: boolean } = {}): Promise<Captioned> => {
      // Its bounds once it is shown: before that it still has the height it was created with (measured, then sized).
      await expect
        .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=settings') && x.isVisible())))
        .toBe(true);
      const [m, w] = await Promise.all([originOf('main'), originOf('settings')]);
      const spot = captionSpot(m, w);
      if (spot.target === 'main') return { target: page, ...(spot.maxWidth !== undefined ? { maxWidth: spot.maxWidth } : {}) };
      notes.push('a settings chapter is captioned in the settings window (it covers the main window\'s caption room)');
      if (!opts.clicksTiles) return { target: settings, place: 'top' };
      const tiles = (await settings.locator('.theme-tiles').boundingBox())!;
      return { target: settings, place: 'top', top: Math.round(tiles.y + tiles.height + 12) };
    };
    /** T13R2-m7: a Mac-only chapter that failed after it was captioned leaves no claim behind. */
    const dropChapter = async (title: string) => {
      if (chapters.at(-1)?.title !== title) return;
      chapters.pop();
      await caption(lastCaptioned, '');
      notes.push(`the chapter "${title}" was dropped`);
    };
    /** The lasting "스크립트로 재현" tag while a scripted gesture is on screen (T13R2-m3). */
    const scriptedTag = (text: string | null) => page.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-tag', { detail })), text);
    /**
     * A shortcut: the real key through System Events on macOS (NSMenu sees it), else the menu item's own click().
     * Returns when the key went out (for afterKey). On macOS (demo-keys.ts): a key System Events refuses, or that runs
     * past its 5 s limit, is a note and the menu item instead, so the run goes on (round 3 m2). `there` is the state
     * the chapter needs: a late key that brought it already is not run again, the menu item runs only while it is not
     * there (never toggling past it), and 2 s after a fallback a key that landed later still and undid it is undone
     * (re-review minor 1).
     */
    const press = async (k: string, modifiers: KeyModifier[], menu: CommandId | (() => Promise<unknown>), there?: () => Promise<boolean>) => {
      const at = Date.now();
      const run = () => (typeof menu === 'function' ? menu() : runMenuCommand(app, menu));
      if (!IS_MAC) {
        input.menu++;
        await run();
        return at;
      }
      const fallback = async () => {
        if (there && (await there().catch(() => false))) return;
        await run();
      };
      const how = await pressKey({
        name: `${modifiers.join('+')}+${k}`,
        native: () => nativeKeystroke(app, k, modifiers),
        fallback,
        ...(there ? { landed: there, settle: { holds: there, restore: fallback } } : {}),
        isNotPermitted: (e) => e instanceof NativeInputNotPermitted,
        note: (text) => notes.push(text),
        sleep: async (ms) => void (await sleep(ms)),
        errorText,
      });
      input[how === 'menu' ? 'menu' : 'native']++;
      return at;
    };
    /** A key in the page (Playwright's, which the renderer keymap and the overlay see); returns when it went out. */
    const keyIn = async (p: Page, k: string) => {
      const at = Date.now();
      await p.keyboard.press(k);
      return at;
    };
    const win = () => mainWindow(app);
    /** Waits until `ok()` holds (a state with no DOM to wait on, such as the window's frame); notes it if it never does. */
    const settle = async (what: string, ok: () => Promise<boolean>, timeout = 10_000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await ok()) return true;
        await sleep(100);
      }
      notes.push(`${what}: not reached within ${timeout} ms`);
      return false;
    };
    /** The settings window, closed as a user does: ⌘W while it is the key window (macOS), else its page closes. */
    const closeSettings = async (settings: Page) => {
      const closed = settings.waitForEvent('close');
      if (IS_MAC) {
        await macStep('⌘W on the settings window', async () => {
          const isKey = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('window=settings') ?? false);
          if (!isKey) throw new Error('the settings window was not the key window');
          osascript('tell application "System Events" to keystroke "w" using command down');
          input.native++;
          if (!(await Promise.race([closed.then(() => true), sleep(5000).then(() => false)]))) throw new Error('it did not close within 5 s');
        });
      }
      if (!settings.isClosed()) {
        input.menu++;
        await settings.close();
      }
      await closed;
    };
    const rows = page.getByTestId('item-row');
    const html = page.locator('html');
    const canvas = page.getByTestId('pdf-canvas');
    const searchInput = page.getByTestId('search-field').getByRole('searchbox');
    const header = (col: string) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
    const widthOf = (target: Locator) => target.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    /** The item panel's width: 0 while it is folded (or not there). */
    const inspectorWidth = () => page.evaluate(() => Math.round(document.querySelector('[data-testid="inspector"]')?.getBoundingClientRect().width ?? 0));
    /** The library is on screen (⌘1 landed). */
    const inLibrary = () => page.getByTestId('library-table').isVisible();
    const paletteOpen = () => page.getByTestId('palette').isVisible();
    const searchFocused = () => searchInput.evaluate((el) => el === document.activeElement).catch(() => false);
    /** A settings window or a sheet is on screen (the settings window may wait hidden beforehand). */
    const windowUp = (kind: 'settings' | 'sheet') => () =>
      app.evaluate(({ BrowserWindow }, kind) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().includes(`window=${kind}`)), kind);
    /** The control of an item panel editor field (the field's own input or the one inside it). */
    const field = (name: string) => page.locator(`[data-testid="editor-field"][data-field="${name}"]`).locator('xpath=descendant-or-self::input').first();
    /** Typing as a person does, a character at a time. */
    const typeSlowly = (text: string) => page.keyboard.type(text, { delay: Math.round(70 * PACE) });
    /** One drag along a line of the main window: the system cursor's own press and drag on macOS, Playwright's mouse elsewhere. */
    const dragAcross = async (from: number, to: number, y: number) => {
      await glide(page, 'main', from, y);
      await pause(250);
      if (cursor === 'system') {
        const o = await originOf('main');
        const dragged = await dragCursor({ x: o.x + from, y: o.y + y }, { x: o.x + to, y: o.y + y }).catch(async () => {
          await releaseMouse().catch(() => {}); // never leave the button down
          return false;
        });
        if (dragged) return;
        notes.push('the system cursor could not drag: Playwright drags instead');
      }
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 30 });
      await page.mouse.up();
      mouseAt.set(page, { x: to, y });
    };
    /**
     * Native popups (the column menu, the item menu) as the camera should see them: on macOS the real menu opens and stays
     * up for a moment, then the script picks the item (its own click(), as stubContextMenu does) and closes the menu — the
     * chapter's caption says the pick is scripted. Elsewhere nothing is drawn and the pick is at once. A popup with no pick
     * waiting closes after 1.5 s: no menu is ever left open on camera.
     */
    await app.evaluate(({ Menu }, show) => {
      interface LiveItem { label: string; enabled: boolean; visible: boolean; click(): void }
      const g = globalThis as { __learnDemoPick?: { label: string; holdMs: number } | null; __learnRealPopup?: Electron.Menu['popup'] };
      g.__learnRealPopup ??= Menu.prototype.popup;
      const real = g.__learnRealPopup;
      Menu.prototype.popup = function popup(this: Electron.Menu, options?: Electron.PopupOptions) {
        const pick = g.__learnDemoPick ?? null;
        g.__learnDemoPick = null;
        const target = pick ? (this.items as unknown as LiveItem[]).find((i) => i.label === pick.label && i.enabled && i.visible) : undefined;
        if (show) real.call(this, options);
        setTimeout(() => {
          target?.click();
          if (show) this.closePopup();
          else options?.callback?.();
        }, show ? (pick?.holdMs ?? 1500) : 0);
      };
    }, IS_MAC);
    /** The item the next native popup picks, after showing itself `holdMs` on macOS. */
    const pickFromNextPopup = (itemLabel: string, holdMs = 2200) =>
      app.evaluate((_electron, p) => void ((globalThis as { __learnDemoPick?: unknown }).__learnDemoPick = p), { label: itemLabel, holdMs: Math.round(holdMs * PACE) });

    if (IS_MAC) await bringAppToFront(app);
    await drawFor(page);
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm4-demo', 'M4 library demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm4-demo', 'M4 library demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm4-demo', 'M4 library demo (2–4 min)');
      const recordingFrom = Date.now();
      if (rec.file) {
        // Not for a skipped one (Linux CI). An exit before the demo has ended is a lost recording, with or without a
        // (partial) file (re-review I1): the demo stops at its next step and runs again.
        void rec.done.then((entry) => {
          recordingExitMs = Date.now();
          lostRecording ??= exitedEarly({ afterSeconds: (recordingExitMs - recordingFrom) / 1000, demoEnded, end: entry });
        });
      }
    }
    // mac1 m2: the recording first shows the painted first screen; the opening caption then gets its whole time. The
    // page must also be drawing again before chapter 1 (one frame's round trip): just after launch the renderer was busy
    // and the first caption painted 1.2 s late (critique mac2 m2; the overlay now also counts from its first paint).
    await sleep(PRE_ROLL_MS);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    started = Date.now();

    // 1. First run: the empty library says how to bring files in.
    await chapter('Learn을 처음 열면 빈 라이브러리가 가져오는 방법을 안내합니다.');
    await expect(page.getByTestId('content').getByRole('button').first()).toBeVisible();
    await pause(4500);

    // 2. Files dragged in and dropped (a synthetic drag of real files: a Finder drag cannot be scripted): the window is the
    //    drop target, the drop imports copies, the result is a toast. The tag stays until the drop.
    const all = [...media.drop, media.read];
    const { w: mainW, h: mainH } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await dropSource(page, all);
    await chapter('자료 파일을 창으로 끌어 놓으면 사본으로 가져옵니다. (끌기는 스크립트로 재현합니다)');
    const overlay = page.getByTestId('drop-overlay');
    await glide(page, 'main', 14, mainH * 0.55); // the pointer comes in from the window's left edge
    await drag(page, 'dragenter', 'source');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await scriptedTag('스크립트로 재현');
    await glide(page, 'main', mainW * 0.5, mainH * 0.78); // under the cards, on the overlay's empty part
    await pause(3000);
    await scriptedTag(null); // with the drop that ends the overlay, never a frame after it
    await drag(page, 'drop', 'source');
    await expect(rows).toHaveCount(all.length);
    await expect(page.getByTestId('import-done')).toBeVisible();
    await park(page, 'main');
    // What a user would type in the item panel, written in now (chapter 3's caption says so): the table's 저자 and 연도.
    const ids = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? Object.fromEntries(r.data.map((i) => [i.title, i.id])) : ({} as Record<string, string>);
    });
    for (const [title, meta] of Object.entries(DEMO_METADATA)) await seedMetadata(page, ids[title]!, meta);
    await expect(rowByTitle(page, PALETTE_TITLE).locator('[data-col="creators"]')).toContainText('Jun Lee');
    await pause(2500);
    // The drop's toast closes by itself on camera, so each later toast is alone.
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });

    // 3. A column header sorts by its column (primary 500 and an arrow): 저자 ascending, again descending, then 연도.
    await chapter('열 머리를 누르면 그 열로 정렬하고, 한 번 더 누르면 순서를 뒤집습니다. (저자·연도는 데모에서 미리 적어 두었습니다)');
    await pause(1200);
    await glideClick(page, 'main', header('creators'));
    await expect(header('creators')).toHaveAttribute('aria-sort', 'ascending');
    await pause(2200);
    await glideClick(page, 'main', header('creators'));
    await expect(header('creators')).toHaveAttribute('aria-sort', 'descending');
    await pause(2200);
    await glideClick(page, 'main', header('year'));
    await expect(header('year')).toHaveAttribute('aria-sort', 'ascending');
    await park(page, 'main');
    await pause(2500);

    // 4. Columns: the header's native menu lists the columns (on macOS the real menu; the pick is scripted) and 크기 comes
    //    in; then a column boundary dragged narrower (the cursor changes, the line stays: design-spec 2.1).
    await chapter('열 머리를 오른쪽 클릭하면 보일 열을 고르고, 경계를 끌어 폭을 바꿉니다. (메뉴 고르기는 스크립트로 재현합니다)');
    await pause(1000);
    await pickFromNextPopup('크기');
    await glideClick(page, 'main', header('title'), { button: 'right' });
    await expect(header('size')).toBeVisible();
    await park(page, 'main');
    await pause(2000);
    const creatorsWidth = await widthOf(header('creators'));
    const resizer = (await page.locator('[data-testid="column-resizer"][data-col="creators"]').boundingBox())!;
    const rx = Math.round(resizer.x + resizer.width / 2);
    // Leftward: 연도 is the next column and has only 8 px above its minimum, so a drag to the right would barely move.
    await dragAcross(rx, rx - 60, Math.round(resizer.y + resizer.height / 2));
    await expect.poll(() => widthOf(header('creators'))).toBeLessThan(creatorsWidth - 30);
    await park(page, 'main');
    await pause(2200);

    // 5. Several items: a click, a ⇧-click range, a ⌘-click one more; the item panel sums them up. A window too narrow
    //    for the item panel beside the sidebar (the runner's own 1024 mode) shows it with ⌥⌘I first.
    const roomy = (await inspectorWidth()) > 0;
    await chapter(`${key('Shift')} 클릭으로 범위를, ${key('CmdOrCtrl')} 클릭으로 하나씩 더 고릅니다. 항목 패널이 고른 자료를 요약합니다.`);
    if (!roomy) {
      notes.push('the window has no room for the item panel beside the sidebar: ⌥⌘I shows it, and the narrow-window chapter is left out');
      const shownAt = await press('i', ['option', 'command'], 'view.toggleInspector', async () => (await inspectorWidth()) > 0);
      await expect.poll(inspectorWidth).toBeGreaterThan(0);
      await afterKey(shownAt, 1000);
    }
    await glideClick(page, 'main', rows.nth(0));
    await expect(page.getByTestId('inspector-head')).toBeVisible();
    await pause(1500);
    await glideClick(page, 'main', rows.nth(2), { modifiers: ['Shift'] });
    await pause(1200);
    await glideClick(page, 'main', rows.nth(5), { modifiers: [MOD] });
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await park(page, 'main');
    await pause(4000);

    // 6. ⌘F: the quick search; 초성 ㅅㅍ finds 세포 (the match marked in the title), "1개 / 9개".
    await chapter(`${key('CmdOrCtrl+F')} 키로 빠른 검색에 들어갑니다. 초성으로도 찾습니다: ㅅㅍ → 세포.`);
    const findAt = await press('f', ['command'], 'library.find', searchFocused);
    await expect(searchInput).toBeFocused();
    await afterKey(findAt, 800);
    for (const ch of ['ㅅ', 'ㅍ']) {
      await page.keyboard.insertText(ch);
      await expect(searchInput).toHaveValue(new RegExp(`${ch}$`));
      await pause(1000);
    }
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('toolbar-count')).toHaveText(`1개 / ${all.length}개`);
    await pause(2000);
    await glideClick(page, 'main', rows.first());
    await expect(page.getByTestId('inspector-head')).toContainText(READ_TITLE);
    await park(page, 'main');
    await pause(2500);

    // 7. The item panel's form: the title and the publisher, saved; the table and the panel follow (libraryChanged).
    await chapter('항목 패널에서 정보를 바로 고칩니다. 저장하면 표에도 반영됩니다.');
    await pause(1000);
    await glideClick(page, 'main', page.getByTestId('info-edit'));
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await pause(1200);
    await glideClick(page, 'main', field('title'));
    await field('title').press('End');
    await typeSlowly(' (4주차)');
    await pause(800);
    await glideClick(page, 'main', field('publisher'));
    await typeSlowly('세포생물학 강의');
    await pause(1000);
    await glideClick(page, 'main', page.getByTestId('editor-save'));
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    await expect(rowByTitle(page, EDITED_TITLE)).toBeVisible();
    await expect(page.locator('[data-testid="info-row"][data-field="publisher"]')).toContainText('세포생물학 강의');
    await park(page, 'main');
    await pause(3500);

    // 8. ⌘K finds items too (the 자료 group above the commands); ↩ opens the first. The quick search is cleared first, so
    //    the table shows everything again.
    await glideClick(page, 'main', page.getByTestId('search-field-clear'));
    await expect(rows).toHaveCount(all.length);
    await chapter(`${key('CmdOrCtrl+K')} 팔레트에서도 자료를 찾아 바로 엽니다.`);
    const paletteAt = await press('k', ['command'], 'app.palette', paletteOpen);
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await afterKey(paletteAt, 800);
    for (const ch of 'bayes') {
      await page.keyboard.insertText(ch);
      await pause(220);
    }
    await expect(page.getByTestId('palette-result').first()).toHaveAttribute('data-item-id', ids[PALETTE_TITLE]!);
    await pause(2500);
    const openedAt = await keyIn(page, 'Enter');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await afterKey(openedAt);

    // 9. ⌘1 back: the table as it was left — its sort and its columns.
    await chapter(`${key('CmdOrCtrl+1')} 키로 라이브러리로 돌아갑니다. 정렬과 열은 그대로입니다.`);
    const backAt = await press('1', ['command'], 'nav.back', inLibrary);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(header('year')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header('size')).toBeVisible();
    await afterKey(backAt, 3000);

    // 10. 사본 내보내기…: a right-click selects the row first; the item menu (real on macOS, the pick scripted) exports a
    //     copy through the save panel (skipped, and said); the toast offers Finder에서 보기, which the pointer rests on.
    const exportDir = path.join(work, '내보낸 사본');
    fs.rmSync(exportDir, { recursive: true, force: true });
    fs.mkdirSync(exportDir, { recursive: true });
    const exportFile = path.join(exportDir, `${PALETTE_TITLE}.pdf`);
    await stubSaveDialog(app, exportFile);
    if (!IS_MAC) await stubShell(app); // no file manager on Linux: the reveal is only recorded
    await chapter(`‘${label('item.exportCopy')}’로 자료의 사본을 원하는 곳에 저장합니다. (메뉴 고르기와 저장 창은 스크립트로 재현합니다)`);
    await pause(1000);
    await pickFromNextPopup(label('item.exportCopy'));
    await glideClick(page, 'main', rowByTitle(page, PALETTE_TITLE), { button: 'right' });
    await expect(rowByTitle(page, PALETTE_TITLE)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => fs.existsSync(exportFile)).toBe(true);
    const reveal = page.locator('[data-pane="toasts"]').getByRole('button', { name: /에서 보기$/ });
    await expect(reveal).toBeVisible();
    const revealBox = (await reveal.boundingBox())!;
    await glide(page, 'main', revealBox.x + revealBox.width / 2, revealBox.y + revealBox.height / 2); // the toast waits while pointed at
    await pause(2500);

    // 11. macOS: Finder에서 보기 brings Finder to the front on the exported copy, and the Learn window turns inactive; then
    //     back. Captioned once Learn is inactive; dropped with a note if it fails.
    if (IS_MAC) {
      const title = `‘${label('item.showInFolder')}’를 누르면 Finder가 앞에 오고, Learn 창은 비활성으로 흐려집니다.`;
      let finderInFront = false;
      await macStep(
        'Finder in front',
        async () => {
          await glideClick(page, 'main', reveal);
          await expect.poll(() => frontmostProcess().name, { timeout: 5000 }).toBe('Finder');
          finderInFront = true;
          await expect(html).toHaveAttribute('data-window-inactive', '', { timeout: 5000 });
          const b = await (await win()).evaluate((w) => w.getBounds());
          const d = shownDisplay.bounds;
          // 680 × 380, list view: the files, their sizes and the sidebar readable, no horizontal scroll bar.
          const left = Math.max(d.x + 20, Math.min(b.x + b.width * 0.45, d.x + d.width - FINDER_W - 20));
          const top = Math.max(d.y + 40, Math.min(b.y + b.height * 0.3, d.y + d.height - 400));
          arrangeFinderWindow([left, top, left + FINDER_W, top + 380]);
          await chapter(title);
          if (cursor !== 'synthetic') {
            // The arrow rests on the desktop, off both windows.
            await pointerTo('elsewhere');
            await glideCursor(desktopSpot(d, b, { x: left, y: top, width: FINDER_W, height: 380 }), { warpOnly: cursor === 'warp' });
          }
          await pause(4000);
          closeFinderWindow();
          finderInFront = false;
          await bringAppToFront(app);
          await expect(html).not.toHaveAttribute('data-window-inactive', '');
          await park(page, 'main');
          await pause(1500);
        },
        async () => {
          await dropChapter(title);
          if (finderInFront) {
            try {
              closeFinderWindow();
            } catch {
              /* it may have closed already */
            }
          }
          await bringAppToFront(app);
          await park(page, 'main');
        },
      );
    } else await park(page, 'main');

    // 12. A narrow window: the item panel folds first, so the table keeps its room (CONTENT_MIN); wide again, it is back.
    //     The window's minimum (960) folds only the item panel: the sidebar's fold (200 % zoom) is the E2E's.
    if (roomy) {
      await chapter('창이 좁아지면 표 자리를 지키려고 항목 패널이 먼저 접힙니다. 넓히면 다시 나옵니다.');
      await pause(1500);
      const wide = await (await win()).evaluate((w) => w.getBounds());
      /** The main window's width eased from `from` to `to` in 16 steps over 600 ms (AppKit does not animate setBounds). */
      const resize = (from: number, to: number) =>
        app.evaluate(
          async ({ BrowserWindow }, { from, to }) => {
            const main = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=main'))!;
            const b = main.getBounds();
            const steps = 16;
            for (let i = 1; i <= steps; i++) {
              const t = i / steps;
              const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
              main.setBounds({ ...b, width: Math.round(from + (to - from) * eased) });
              if (i < steps) await new Promise((r) => setTimeout(r, 600 / steps));
            }
          },
          { from, to },
        );
      await resize(wide.width, layout.windowMinWidth);
      await expect.poll(inspectorWidth).toBe(0);
      await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
      await pause(3500);
      await resize(layout.windowMinWidth, wide.width);
      await (await win()).evaluate((w, b) => w.setBounds(b), wide);
      await expect.poll(inspectorWidth).toBeGreaterThan(0);
      await park(page, 'main');
      await pause(2000);
    }

    // 13. ⌘, the settings window; a theme tile changes both windows in the same moment (spec 8 row 2). Captioned where
    //     the settings window leaves room, under its tiles otherwise (demo-geometry.ts).
    const settings = await expectWindow(app, 'settings', () => press(',', ['command'], 'app.settings', windowUp('settings')));
    settingsPages.push(settings);
    await drawFor(settings);
    await chapter(`${key('CmdOrCtrl+,')} 설정 창에서 테마를 바꾸면 두 창이 같은 순간에 바뀝니다.`, await captionFor(settings, { clicksTiles: true }));
    await park(settings, 'settings');
    await pause(2500);
    await glideClick(settings, 'settings', settings.getByTestId('theme-tile-dark'));
    await park(settings, 'settings');
    await expect.poll(() => isDark(page)).toBe(true);
    await expect.poll(() => isDark(settings)).toBe(true);
    await pause(3000);
    await closeSettings(settings);
    await park(page, 'main');
    await pause(2000);

    // 14. Dark: the same screens and information — one item in the item panel, then two.
    await chapter('다크 모드에서도 같은 화면, 같은 정보입니다.');
    await pause(1000);
    await glideClick(page, 'main', rowByTitle(page, EDITED_TITLE));
    await expect(page.getByTestId('inspector-head')).toContainText(EDITED_TITLE);
    await pause(2500);
    await glideClick(page, 'main', rowByTitle(page, '광합성 명반응과 암반응'), { modifiers: [MOD] });
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await park(page, 'main');
    await pause(3000);

    // 15. ⌘/: the shortcut sheet, now with the table's shortcuts (the 자료 group); ↩ closes it. The caption is read
    //     before the sheet comes (a sheet covers the window's middle).
    await chapter(`${key('CmdOrCtrl+/')} 키로 단축키 도움말을 엽니다. ${key('CmdOrCtrl+F')} 빠른 검색과 ${key('Shift+CmdOrCtrl+R')} ‘${label('item.showInFolder')}’도 들어 있습니다.`);
    // Under a sheet the pill takes the bottom-left (demo.css): the pointer rests above the caption meanwhile.
    await glide(page, 'main', 120, (await page.evaluate(() => innerHeight)) - 240);
    await pause(2500);
    const sheet = await expectWindow(app, 'sheet', () => press('/', ['command'], 'app.shortcuts', windowUp('sheet')));
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: label('item.showInFolder') }).first()).toBeVisible();
    await pause(5000);
    await closeSheet(sheet, 'Enter');

    // 16. The end: the library in dark, held. The pointer parks first, so it never crosses the final caption.
    await park(page, 'main');
    await chapter('Learn 둘러보기를 마칩니다.');
    await pause(3000);

    demoSeconds = Math.round((Date.now() - started) / 100) / 10;
    stopIfLost(); // an exit that came during the last pause
    demoEnded = true;
    if (!stopRec && rec?.file) {
      // screencapture -V stops by itself; finish-demo.sh trims the rest away. A recording lost meanwhile ends the wait.
      const left = RECORD_SECONDS - (Date.now() - started) / 1000;
      if (left > 0) await Promise.race([rec.done, sleep(left * 1000 + 1000)]);
      if (lostRecording) await sleep(100); // the exit handler has run
      stopIfLost();
    } else await pause(2000); // the tail of an x11grab recording or a screencast
  } catch (e) {
    // A loss that made a step fail before the next check is still a loss (re-review m1): the exit handler gets a moment.
    if (!(e instanceof RecordingLost) && !lostRecording && rec?.file) await Promise.race([rec.done.then(() => sleep(50)), sleep(1000)]);
    const lost = lossOf(e, lostRecording);
    if (lost === null) throw e;
    lostRecording = lost;
    notes.push(`attempt (${plan.why}): ${lost}; the demo stopped there`);
  } finally {
    // A recording that has not ended by itself stops now, not at RECORD_SECONDS; any stop is bounded (re-review m3).
    if (!demoEnded) rec?.cancel?.();
    const entry: RecordingEnd | null = await within<RecordingEnd | null>(stopRec ? stopRec() : rec ? rec.done : Promise.resolve(null), STOP_MS, 'stopping the recording').catch(
      (e: unknown) => ({ file: null, error: errorText(e) }),
    );
    loss = recordingLoss({ capture: GRAB ? 'x11grab' : plan.capture, end: entry, early: lostRecording });
    await runRestores(notes);
    osascriptLimits.timeoutMs = osascriptBefore;
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(libraryDir, { recursive: true, force: true });
    fs.rmSync(path.join(work, '내보낸 사본'), { recursive: true, force: true }); // chapter 10's exported copy
    fs.rmSync(path.join(work, 'app'), { recursive: true, force: true }); // the macOS app copy (re-review minor 5)
    // macOS: the recording began when screencapture's first frame did, RECORD_SECONDS before it exited (T13-m9); Linux:
    // when ffmpeg had opened the screen. Negative: the recording started before the chapters' zero (the pre-roll).
    const offset =
      recordingExitMs !== null
        ? Math.round(((recordingExitMs - started) / 1000 - RECORD_SECONDS) * 10) / 10
        : recordingStartMs !== null
          ? Math.round(((recordingStartMs - started) / 1000) * 10) / 10
          : 0;
    const inVideo = (c: { ms: number }) => Math.max(0, Math.floor(c.ms / 1000 - offset));
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const txt = outFile('m4-demo.chapters.txt');
    const json = outFile('m4-demo.chapters.json');
    fs.writeFileSync(txt.abs, chapters.map((c) => `${mmss(inVideo(c))} ${c.title}`).join('\n') + '\n');
    fs.writeFileSync(
      json.abs,
      `${JSON.stringify(
        {
          recording: loss ? null : (entry?.file ?? null),
          recordingError: entry?.error ?? entry?.skipped ?? null,
          /** Why this attempt's recording is lost (then it retries, or the test fails); a partial file stays aside. */
          recordingLost: loss,
          ...(loss && entry?.file ? { partialRecording: entry.file } : {}),
          recordSeconds: IS_MAC ? RECORD_SECONDS : null,
          demoSeconds,
          /** Seconds from the chapters' zero to the recording's first frame: a chapter is at `ms / 1000 − offset` in the video. */
          offset,
          recordingExitSeconds: recordingExitMs !== null ? Math.round((recordingExitMs - started) / 100) / 10 : null,
          truncated: IS_MAC && entry?.file ? demoSeconds > RECORD_SECONDS : false,
          pace: PACE,
          scale: SCALE,
          grab: GRAB,
          platform: `${process.platform}-${process.arch}`,
          input,
          cursor,
          screen,
          displaySwitch: display.result,
          attempt: plan,
          notes: [...history, ...notes],
          chapters,
        },
        null,
        2,
      )}\n`,
    );
    record({ file: txt.rel, kind: 'data', description: 'M4 demo chapter list (m:ss in the recording)' });
    record({ file: json.rel, kind: 'data', description: 'M4 demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M4 demo recording with chapters', { tag: '@demo' }, async () => {
  test.setTimeout(DEMO_BUDGET_MS + 60_000);
  const began = Date.now();
  const history: string[] = [];
  for (const [i, plan] of PLANS.entries()) {
    const { lost } = await demoAttempt(plan, history);
    if (!lost) return;
    history.push(`attempt ${i + 1} (${plan.why}; ${plan.display === 'switch' ? 'switched display' : "runner's display"}, ${plan.capture}): ${lost}`);
    const left = DEMO_BUDGET_MS - (Date.now() - began);
    if (i + 1 < PLANS.length && left < FULL_ATTEMPT_MS) {
      history.push(`no attempt ${i + 2}: ${Math.round(left / 1000)} s of the demo's budget left, a full run takes ${FULL_ATTEMPT_MS / 1000} s`);
      break;
    }
  }
  // Every attempt lost its recording: the last attempt's chapters.json carries the history; the run reports it.
  const json = outFile('m4-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
