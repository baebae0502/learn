// @demo — a 2–4 minute macOS screen recording of the M5 organise work (collections and sub-collections, dragging rows into
// them, moving with undo, colour tags and the 1–8 keys, the tag filter, importing into a collection, the palette's
// collections, deleting with undo) with a chapter list (m5-demo.chapters.raw.txt / .json; the trimmed video's own list comes from finish-demo.sh), a caption per chapter on screen, and the chapters embedded
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
import { motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import { MOVE_KEY, finderDrag } from '../e2e/dnd-helpers';
import {
  NativeInputNotPermitted, ROOT, assignTag, bringAppToFront, closeSheet, createTag, drag, dropSource, expectWindow, launch, nativeKeystroke, organizeSnapshot, osascript,
  osascriptLimits, rowByTitle, runMenuCommand, seedMetadata, stubConfirm, type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionSpot } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, glideCursor, hideDock, neutralDesktop, renamedElectron } from './demo-mac';
import { DEMO_METADATA, DEMO_ORGANIZE, PALETTE_TITLE, PDF_FOOTER, READ_TITLE, writeDemoMedia } from './demo-media';
import { RecordingLost, exitedEarly, lossOf, recordingLoss, type RecordingEnd } from './demo-loss';
import { mergeEnv } from './env';

const PACE = IS_MAC || process.env['LEARN_DEMO_PACE'] === '1' ? 1 : 0.1;
/**
 * The macOS recording's fixed length (screencapture -V): longer than any plausible demo (Linux at full pace 187 s with
 * the M5 chapters; macOS adds System Events, about 197 s, and 1.5 times that is kept), then trimmed on the server
 * to the demo plus 3 s (scripts/finish-demo.sh, from chapters.json `demoSeconds` and `offset`). A demo that still
 * outran it fails at the end, after its files are written.
 */
const RECORD_SECONDS = 300;
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
/** The platform's move modifier for a drop (⌘ on macOS, Shift elsewhere: React Aria's own choice) and how a caption names it. */
const MOVE_LABEL = IS_MAC ? '⌘' : 'Shift';
const PARENT = DEMO_ORGANIZE.parent;
const CHILD = DEMO_ORGANIZE.child;

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
 * 1620 s, step limit 28 min), recomputed for M5 from the last Mac time of each suite (run ids in the commit message):
 * - typically 805 s: the rest of the suite 499 s (baseline and mockups 34 s, shell and spikes 207 s, library 57 s,
 *   perf and organise perf 117 s, organize 84 s), the demo 297 s (M4's, until M5's own run), Playwright's own 9 s;
 * - at worst 1548 s: the rest with a 1.25 runner margin (624 s), plus 64.5 s for the opaque retakes and JXA lookups at
 *   their limits, 45 s for the open panel's bounded waits, 120 s for the organize suite's System Events and captures at
 *   their 15 s limits, the demo at its own limit (580 + 60 s), the afterAll's restores after a timeout (45 s) and
 *   Playwright's 9 s. That leaves 72 s to the globalTimeout.
 * For M5 the budget is one full attempt and a retry of an attempt that ended early (FULL_ATTEMPT_MS + 240 s): when the
 * worst case outgrows the evidence step, the step's limit is raised rather than the budget cut (the runner's minutes
 * are free). The longer Mac pre-roll and the wait for the drop toast fall inside the demo's own budget.
 */
const DEMO_BUDGET_MS = 580_000;
/** One full attempt: set-up, the fixed-length recording, teardown: RECORD_SECONDS and 40 s. */
const FULL_ATTEMPT_MS = (RECORD_SECONDS + 40) * 1000;
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
  }

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
    const caption = ({ target, place, top, maxWidth }: Captioned, text: string, holdMs?: number) =>
      target.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-caption', { detail })), {
        text,
        ms: text ? Math.max(captionMs(text), holdMs ?? 0) : 1,
        ...(place ? { place } : {}),
        ...(top !== undefined ? { top } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
      });
    let lastCaptioned: Captioned = { target: page };
    /** A chapter starts: its time, and its title as the on-screen caption in the window it is about (T13-m4, R2-m6). */
    const chapter = async (title: string, where: Page | Captioned = page, holdMs?: number) => {
      stopIfLost();
      const ms = Date.now() - started;
      chapters.push({ at: Math.floor(ms / 1000), ms, title });
      lastCaptioned = 'target' in where ? where : { target: where };
      await caption(lastCaptioned, title, holdMs);
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
    /** The item panel's width: 0 while it is folded (or not there). */
    const inspectorWidth = () => page.evaluate(() => Math.round(document.querySelector('[data-testid="inspector"]')?.getBoundingClientRect().width ?? 0));
    const paletteOpen = () => page.getByTestId('palette').isVisible();
    /** A settings window or a sheet is on screen (the settings window may wait hidden beforehand). */
    const windowUp = (kind: 'settings' | 'sheet') => () =>
      app.evaluate(({ BrowserWindow }, kind) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().includes(`window=${kind}`)), kind);
    /** Typing as a person does, a character at a time. */
    const typeSlowly = (text: string) => page.keyboard.type(text, { delay: Math.round(70 * PACE) });
    const tree = (id: string) => page.getByTestId(`nav-collection-${id}`);
    /** A chip of the sidebar's tag selector (the item panel draws the same tag's chip too). */
    const chip = (id: string) => page.getByTestId('tag-selector').getByTestId(`tag-chip-${id}`);
    /** A collection row's number (its own items and its sub-collections', each once). */
    const countOf = (id: string) => tree(id).locator('.count');
    const snapshot = () => organizeSnapshot(page);
    /**
     * A drag of the page itself: Playwright's mouse, which Chromium turns into a real dragstart, dragover and drop (React Aria's
     * own handlers run). The system arrow glides to the row the drag starts from and rests there — a native drag cannot be
     * scripted with it — and the lasting tag says the gesture is scripted. `move` holds the platform's move modifier until the
     * drop. The target's drop marker stays up long enough to read before the button goes.
     */
    const scriptedDrag = async (from: Locator, to: Locator, opts: { move?: boolean } = {}) => {
      const a = (await from.boundingBox())!;
      const b = (await to.boundingBox())!;
      const [ax, ay] = [a.x + 40, a.y + a.height / 2];
      const [bx, by] = [b.x + b.width / 2, b.y + b.height / 2];
      await glide(page, 'main', ax, ay);
      await pause(300);
      await scriptedTag('스크립트로 재현');
      await page.mouse.move(ax, ay);
      await page.mouse.down();
      if (opts.move) await page.keyboard.down(MOVE_KEY);
      await page.mouse.move(ax + 10, ay + 10, { steps: 4 }); // past the drag threshold
      for (let i = 1; i <= 24; i++) {
        const t = ease(i / 24);
        await page.mouse.move(ax + (bx - ax) * t, ay + (by - ay) * t);
        await pause(18);
      }
      for (const d of [1, 2, 3]) await page.mouse.move(bx + d, by, { steps: 2 }); // settles the last dragover
      await expect.poll(() => to.evaluate((el) => el.hasAttribute('data-drop-target'))).toBe(true);
      await pause(1400);
      await page.mouse.up();
      if (opts.move) await page.keyboard.up(MOVE_KEY);
      await scriptedTag(null);
      mouseAt.set(page, { x: bx + 3, y: by });
    };
    /**
     * A Finder drag of a real file onto an element, as the OS sends it (Chromium's drag events through CDP): the arrow comes in
     * from the window's left edge, enter, over, a rest while `during` looks, drop.
     */
    const finderDrop = async (file: string, onto: Locator, during: () => Promise<void>) => {
      const b = (await onto.boundingBox())!;
      const files = await finderDrag(page, file);
      try {
        await glide(page, 'main', 14, b.y + b.height / 2);
        await scriptedTag('스크립트로 재현');
        await files.send('dragEnter', onto);
        await files.send('dragOver', onto);
        await expect.poll(() => onto.evaluate((el) => el.hasAttribute('data-drop-target'))).toBe(true);
        await during();
        await pause(2200);
        await scriptedTag(null); // with the drop, never a frame after it
        await files.send('drop', onto);
      } finally {
        await files.close().catch(() => {});
      }
    };
    /**
     * Native popups (the collection and tag menus, the item menu) as the camera should see them: on macOS the real menu opens
     * and stays up for a moment, then the script picks the row (its own click(), as stubContextMenu does) — a path of labels
     * down the submenus (['색 지정', '1 노랑']) — and closes the menu; the chapter's caption says the pick is scripted. Elsewhere
     * nothing is drawn and the pick is at once. A popup with no pick waiting closes after 1.5 s: no menu is ever left open on camera.
     */
    await app.evaluate(({ Menu }, show) => {
      interface LiveItem { label: string; enabled: boolean; visible: boolean; submenu?: { items: LiveItem[] }; click(): void }
      const g = globalThis as { __learnDemoPick?: { path: string[]; holdMs: number } | null; __learnRealPopup?: Electron.Menu['popup'] };
      g.__learnRealPopup ??= Menu.prototype.popup;
      const real = g.__learnRealPopup;
      Menu.prototype.popup = function popup(this: Electron.Menu, options?: Electron.PopupOptions) {
        const pick = g.__learnDemoPick ?? null;
        g.__learnDemoPick = null;
        let level = this.items as unknown as LiveItem[];
        let target: LiveItem | undefined;
        for (const name of pick?.path ?? []) {
          target = level.find((i) => i.label === name && i.enabled && i.visible);
          if (!target) break;
          level = target.submenu?.items ?? [];
        }
        if (target?.submenu) target = undefined; // a path that ends on a submenu's head picks nothing
        if (show) real.call(this, options);
        setTimeout(() => {
          target?.click();
          if (show) this.closePopup();
          else options?.callback?.();
        }, show ? (pick?.holdMs ?? 1500) : 0);
      };
    }, IS_MAC);
    /** The row (a label, or a path of labels down the submenus) the next native popup picks, after showing itself `holdMs` on macOS. */
    const pickFromNextPopup = (itemLabel: string | readonly string[], holdMs = 2200) =>
      app.evaluate((_electron, p) => void ((globalThis as { __learnDemoPick?: unknown }).__learnDemoPick = p), {
        path: typeof itemLabel === 'string' ? [itemLabel] : [...itemLabel],
        holdMs: Math.round(holdMs * PACE),
      });

    if (IS_MAC) await bringAppToFront(app);
    await drawFor(page);
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm5-demo', 'M5 organize demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm5-demo', 'M5 organize demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm5-demo', 'M5 organize demo (2–4 min)');
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
    // 37 characters were on screen 2.5 s (15 a second, design critique): 5.5 s is 7 a second, and the drag starts half
    // a second after the caption has gone.
    await chapter('Learn을 처음 열면 빈 라이브러리가 가져오는 방법을 안내합니다.', page, 5500);
    await expect(page.getByTestId('content').getByRole('button').first()).toBeVisible();
    await pause(6000);

    // 2. Files dragged in and dropped (a synthetic drag of real files: a Finder drag cannot be scripted): the window is the
    //    drop target, the drop imports copies, the result is a toast. The tag stays until the drop.
    const all = [...media.drop, media.read];
    const { w: mainW, h: mainH } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await dropSource(page, all);
    await chapter('자료 파일을 창으로 끌어 놓으면 사본으로 가져옵니다. (끌기는 스크립트로 재현하고, 저자·연도는 데모에서 적어 넣었습니다)');
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
    // What a user would type in the item panel, written in now (chapter 2's caption says so): the table's 저자 and 연도.
    const ids = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? Object.fromEntries(r.data.map((i) => [i.title, i.id])) : ({} as Record<string, string>);
    });
    for (const [title, meta] of Object.entries(DEMO_METADATA)) if (ids[title]) await seedMetadata(page, ids[title], meta);
    await expect(rowByTitle(page, PALETTE_TITLE).locator('[data-col="creators"]')).toContainText('Jun Lee');
    const tagIds: Record<string, string> = {};
    for (const tag of DEMO_ORGANIZE.tags) {
      tagIds[tag.name] = await createTag(page, tag.name);
      await assignTag(page, tagIds[tag.name]!, tag.titles.map((title) => ids[title]!));
    }
    await pause(2500);
    // The drop's toast closes by itself on camera, so each later toast is alone.
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });

    // The item panel needs room beside the sidebar (the runner's own 1024 mode has none): ⌥⌘I shows it before chapter 9.
    const roomy = (await inspectorWidth()) > 0;
    const colourTitle = '광합성 실험 영상';
    const toggleTitle = '광합성 명반응과 암반응';

    // 3. 새 컬렉션: ⇧⌘N puts a named-in-place row at the top of the tree; no dialog, and the view stays where it was.
    await chapter(`${key('Shift+CmdOrCtrl+N')} 키로 새 컬렉션을 만듭니다. 이름은 트리 안에서 바로 적습니다.`);
    await pause(1000);
    const newAt = await press('n', ['shift', 'command'], 'collection.new', async () => (await page.getByTestId('rename-input').count()) > 0);
    await expect(page.getByTestId('rename-input')).toBeFocused();
    await afterKey(newAt, 800);
    await typeSlowly(PARENT);
    await pause(700);
    await keyIn(page, 'Enter');
    await expect(page.getByTestId('rename-input')).toHaveCount(0);
    const parentId = (await snapshot()).collections.find((c) => c.name === PARENT)!.id;
    await expect(tree(parentId)).toBeVisible();
    await park(page, 'main');
    await pause(2500);

    // 4. 새 하위 컬렉션: the collection's native menu (real on macOS, the pick scripted).
    await chapter('컬렉션을 오른쪽 클릭하면 새 하위 컬렉션을 만들 수 있습니다. (메뉴 고르기는 스크립트로 재현합니다)');
    await pause(1000);
    await pickFromNextPopup(label('collection.newChild'));
    await glideClick(page, 'main', tree(parentId), { button: 'right' });
    await expect(page.getByTestId('rename-input')).toBeFocused();
    await typeSlowly(CHILD);
    await pause(700);
    await keyIn(page, 'Enter');
    await expect(page.getByTestId('rename-input')).toHaveCount(0);
    const childId = (await snapshot()).collections.find((c) => c.name === CHILD)!.id;
    await expect(tree(childId)).toBeVisible();
    await park(page, 'main');
    await pause(2500);

    // 5. Rows dragged into a collection: three chosen with ⌘-clicks, one drag takes them all.
    await chapter('표의 행을 끌어 컬렉션에 놓으면 그 컬렉션에 넣습니다. 여러 행도 한 번에 넣습니다. (끌기는 스크립트로 재현합니다)');
    await glideClick(page, 'main', page.getByTestId('nav-scope-all')); // the right click above viewed the empty collection
    await expect(rows).toHaveCount(all.length);
    const filed = [READ_TITLE, '단백질 접힘 강의 노트', '효소 반응 속도론 정리'];
    await glideClick(page, 'main', rowByTitle(page, filed[0]!));
    for (const title of filed.slice(1)) await glideClick(page, 'main', rowByTitle(page, title), { modifiers: [MOD] });
    await pause(1200);
    await scriptedDrag(rowByTitle(page, filed[0]!), tree(parentId));
    await expect.poll(async () => (await snapshot()).members[parentId]?.length ?? 0).toBe(3);
    await expect(countOf(parentId)).toHaveText('3');
    await park(page, 'main');
    await pause(2500);

    // 6. ⌘ moves instead of adding (inside a collection: out of it, into the target), with 실행 취소 in the toast.
    await chapter(`컬렉션 안에서 ${MOVE_LABEL} 키를 누른 채 놓으면 옮깁니다. 토스트의 ‘실행 취소’로 되돌립니다. (끌기는 스크립트로 재현합니다)`);
    await glideClick(page, 'main', tree(parentId));
    await expect(page.getByTestId('toolbar-title')).toHaveText(PARENT);
    await expect(rows).toHaveCount(3);
    await glideClick(page, 'main', rowByTitle(page, READ_TITLE));
    await scriptedDrag(rowByTitle(page, READ_TITLE), tree(childId), { move: true });
    await expect.poll(async () => (await snapshot()).members[childId] ?? []).toEqual([ids[READ_TITLE]]);
    // A move takes the row out of the parent too: a drop that only added would leave it there.
    await expect.poll(async () => (await snapshot()).members[parentId] ?? []).not.toContain(ids[READ_TITLE]);
    // A collection's view lists its subtree, so the moved row is still in the parent's view (now through the child).
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(countOf(childId)).toHaveText('1');
    await park(page, 'main');
    await pause(3000);
    await glideClick(page, 'main', page.getByTestId('undo-action'));
    await expect.poll(async () => (await snapshot()).members[childId] ?? []).toEqual([]);
    await expect.poll(async () => (await snapshot()).members[parentId] ?? []).toContain(ids[READ_TITLE]);
    await expect.poll(async () => (await snapshot()).members[parentId]?.length ?? 0).toBe(3);
    await park(page, 'main');
    await pause(2500);

    // 7. Colour tags: a chip's native menu sets colour 1 and 2 (the pick scripted); the key then puts the tag on the chosen row.
    await chapter('태그의 색을 정하면 번호가 키가 됩니다. 1 키로 붙이고 다시 누르면 뗍니다. (태그는 미리 만들었고, 메뉴 고르기는 스크립트로 재현합니다)');
    await glideClick(page, 'main', page.getByTestId('nav-scope-all'));
    await expect(rows).toHaveCount(all.length);
    await pause(1200);
    const slotOf = async (name: string) => (await snapshot()).tags.find((t) => t.id === tagIds[name])?.position;
    await pickFromNextPopup(['색 지정', '1 노랑']);
    await glideClick(page, 'main', chip(tagIds['중요']!), { button: 'right' });
    await expect.poll(() => slotOf('중요')).toBe(1);
    await pause(1500);
    await pickFromNextPopup(['색 지정', '2 빨강']);
    await glideClick(page, 'main', chip(tagIds['시험 범위']!), { button: 'right' });
    await expect.poll(() => slotOf('시험 범위')).toBe(2);
    await park(page, 'main');
    await pause(2200); // the dots on the rows that already carry the tags
    const taggedWith = async (name: string, title = colourTitle) => ((await snapshot()).tagged[tagIds[name]!] ?? []).includes(ids[title]!);
    // On and off again on a row without 중요, so chapter 8's counts are the same as without it.
    await glideClick(page, 'main', rowByTitle(page, toggleTitle));
    const onAt = await press('1', [], 'tag.color1', () => taggedWith('중요', toggleTitle));
    await expect.poll(() => taggedWith('중요', toggleTitle)).toBe(true);
    await afterKey(onAt, 1500);
    const offAt = await press('1', [], 'tag.color1', async () => !(await taggedWith('중요', toggleTitle)));
    await expect.poll(() => taggedWith('중요', toggleTitle)).toBe(false);
    await afterKey(offAt, 1500);
    await glideClick(page, 'main', rowByTitle(page, colourTitle));
    const oneAt = await press('1', [], 'tag.color1', () => taggedWith('중요'));
    await expect.poll(() => taggedWith('중요')).toBe(true);
    await afterKey(oneAt, 1500);
    const twoAt = await press('2', [], 'tag.color2', () => taggedWith('시험 범위'));
    await expect.poll(() => taggedWith('시험 범위')).toBe(true);
    await afterKey(twoAt, 2000);
    await park(page, 'main');

    // 8. The tag filter: a chip filters, two chips keep only what has both.
    await chapter('태그 칩을 누르면 그 태그가 붙은 자료만 보입니다. 여러 개를 누르면 모두 가진 자료만 남습니다.');
    await pause(1000);
    const tagged = (await snapshot()).tagged;
    const withImportant = tagged[tagIds['중요']!] ?? [];
    const withBoth = withImportant.filter((id) => (tagged[tagIds['시험 범위']!] ?? []).includes(id));
    await glideClick(page, 'main', chip(tagIds['중요']!));
    await expect(page.getByTestId('toolbar-count')).toHaveText(`${withImportant.length}개 / ${all.length}개`);
    await park(page, 'main');
    await pause(2200);
    await glideClick(page, 'main', chip(tagIds['시험 범위']!));
    await expect(page.getByTestId('toolbar-count')).toHaveText(`${withBoth.length}개 / ${all.length}개`);
    await park(page, 'main');
    await pause(3000);
    await glideClick(page, 'main', chip(tagIds['시험 범위']!));
    await glideClick(page, 'main', chip(tagIds['중요']!));
    await expect(rows).toHaveCount(all.length);
    await park(page, 'main');
    await pause(1500);

    // 9. The item panel: 태그 추가, a new name, ↩ makes it and puts it on the item. A window with no room for the panel shows it first.
    await chapter('항목 패널에서 태그를 더합니다. 새 이름을 쓰고 ↩를 누르면 만들어 붙입니다.');
    if (!roomy) {
      notes.push('the window has no room for the item panel beside the sidebar: ⌥⌘I shows it');
      const shownAt = await press('i', ['option', 'command'], 'view.toggleInspector', async () => (await inspectorWidth()) > 0);
      await expect.poll(inspectorWidth).toBeGreaterThan(0);
      await afterKey(shownAt, 1000);
    }
    await glideClick(page, 'main', rowByTitle(page, READ_TITLE));
    await expect(page.getByTestId('tags-section')).toBeVisible();
    await pause(1500);
    await glideClick(page, 'main', page.getByTestId('tag-add-chip'));
    await expect(page.getByTestId('tag-input')).toBeFocused();
    await typeSlowly(DEMO_ORGANIZE.typedTag);
    await pause(900);
    await keyIn(page, 'Enter');
    await expect
      .poll(async () => {
        const s = await snapshot();
        const made = s.tags.find((t) => t.name === DEMO_ORGANIZE.typedTag);
        return made ? (s.tagged[made.id] ?? []).includes(ids[READ_TITLE]!) : false;
      })
      .toBe(true);
    await keyIn(page, 'Escape'); // the field stays open for the next tag until esc
    await park(page, 'main');
    await pause(3000);

    // 10. Importing while a collection is viewed (a window drop, scripted): the overlay and the toast name the collection.
    await chapter('컬렉션을 보는 중에 파일을 놓으면 그 컬렉션에도 넣습니다. (끌기는 스크립트로 재현합니다)');
    await glideClick(page, 'main', tree(childId));
    await expect(page.getByTestId('toolbar-title')).toHaveText(CHILD);
    await dropSource(page, [media.extra[0]!]);
    await glide(page, 'main', 14, mainH * 0.55);
    await drag(page, 'dragenter', 'source');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await expect(overlay).toContainText(`‘${CHILD}’`);
    await scriptedTag('스크립트로 재현');
    await glide(page, 'main', mainW * 0.5, mainH * 0.78);
    await pause(2800);
    await scriptedTag(null);
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('import-done')).toBeVisible();
    await expect.poll(async () => (await snapshot()).members[childId]?.length ?? 0).toBe(1);
    await expect(rows).toHaveCount(1);
    await park(page, 'main');
    await pause(2500);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });

    // 11. A Finder file dropped on a collection row (scripted): the row takes it, no window overlay.
    await chapter('Finder에서 파일을 끌어 컬렉션 행에 놓으면 그 컬렉션으로 가져옵니다. (끌기는 스크립트로 재현합니다)');
    await glideClick(page, 'main', page.getByTestId('nav-scope-all'));
    await finderDrop(media.extra[1]!, tree(parentId), async () => {
      await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    });
    await expect(page.getByTestId('import-done')).toBeVisible();
    await expect(page.getByTestId('import-done')).toContainText(`‘${PARENT}’`);
    await expect.poll(async () => (await snapshot()).members[parentId]?.length ?? 0).toBe(4);
    await park(page, 'main');
    await pause(2500);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });

    // 12. ⌘K lists the collection between the items and the commands; ↩ on its row goes there.
    await chapter(`${key('CmdOrCtrl+K')} 팔레트에서 컬렉션도 찾아 바로 갑니다.`);
    const paletteAt = await press('k', ['command'], 'app.palette', paletteOpen);
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await afterKey(paletteAt, 800);
    for (const ch of '신호') {
      await page.keyboard.insertText(ch);
      await pause(300);
    }
    await expect(page.getByTestId('palette-collection')).toHaveCount(1);
    await pause(1800);
    for (let i = 0; i < 4 && (await page.getByTestId('palette-collection').getAttribute('data-focused')) !== 'true'; i++) await keyIn(page, 'ArrowDown');
    await expect(page.getByTestId('palette-collection')).toHaveAttribute('data-focused', 'true');
    await pause(2200);
    const wentAt = await keyIn(page, 'Enter');
    await expect(page.getByTestId('toolbar-title')).toHaveText(CHILD);
    await afterKey(wentAt);

    // 13. 컬렉션 삭제…: the collection's menu (the pick scripted); the sheet is skipped (said); the view goes to the parent; 실행 취소.
    await stubConfirm(app, 'confirm');
    await chapter('컬렉션을 지우면 확인 시트가 뜨고, 지운 뒤에는 토스트의 ‘실행 취소’로 되돌립니다. (메뉴 고르기와 확인 시트는 스크립트로 재현합니다)');
    await pause(1000);
    await pickFromNextPopup(label('collection.delete'));
    await glideClick(page, 'main', tree(childId), { button: 'right' });
    await expect(tree(childId)).toHaveCount(0);
    await expect(page.getByTestId('toolbar-title')).toHaveText(PARENT);
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await park(page, 'main');
    await pause(3200);
    await glideClick(page, 'main', page.getByTestId('undo-action'));
    await expect(tree(childId)).toBeVisible();
    await park(page, 'main');
    await pause(2500);

    // 14. ⌘, the settings window; a theme tile changes both windows in the same moment (spec 8 row 2). Captioned where
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

    // 15. Dark: the same screens and information — the tree and a collection, then an item in the item panel.
    await chapter('다크 모드에서도 같은 화면, 같은 정보입니다.');
    await pause(1000);
    await glideClick(page, 'main', tree(parentId));
    await expect(page.getByTestId('toolbar-title')).toHaveText(PARENT);
    await pause(2200);
    await glideClick(page, 'main', rowByTitle(page, READ_TITLE));
    await expect(page.getByTestId('inspector-head')).toContainText(READ_TITLE);
    await park(page, 'main');
    await pause(3200);

    // 16. ⌘/: the shortcut sheet, now with the organise shortcuts (the 정리 group); ↩ closes it. The caption is read
    //     before the sheet comes (a sheet covers the window's middle).
    await chapter(`${key('CmdOrCtrl+/')} 키로 단축키 도움말을 엽니다. ${key('Shift+CmdOrCtrl+N')} ‘${label('collection.new')}’과 1–8 색 태그 키도 들어 있습니다.`, page, 9000); // read before the sheet (2.5 s) and kept up while it shows (5 s), until chapter 17 replaces it
    // Under a sheet the pill takes the bottom-left (demo.css): the pointer rests above the caption meanwhile.
    await glide(page, 'main', 120, (await page.evaluate(() => innerHeight)) - 240);
    await pause(2500);
    const sheet = await expectWindow(app, 'sheet', () => press('/', ['command'], 'app.shortcuts', windowUp('sheet')));
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: label('collection.new') }).first()).toBeVisible();
    await pause(5000);
    await closeSheet(sheet, 'Enter');

    // 17. The end: the library in dark, held. The pointer parks first, so it never crosses the final caption.
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
    const txt = outFile('m5-demo.chapters.raw.txt');
    const json = outFile('m5-demo.chapters.json');
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
          /** Which clock each field is on, so no list is read against the wrong video. */
          timelines: {
            'chapters[].ms': "milliseconds on the demo script's clock (zero = the first chapter's start)",
            offset: "seconds from that zero to the raw recording's first frame",
            demoSeconds: "seconds on the script's clock",
            'm5-demo.chapters.raw.txt': 'the raw recording (m5-demo.mov / .mp4): ms / 1000 − offset; late on the trimmed file',
            'm5-demo.final.* and its .chapters.txt/.json': 'the trimmed video that viewers watch: scripts/finish-demo.sh writes them, with the cut head and the Mac file length applied',
          },
          /** Seconds from the chapters' zero to the recording's first frame: a chapter is at `ms / 1000 − offset` in the raw video. */
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
    record({ file: txt.rel, kind: 'data', description: 'M5 demo chapter list on the RAW recording timeline (the trimmed video has its own list from finish-demo.sh)' });
    record({ file: json.rel, kind: 'data', description: 'M5 demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M5 demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('m5-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
