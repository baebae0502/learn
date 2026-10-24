// @demo — a 2–4 minute macOS screen recording of the M3 shell with a chapter list (m3-demo.chapters.txt / .json), a
// caption per chapter on screen, and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the
// server, scripts/record-demo-linux.sh on Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded.
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
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { acceleratorLabel } from '../../packages/domain/src/accelerator';
import { commandById, commandLabel, type CommandId } from '../../packages/domain/src/commands';
import { motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import {
  NativeInputNotPermitted, ROOT, bringAppToFront, closeSheet, drag, dropSource, expectWindow, launch, mainWindow, nativeKeystroke, osascript, osascriptLimits,
  rowAt, rowByTitle, runMenuCommand, stubOpenDialog, type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionSpot, desktopSpot } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, closeFinderWindow, dragCursor, glideCursor, hideDock, neutralDesktop, openFinderWindow, releaseMouse, renamedElectron } from './demo-mac';
import { PDF_FOOTER, READ_TITLE, UNPLAYABLE_TITLE, writeDemoMedia } from './demo-media';
import { RecordingLost, exitedEarly, lossOf, recordingLoss, type RecordingEnd } from './demo-loss';
import { mergeEnv } from './env';

const PACE = IS_MAC || process.env['LEARN_DEMO_PACE'] === '1' ? 1 : 0.1;
/**
 * The macOS recording's fixed length (screencapture -V): longer than any plausible demo (Linux at full pace 152 s in fix
 * round 2; macOS adds the full-screen and Finder chapters and System Events, about 3:10), then trimmed on the server
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
/** The Finder window in front (chapter 13): wide enough for the list view's Name, Size and Kind (critique mac2 n4). */
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
 * 1080 s, step limit 19 min), recomputed for the residual round from Mac run 39913204254:
 * - typically 591 s: the rest of the suite 283 s, the demo 298 s, Playwright's own 9 s;
 * - at worst 1021 s: the rest 283 s, plus 4.5 s for three opaque retakes and 60 s for four JXA handler lookups that
 *   each hit their 15 s limit; the demo at its own limit (560 + 60 s); the afterAll's restores after a timeout
 *   (RESTORE_HOOK_MS, 45 s); and Playwright's 9 s. That leaves 59 s to the globalTimeout.
 * The longer Mac pre-roll and the wait for the drop toast fall inside the demo's own budget.
 */
const DEMO_BUDGET_MS = 560_000;
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
  } else notes.push('the full-screen and Finder-in-front chapters are macOS only: not in this recording');

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
    const glideClick = async (p: Page, kind: WindowKind, target: ReturnType<Page['getByTestId']>) => {
      const box = (await target.boundingBox())!;
      await glide(p, kind, box.x + box.width / 2, box.y + box.height / 2);
      await pause(250);
      await target.click();
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
    const firstRow = rowAt(page, 0);
    const html = page.locator('html');
    const backToLibrary = async () => {
      if (await page.getByTestId('viewer-back').isVisible()) await runMenuCommand(app, 'nav.back');
      await expect(page.getByTestId('library-table')).toBeVisible();
    };
    const canvas = page.getByTestId('pdf-canvas');
    const indicator = page.getByTestId('pdf-page-indicator');

    if (IS_MAC) await bringAppToFront(app);
    await drawFor(page);
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm3-demo', 'M3 shell demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm3-demo', 'M3 shell demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm3-demo', 'M3 shell demo (2–4 min)');
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

    // 2. Files dragged in (a synthetic drag of real files: a Finder drag cannot be scripted): the window becomes the
    //    drop target; holding ⌥ / Alt switches to linking; releasing it switches back. The tag stays until the drop.
    const { w: mainW, h: mainH } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await dropSource(page, media.drop);
    await chapter(`파일을 창으로 끌어 오면 창 전체가 놓을 곳이 됩니다. ${key('Alt')} 키를 누르고 있으면 연결로 바뀝니다. (끌기는 스크립트로 재현합니다)`);
    const overlay = page.getByTestId('drop-overlay');
    await glide(page, 'main', 14, mainH * 0.55); // the pointer comes in from the window's left edge
    await drag(page, 'dragenter', 'source');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    // On the drop overlay, for exactly as long as it is up (mac1 m4): never over the toolbar or the sidebar.
    await scriptedTag('스크립트로 재현');
    await glide(page, 'main', mainW * 0.5, mainH * 0.78); // under the cards, on the overlay's empty part
    await pause(3500);
    await page.keyboard.down('Alt'); // the held ⌥ pill (T13-m1); the drag itself carries the modifier
    await drag(page, 'dragover', 'source', { altKey: true });
    await expect(overlay).toHaveAttribute('data-mode', 'link');
    await pause(3500);
    await page.keyboard.up('Alt');
    await drag(page, 'dragover', 'source');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await pause(1500);

    // 3. Dropped: copies imported (the empty library says it is bringing them in), the result in a toast.
    await chapter('놓으면 사본으로 가져오고, 결과를 알림으로 보여 줍니다.');
    await scriptedTag(null); // with the drop that ends the overlay, never a frame after it (T13R4-n1)
    await drag(page, 'drop', 'source');
    await expect(rows).toHaveCount(media.drop.length);
    await expect(page.getByTestId('import-done')).toBeVisible();
    await park(page, 'main');
    await pause(3500);
    // Critique mac3 m5: the drop's toast closes by itself on camera (5 s from its first frame; what Mac run 2's M1
    // broke), so ⌘O's toast is the only one and the glide below lands on it where it stays.
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });

    // 4. ⌘O, one file: the one F6 and ↩ will open. The file panel is skipped (said in the chapter line and caption).
    //    The pointer goes to the result toast and holds it there (a toast waits while the pointer is on it).
    await stubOpenDialog(app, [media.read], { once: true }); // a late second ⌘O is a cancel: nothing imported twice
    await chapter(`${key('CmdOrCtrl+O')} 키로도 가져올 수 있습니다. (데모에서는 파일 선택 창을 건너뜁니다)`);
    const dialogCalls = () => app.evaluate(() => (globalThis as { __learnOpenDialogCalls?: number }).__learnOpenDialogCalls ?? 0);
    const importedAt = await press('o', ['command'], 'file.importManaged', async () => (await dialogCalls()) > 0);
    await expect(rows).toHaveCount(media.drop.length + 1);
    await expect(firstRow).toHaveAttribute('data-title', READ_TITLE);
    // The ⌘O result (one item), the only toast now: the pointer comes to rest on it and holds it.
    const toast = page.getByTestId('import-done').filter({ hasText: '1개' });
    await expect(toast).toBeVisible();
    const toastBox = (await toast.boundingBox())!;
    await glide(page, 'main', toastBox.x + toastBox.width * 0.7, toastBox.y + toastBox.height / 2);
    await afterKey(importedAt);

    // 5. ⇧F6 from nowhere goes to the last pane, the toast (the focus holds it), then F6 cycles on: 내 라이브러리 (the
    //    accent fill, no ring), the first row (selected as the table takes the focus, its ring); ↩ opens it. A sequence: each stop is read with its pill.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // n1: a reset, not a gesture
    await chapter(`${key('F6')} / ${key('Shift+F6')} 키로 사이드바, 표, 알림 패널 사이를 옮겨 다닙니다.`);
    if (await toast.isVisible()) {
      await page.keyboard.press('Shift+F6');
      await expect.poll(() => inPane(page)).toBe('toasts');
      await park(page, 'main');
      await pause(2500);
    } else notes.push('the ⌘O toast had closed before ⇧F6 reached it');
    await page.keyboard.press('F6');
    await expect(page.getByTestId('nav-library')).toBeFocused();
    await pause(2500);
    await page.keyboard.press('F6');
    await expect(firstRow).toBeFocused();
    await pause(4500);
    const openedAt = await keyIn(page, 'Enter');

    // 6. The PDF reader: page 1, then the next page.
    await chapter('PDF를 열어 다음 쪽으로 넘깁니다.');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await afterKey(openedAt);
    const pageOne = await indicator.textContent();
    await glideClick(page, 'main', page.getByTestId('pdf-next'));
    await park(page, 'main');
    await expect(indicator).not.toHaveText(pageOne ?? '');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await pause(3500);

    // 7. macOS: full screen, where the title strip shows the window title, which follows the view; then back to the
    //    frame. Captioned once the window is in full screen (T13R2-m7). Elsewhere: back to the library.
    /** The library is on screen (⌘1 landed). */
    const inLibrary = () => page.getByTestId('library-table').isVisible();
    /** ⌘1 back to the library, its own chapter, held (Linux; macOS when full screen failed). */
    const backByKey = async () => {
      await chapter(`${key('CmdOrCtrl+1')} 키를 누르면 라이브러리로 돌아갑니다.`);
      const backAt = await press('1', ['command'], 'nav.back', inLibrary);
      await expect(page.getByTestId('library-table')).toBeVisible();
      await afterKey(backAt);
    };
    if (IS_MAC) {
      let revealed = false;
      const title = `${key('Ctrl+Cmd+F')} 키로 전체 화면에 들어가도 위쪽 제목 띠에 지금 보는 화면의 이름이 나옵니다.`;
      const isFull = async () => (await win()).evaluate((w) => w.isFullScreen());
      // The full-screen animation is over when the window's frame is the screen's.
      const fillsScreen = () =>
        app.evaluate(({ BrowserWindow, screen }) => {
          const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=main'));
          if (!w?.isFullScreen()) return false;
          const b = w.getBounds();
          const d = screen.getDisplayMatching(b).bounds;
          return b.x === d.x && b.y === d.y && b.width === d.width && b.height === d.height;
        });
      /** The pointer at the very top edge, held a second, so macOS reveals the menu bar and the title strip. */
      const reveal = async () => {
        await glide(page, 'main', (await page.evaluate(() => innerWidth)) / 2, 0);
        await pause(1000);
      };
      await macStep(
        'full screen',
        async () => {
          const before = await (await win()).evaluate((w) => w.getBounds());
          const enteredAt = await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(true)), isFull);
          await expect.poll(isFull, { timeout: 4000 }).toBe(true);
          await settle('full screen fills the screen', fillsScreen, 3000);
          await chapter(title);
          await reveal(); // the strip says "세포 신호 전달 개요"
          revealed = true;
          await afterKey(enteredAt, 3500);
          await park(page, 'main');
          await pause(1000);
          const backAt = await press('1', ['command'], 'nav.back', inLibrary);
          await expect(page.getByTestId('library-table')).toBeVisible();
          await reveal(); // the strip now says 내 라이브러리
          await afterKey(backAt, 3000);
          await park(page, 'main');
          const leftAt = await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(false)), async () => !(await isFull()));
          await expect.poll(isFull, { timeout: 4000 }).toBe(false);
          await settle('the window is back at its frame', async () => JSON.stringify(await (await win()).evaluate((w) => w.getBounds())) === JSON.stringify(before), 3000);
          await park(page, 'main');
          await afterKey(leftAt);
        },
        async () => {
          // A chapter whose strip was shown stays (it happened); one that never got there goes (round 3 n3).
          if (!revealed) await dropChapter(title);
          if (await isFull()) {
            await (await win()).evaluate((w) => w.setFullScreen(false));
            await expect.poll(isFull, { timeout: 4000 }).toBe(false);
            await sleep(1500);
          }
          await bringAppToFront(app);
          await park(page, 'main');
          // Still in the reader: the Linux chapter instead, ⌘1 back to the library with its hold.
          if (!(await inLibrary())) await backByKey();
        },
      );
      await backToLibrary();
    } else await backByKey();

    // 8. A video this platform cannot play: why, and what to do next; then ⌘1 back, held (T13R2-M1).
    await chapter(`재생할 수 없는 동영상은 이유를 알리고 ‘${label('item.showInFolder')}’와 ‘${label('item.openExternally')}’를 권합니다.`);
    await glideOpen(page, 'main', rowByTitle(page, UNPLAYABLE_TITLE));
    await park(page, 'main');
    await expect(page.getByTestId('video-error')).toBeVisible();
    await pause(2200);
    const revealButton = (await page.getByTestId('codec-reveal').boundingBox())!;
    await glide(page, 'main', revealButton.x + revealButton.width / 2, revealButton.y + revealButton.height / 2); // pointed at, not pressed
    await pause(1600);
    await park(page, 'main');
    await pause(1200);
    const backFromVideoAt = await press('1', ['command'], 'nav.back', inLibrary);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await afterKey(backFromVideoAt);

    // 9. ⌃⌘S folds the sidebar and shows it again; then the boundary dragged wider and back.
    await chapter(`${key('Ctrl+Cmd+S')} 키로 사이드바를 접고, 경계를 끌어 폭을 바꿉니다.`);
    const shell = page.getByTestId('shell');
    // A late ⌃⌘S is seen in the sidebar's state before the menu item toggles it again (round 3 m2).
    const sidebarIs = (state: 'hidden' | 'shown') => async () => (await shell.getAttribute('data-sidebar')) === state;
    const foldedAt = await press('s', ['control', 'command'], 'view.toggleSidebar', sidebarIs('hidden'));
    await expect(shell).toHaveAttribute('data-sidebar', 'hidden');
    await afterKey(foldedAt);
    const unfoldedAt = await press('s', ['control', 'command'], 'view.toggleSidebar', sidebarIs('shown'));
    await expect(shell).toHaveAttribute('data-sidebar', 'shown');
    await afterKey(unfoldedAt);
    const sidebarWidth = () => page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const width0 = await sidebarWidth();
    const sep = (await page.locator('#pane-separator').boundingBox())!;
    const y = Math.round(sep.y + sep.height * 0.5);
    const x0 = Math.round(sep.x + sep.width / 2);
    /** One drag of the separator: the system cursor's own press and drag on macOS, Playwright's mouse elsewhere. */
    const dragSeparator = async (from: number, to: number) => {
      await glide(page, 'main', from, y);
      await pause(250);
      if (cursor === 'system') {
        const o = await originOf('main');
        const dragged = await dragCursor({ x: o.x + from, y: o.y + y }, { x: o.x + to, y: o.y + y }).catch(async () => {
          await releaseMouse().catch(() => {}); // re-review minor 2: never leave the button down
          return false;
        });
        if (dragged) return;
        notes.push('the system cursor could not drag the separator: Playwright drags it');
      }
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 30 });
      await page.mouse.up();
      mouseAt.set(page, { x: to, y });
    };
    await dragSeparator(x0, x0 + 80);
    await expect.poll(sidebarWidth).toBeGreaterThan(width0 + 40);
    await pause(2200);
    await dragSeparator(x0 + 80, x0);
    await expect.poll(sidebarWidth).toBeLessThan(width0 + 10);
    await park(page, 'main');
    await pause(1500);

    // 10. ⌘K: with an empty query the first row has the cursor; 초성 ㅅㅈ finds 설정…, and ↩ runs it.
    await chapter(`${key('CmdOrCtrl+K')} 키로 여는 명령 팔레트는 초성으로도 찾습니다: ㅅㅈ → 설정.`);
    const paletteOpen = () => page.getByTestId('palette').isVisible();
    const paletteAt = await press('k', ['command'], 'app.palette', paletteOpen);
    await expect(page.getByTestId('palette-input')).toBeFocused();
    // Nothing ran from the palette before this chapter, so the empty query lists the registry order (palette.recent is empty).
    const paletteCursor = page.locator('[data-testid="palette-item"][data-focused]');
    await expect(paletteCursor).toHaveAttribute('data-command-id', 'file.importManaged');
    await afterKey(paletteAt);
    for (const ch of ['ㅅ', 'ㅈ']) {
      await page.keyboard.insertText(ch);
      await expect(page.getByTestId('palette-input')).toHaveValue(new RegExp(`${ch}$`));
      await pause(1000);
    }
    await expect(paletteCursor).toHaveAttribute('data-command-id', 'app.settings');
    // No demo title has the run ㅅㅈ (세포 신호 …, 단백질 접힘 …): the 자료 group stays empty and the cursor on 설정….
    await expect(page.getByTestId('palette-result')).toHaveCount(0);
    await pause(2000);
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));
    settingsPages.push(settings);
    await drawFor(settings);

    // 11a. The settings window is a window of its own: the main window behind it is not main, so its chrome dims.
    //      Each settings chapter is captioned in the main window unless the settings window covers its caption box
    //      (then at the top of the settings window, clear of its 라이브러리 위치 card; mac1 m3).
    await chapter('설정은 따로 뜨는 창이고, 뒤의 메인 창은 흐려집니다.', await captionFor(settings));
    if (IS_MAC) await expect(html).toHaveAttribute('data-window-not-main', '');
    else await settle('the main window is not main behind the settings window', async () => (await html.getAttribute('data-window-not-main')) !== null, 3000);
    await park(settings, 'settings');
    await pause(3500);

    // 11b. Density and text size reach the main window at once. The settings window moves aside first, as a user may,
    //      so the list behind it shows the change. Shortened (mac1 n2): density back in one click here; the text size
    //      back with ⌘0 in the dark act, where the main window is key. The move is 12 eased steps over 250 ms on every
    //      platform (T13R2-n2's fallback): AppKit no longer animated setBounds(…, true), a 396 px jump in one frame
    //      (Mac run 2, critique n1).
    await app.evaluate(async ({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const main = all.find((w) => w.webContents.getURL().includes('window=main'))!;
      const set = all.find((w) => w.webContents.getURL().includes('window=settings'))!;
      const m = main.getBounds();
      const b = set.getBounds();
      const to = Math.max(m.x, m.x + m.width - b.width - 24);
      const steps = 12;
      for (let i = 1; i <= steps && !set.isDestroyed(); i++) {
        const t = i / steps;
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        set.setPosition(Math.round(b.x + (to - b.x) * eased), b.y);
        if (i < steps) await new Promise((r) => setTimeout(r, 250 / steps));
      }
    });
    await pause(400); // the move has ended; a moment to see where it went
    await chapter('밀도와 글자 크기는 메인 창에 바로 반영됩니다.', await captionFor(settings));
    await park(settings, 'settings');
    await pause(800);
    for (const [id, attr, value, look] of [
      ['density-compact', 'data-density', 'compact', 2800],
      ['font-size-15', 'data-font-size', '15', 2800],
      ['density-regular', 'data-density', 'regular', 1200],
    ] as const) {
      await glideClick(settings, 'settings', settings.getByTestId(id));
      await park(settings, 'settings'); // off the segment: its "pt" tooltip never opens
      await expect(html).toHaveAttribute(attr, value);
      await pause(look);
    }

    // 11c. The theme changes both windows together.
    await chapter('테마는 두 창이 함께 바뀝니다.', await captionFor(settings, { clicksTiles: true }));
    await glideClick(settings, 'settings', settings.getByTestId('theme-tile-dark'));
    await park(settings, 'settings');
    await expect.poll(() => isDark(page)).toBe(true);
    await expect.poll(() => isDark(settings)).toBe(true);
    await pause(3000);
    await closeSettings(settings);
    if (IS_MAC) await expect(html).not.toHaveAttribute('data-window-not-main', '');
    await park(page, 'main');
    await pause(2500);

    // 12. Dark: the same screens and information — the document (it reopens on page 2, its diagram), the list, the palette.
    //     First ⌘0, the text size of 11b back to 기본 (the main window is key again).
    await chapter('다크 모드에서도 같은 화면, 같은 정보입니다.');
    const resetAt = await press('0', ['command'], 'view.textReset', async () => (await html.getAttribute('data-font-size')) === '13');
    await expect(html).toHaveAttribute('data-font-size', '13');
    await afterKey(resetAt, 1200);
    await glideOpen(page, 'main', rowByTitle(page, READ_TITLE));
    await park(page, 'main');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(indicator).not.toHaveText(pageOne ?? '');
    await pause(3000);
    const darkBackAt = await press('1', ['command'], 'nav.back', inLibrary);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await afterKey(darkBackAt);
    const darkPaletteAt = await press('k', ['command'], 'app.palette', paletteOpen);
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await afterKey(darkPaletteAt);
    const escAt = await keyIn(page, 'Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    await afterKey(escAt);

    // 13. macOS: another app in front — a Finder window on the material that was dragged in — and the Learn window turns
    //     inactive; then back. Captioned once Learn is inactive (T13R2-m7).
    if (IS_MAC) {
      const title = '다른 앱이 앞에 오면 Learn 창은 비활성으로 흐려집니다.';
      let finderOpened = false;
      await macStep(
        'Finder in front',
        async () => {
          const b = await (await win()).evaluate((w) => w.getBounds());
          const d = shownDisplay.bounds;
          // 680 × 380, list view: every file, its size and the sidebar readable, no horizontal scroll bar (mac1 m5;
          // 600 was cramped, Mac run 2 critique n4).
          const left = Math.max(d.x + 20, Math.min(b.x + b.width * 0.45, d.x + d.width - FINDER_W - 20));
          const top = Math.max(d.y + 40, Math.min(b.y + b.height * 0.3, d.y + d.height - 400));
          openFinderWindow(materialDir, [left, top, left + FINDER_W, top + 380]);
          finderOpened = true;
          await expect(html).toHaveAttribute('data-window-inactive', '', { timeout: 5000 });
          await chapter(title);
          if (cursor !== 'synthetic') {
            // The arrow rests on the desktop, off both windows (not on the Finder window's path or status bar).
            await pointerTo('elsewhere');
            await glideCursor(desktopSpot(d, b, { x: left, y: top, width: FINDER_W, height: 380 }), { warpOnly: cursor === 'warp' });
          }
          await pause(4000);
          closeFinderWindow();
          finderOpened = false;
          await bringAppToFront(app);
          await expect(html).not.toHaveAttribute('data-window-inactive', '');
          await park(page, 'main');
          await pause(1500);
        },
        async () => {
          await dropChapter(title);
          if (finderOpened) {
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
    }

    // 14. ⌘/: the shortcut sheet as it is (F6 / ⇧F6 under 앱); ↩ closes it. The caption is read before the sheet comes
    //     (at 1024 × 743 the sheet covers the window's middle, T13R2-m6).
    await chapter(`${key('CmdOrCtrl+/')} 키로 단축키 도움말을 엽니다. ${key('F6')} / ${key('Shift+F6')}도 있습니다.`);
    // Under a sheet the pill takes the bottom-left (demo.css): the pointer rests above the caption meanwhile.
    await glide(page, 'main', 120, (await page.evaluate(() => innerHeight)) - 240);
    await pause(2500);
    const sheetUp = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=sheet')));
    const sheet = await expectWindow(app, 'sheet', () => press('/', ['command'], 'app.shortcuts', sheetUp));
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: 'F6' }).first()).toBeVisible();
    await pause(5000);
    await closeSheet(sheet, 'Enter');

    // 15. The end: the populated library in dark, held. The pointer parks first, so it never crosses the final caption.
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
    const txt = outFile('m3-demo.chapters.txt');
    const json = outFile('m3-demo.chapters.json');
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
    record({ file: txt.rel, kind: 'data', description: 'M3 demo chapter list (m:ss in the recording)' });
    record({ file: json.rel, kind: 'data', description: 'M3 demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M3 demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('m3-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
