// @demo — a 3–4 minute macOS screen recording of the M7a work (the English paper opened, a sentence selected, the consent in the
// pop-up, the pop-up's translation, 이어 붙이기 in the panel, ⌘F, the outline, rotation and zoom, the sepia page colour, the same
// place after quitting, the 진행 column) on the fake translation engine, with a chapter list
// (m7a-demo.chapters.raw.txt / .json; the trimmed video's own list comes from finish-demo.sh), a caption per chapter on screen,
// and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the server, scripts/record-demo-linux.sh on
// Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded.
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
import { type CommandId } from '../../packages/domain/src/commands';
import { motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import {
  FIXTURES, NativeInputNotPermitted, ROOT, bringAppToFront, importFiles,
  launch, nativeKeyCode, nativeKeystroke, osascriptLimits, rowByTitle, runMenuCommand, selectInPage, waitImportIdle,
  type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionBottom, parkSpot as parkAt } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, glideCursor, hideDock, neutralDesktop, renamedElectron } from './demo-mac';
import { PALETTE_TITLE, PDF_FOOTER, READ_TITLE, writeDemoMedia } from './demo-media';
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
/** The English paper the reader chapters open (fixtures/generated/paper-100.pdf, copied under a readable name). */
const PAPER_TITLE = 'Attention Is All You Need';
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
/**
 * Set once the file's afterAll has begun. A test that Playwright has failed (an unhandled rejection, a timeout) keeps running
 * in the background: when its attempt then ends it must not start the next one, which would switch the display again with
 * nothing left to put it back (Mac all 41387123318: every suite after the demo ran at 1600 × 900).
 */
let testEnded = false;
test.afterAll(async () => {
  testEnded = true;
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
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The demo's library folder, a path a viewer can read (the settings window shows it): on a CI runner (ephemeral)
 * ~/Learn 라이브러리, never on a developer's machine, where it lives under the temp folder. Never an existing folder.
 */
function libraryFolder(work: string): string {
  return readableFolder(work, 'Learn 라이브러리');
}

/** A folder of the demo that a sheet shows: under the CI home (shown as ~/…) when that name is free there, else under `work`. */
function readableFolder(work: string, name: string): string {
  const home = path.join(os.homedir(), name);
  return process.env['CI'] && !fs.existsSync(home) ? home : path.join(work, name);
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
  if (testEnded) throw new Error('the demo test has already ended (failed or timed out): no further attempt is started');
  lostRecording = null;
  const work = path.join(os.tmpdir(), 'learn-demo');
  fs.mkdirSync(work, { recursive: true });
  const libraryDir = libraryFolder(work);
  // A local folder left by an interrupted run would start the demo with its items (CI's home folder is never reused).
  if (libraryDir.startsWith(work)) fs.rmSync(libraryDir, { recursive: true, force: true });
  const userData = fs.mkdtempSync(path.join(work, 'userdata-'));
  const materialDir = path.join(work, '자료');
  const backups = readableFolder(work, 'Learn 백업');
  const restores = readableFolder(work, '복원 위치');
  // Folders under `work` may be left by an interrupted run; the CI home's are never reused.
  for (const dir of [backups, restores]) if (dir.startsWith(work)) fs.rmSync(dir, { recursive: true, force: true });
  const notes: string[] = [];
  const input = { native: 0, menu: 0 };
  const chapters: Array<{ at: number; ms: number; title: string }> = [];
  /** An overlay element (caption, tag, parked pointer) found over the sidebar's labels, launcher or tag chips (round 2 minors 2–4). */
  const overlayClashes: string[] = [];
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
    let app = s.app;
    onRestore('the app (closing it)', () => app.close().catch(() => {}));
    let page = s.page;
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
    /** The main window's sidebar as drawn now: the tag selector's top (null: none drawn) and the bottom of the last tree row or of the hint. */
    const sidebarNow = (p: Page) =>
      p.evaluate(() => {
        const tags = document.querySelector('.sidebar .tag-selector')?.getBoundingClientRect();
        const rows = [...document.querySelectorAll('[data-testid="sidebar-tree"] [role="row"]')].map((r) => r.getBoundingClientRect().bottom);
        // With no collections the tree shows a hint under its rows; the pointer must not rest on it.
        const hint = document.querySelector('[data-testid="sidebar-hint"]')?.getBoundingClientRect();
        if (hint && hint.height > 0) rows.push(hint.bottom);
        return { h: innerHeight, w: innerWidth, tagTop: tags && tags.height > 0 ? tags.top : null, treeBottom: rows.length > 0 ? Math.max(...rows) : 0 };
      });
    /**
     * Where the pointer rests when it hovers nothing and covers no overlay element (demo.css): in the main window the
     * tree's empty part, clear of the tag chips and of the caption above them (demo-geometry.ts parkSpot); the settings
     * window's empty header corner.
     */
    const parkSpot = async (p: Page, kind: WindowKind) => {
      const now = await sidebarNow(p);
      return kind === 'main' ? parkAt(now.h, now.treeBottom, now.tagTop) : { x: now.w - 40, y: 18 };
    };
    /**
     * After a scripted pointer action Playwright's own pointer (CDP) stays where the action ended, unseen while the system arrow
     * is the pointer, and its hover opens title tooltips over row names there (critique minor 2): it goes to the park spot. The
     * drawn cursor is that pointer, so it stays.
     */
    const releasePointer = async (p: Page, kind: WindowKind) => {
      if (cursor === 'synthetic') return;
      const at = await parkSpot(p, kind);
      await p.mouse.move(at.x, at.y);
    };
    /** Glides onto the middle of an element, rests on it, presses it (where the pointer already is), and stays a beat. */
    const glideClick = async (p: Page, kind: WindowKind, target: Locator, opts: { modifiers?: Array<'Shift' | 'Meta' | 'Control'>; button?: 'right' } = {}) => {
      const box = (await target.boundingBox())!;
      await glide(p, kind, box.x + box.width / 2, box.y + box.height / 2);
      await pause(250);
      await target.click({ ...(opts.modifiers ? { modifiers: opts.modifiers } : {}), ...(opts.button ? { button: opts.button } : {}) });
      await releasePointer(p, kind);
      await pause(400);
    };
    /** Rests the pointer at the park spot (parkSpot). */
    const park = async (p: Page, kind: WindowKind) => {
      const at = await parkSpot(p, kind);
      await glide(p, kind, at.x, at.y);
      await releasePointer(p, kind);
      if (kind === 'main') await overlayClear(p, `parked at ${at.x},${at.y}`, at);
    };
    /**
     * A caption on a page (an empty text clears it): bottom-left, above the pill band, at most `maxWidth` wide; or at
     * the top (`place`, `top` px down) where the bottom holds the page's own text (the settings window's 라이브러리
     * 위치 card, mac1 m3).
     */
    type Captioned = { target: Page; place?: 'top'; top?: number; maxWidth?: number };
    /**
     * Whether the overlay keeps clear of the sidebar's own text where it is drawn now: the caption and the tag off the launcher,
     * the section labels and the tag selector; a parked pointer (`at`, its tip, the arrow 20 px below it) off the chips and the
     * caption. Anything found is recorded in overlayClashes, judged at the end.
     */
    const overlayClear = async (p: Page, what: string, at?: { x: number; y: number }) => {
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const found = await p.evaluate((pt) => {
        const boxes = (sel: string) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const captions = boxes('[data-testid="demo-caption"]:not([data-leaving])');
        const tags = boxes('[data-testid="demo-tag"]');
        const guarded: Record<string, DOMRect[]> = { 'the tag selector': boxes('.sidebar .tag-selector'), 'the launcher': boxes('.sidebar .launcher'), 'a section label': boxes('.sidebar .section-label') };
        const out: string[] = [];
        const at = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`;
        for (const [name, rects] of Object.entries(guarded)) {
          for (const r of rects) {
            for (const c of captions) if (hit(c, r)) out.push(`caption ${at(c)} over ${name} ${at(r)}`);
            for (const c of tags) if (hit(c, r)) out.push(`tag ${at(c)} over ${name} ${at(r)}`);
          }
        }
        if (pt) {
          const under = (r: DOMRect) => pt.x >= r.left - 4 && pt.x <= r.right + 4 && pt.y + 20 >= r.top && pt.y <= r.bottom;
          if (boxes('.sidebar .tag-selector').some(under)) out.push('pointer parked on the tag selector');
          if (captions.some(under)) out.push('pointer parked on the caption');
        }
        return out;
      }, at ?? null);
      for (const f of found) overlayClashes.push(`${what}: ${f}`);
    };
    /** In the main window a bottom caption stands above the tag selector once that has grown (demo-geometry.ts captionBottom). */
    const mainCaptionBottom = async () => {
      const now = await sidebarNow(page);
      return captionBottom(now.h, now.tagTop);
    };
    const caption = async ({ target, place, top, maxWidth }: Captioned, text: string, holdMs?: number) => {
      const bottom = target === page && !place ? await mainCaptionBottom() : undefined;
      await target.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-caption', { detail })), {
        text,
        ms: text ? Math.max(captionMs(text), holdMs ?? 0) : 1,
        ...(place ? { place } : {}),
        ...(top !== undefined ? { top } : {}),
        ...(bottom !== undefined ? { bottom } : {}),
        ...(maxWidth !== undefined ? { maxWidth } : {}),
      });
      if (text && target === page) await overlayClear(page, `caption "${text.slice(0, 24)}…"`);
    };
    let lastCaptioned: Captioned = { target: page };
    /** A chapter starts: its time, and its title as the on-screen caption in the window it is about (T13-m4, R2-m6). */
    const chapter = async (title: string, where: Page | Captioned = page, holdMs?: number) => {
      stopIfLost();
      const ms = Date.now() - started;
      chapters.push({ at: Math.floor(ms / 1000), ms, title });
      lastCaptioned = 'target' in where ? where : { target: where };
      await caption(lastCaptioned, title, holdMs);
    };
    /** The lasting "스크립트로 재현" tag while a scripted gesture is on screen (T13R2-m3). */
    const scriptedTag = async (text: string | null) => {
      await page.evaluate((detail) => dispatchEvent(new CustomEvent('learn:demo-tag', { detail })), text);
      if (text) await overlayClear(page, `tag "${text}"`);
    };
    /**
     * A shortcut: the real key through System Events on macOS (NSMenu sees it), else the menu item's own click().
     * Returns when the key went out (for afterKey). On macOS (demo-keys.ts): a key System Events refuses, or that runs
     * past its 5 s limit, is a note and the menu item instead, so the run goes on (round 3 m2). `there` is the state
     * the chapter needs: a late key that brought it already is not run again, the menu item runs only while it is not
     * there (never toggling past it), and 2 s after a fallback a key that landed later still and undid it is undone
     * (re-review minor 1).
     */
    const press = async (k: string, modifiers: KeyModifier[], menu: CommandId | (() => Promise<unknown>), there?: () => Promise<boolean>, code?: number) => {
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
        native: () => (code === undefined ? nativeKeystroke(app, k, modifiers) : nativeKeyCode(app, code, modifiers)),
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
    if (IS_MAC) await bringAppToFront(app);
    await drawFor(page);
    await park(page, 'main');
    // ---- the library, filled before anything is recorded -------------------------------------------------------------
    // The demo's own study notes and the English paper (copied under a readable name), put in through the import path as a
    // user would (the file panel is skipped), then two of the notes read — one to its last page, one to its second — so the
    // 진행 column of the last chapter has something to show. None of this is on camera.
    const paper = path.join(materialDir, `${PAPER_TITLE}.pdf`);
    fs.copyFileSync(path.join(FIXTURES, 'paper-100.pdf'), paper);
    const progressOf = (title: string) =>
      page.evaluate(async (t) => {
        const r = await window.learn.library.list();
        return r.ok ? (r.data.find((i) => i.title === t)?.progress ?? 0) : 0;
      }, title);
    await importFiles(s, [...media.drop.filter((f) => f.endsWith('.pdf')), media.read, ...media.extra, paper]);
    await waitImportIdle(page);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 15_000 });
    for (const [title, toLast] of [[READ_TITLE, true], [PALETTE_TITLE, false]] as const) {
      await rowByTitle(page, title).dblclick();
      await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
      const total = Number((await page.getByTestId('pdf-page-count').innerText()).replace(/\D/g, ''));
      const field = page.getByTestId('pdf-page-field');
      await field.fill(String(toLast ? total : 2));
      await field.press('Enter');
      await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page', String(toLast ? total : 2));
      await expect.poll(() => progressOf(title), { timeout: 15_000 }).toBeGreaterThan(0.4);
      await page.getByTestId('viewer-back').click();
      await expect(page.getByTestId('library-table')).toBeVisible();
    }
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm7a-demo', 'M7a demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm7a-demo', 'M7a demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm7a-demo', 'M7a demo (3–4 min)');
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

    notes.push('the selection of a sentence is scripted (a range over the text layer); the pointer and the clicks are real, the file panel is not used (the library is filled before the recording)');
    const viewer = page.getByTestId('pdf-viewer');
    const popup = page.getByTestId('selection-popup');
    const S3 = 'We propose a new simple network architecture.';
    const K3 = '우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다.';
    const S4 = 'It is based solely on attention mechanisms.';
    const K4 = '이는 주의 메커니즘에만 기반을 두고 있습니다.';
    const S1 = 'Attention is all you need.';
    const K1 = '주의가 필요한 전부입니다.';
    const readerReady = async () => {
      await expect(viewer).toHaveAttribute('data-pages', /^[1-9]/);
      await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
      await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached(); // the text layer is drawn after the canvas
    };
    /** A selection the user lets go of, and the pop-up with it. */
    const unselect = async () => {
      await page.evaluate(() => getSelection()!.removeAllRanges());
      await expect(popup).toHaveCount(0);
    };
    /** The sentence is picked in the text layer (scripted: the caption says so), the pointer resting where the drag would end. */
    const pickSentence = async (sentence: string) => {
      const line = page.locator('.page[data-page-number="1"] .textLayer span', { hasText: sentence.slice(0, 20) }).first();
      const box = (await line.boundingBox())!;
      await glide(page, 'main', box.x + box.width * 0.9, box.y + box.height / 2);
      await scriptedTag('선택은 스크립트로 재현');
      await selectInPage(page, sentence);
      await pause(600);
      await scriptedTag(null);
    };

    // 1. The English paper opens: thumbnails on the left, the panel on the right.
    await chapter('영어로 쓴 논문 PDF를 엽니다. 왼쪽에는 쪽 목록이, 오른쪽에는 번역과 항목 정보가 있는 패널이 열립니다.');
    await pause(1500);
    await glideClick(page, 'main', rowByTitle(page, PAPER_TITLE));
    await pause(700);
    await rowByTitle(page, PAPER_TITLE).dblclick();
    await readerReady();
    await park(page, 'main');
    await pause(4500);

    // 2. A sentence is selected; the pop-up asks first (consent), the panel asks the same.
    await chapter('문장을 고르면 선택한 글 옆에 팝업이 뜹니다. 아직 번역을 켜지 않았으므로 팝업이 먼저 묻습니다. (고르기는 스크립트로 재현합니다)', page, 5500);
    await pause(800);
    await pickSentence(S1);
    await expect(popup).toHaveAttribute('data-state', 'consent');
    await pause(5000);

    // 3. Consent: nothing is sent before it.
    await chapter('‘번역 켜기’를 누르면 그때부터 선택한 글을 Google로 보내 번역합니다. 동의하기 전에는 아무것도 보내지 않습니다.', page, 5500);
    await glideClick(page, 'main', popup.getByTestId('consent-enable'));
    await expect(popup).toHaveAttribute('data-state', 'done');
    await expect(page.getByTestId('translation-result')).toHaveText(K1);
    await pause(4500);

    // 4. The pop-up translates what is selected from now on.
    await chapter('이제 글을 고를 때마다 팝업이 번역을 보여 주고, 같은 번역이 오른쪽 패널에도 남습니다. (고르기는 스크립트로 재현합니다)', page, 5500);
    await unselect();
    await pause(600);
    await pickSentence(S3);
    await expect(popup).toHaveAttribute('data-state', 'done');
    await expect(popup).toContainText(K3);
    await pause(5500);

    // 5. 이어 붙이기 in the panel: the next sentence goes under the first, the translation holds both.
    await chapter('패널의 ‘이어 붙이기’를 켜면 다음에 고른 문장이 원문 아래에 붙고, 번역은 두 문장을 함께 다룹니다. (고르기는 스크립트로 재현합니다)', page, 6500);
    await glideClick(page, 'main', page.getByTestId('translation-concat'));
    await expect(page.getByTestId('translation-concat').locator('input')).toBeChecked();
    await unselect();
    await pause(500);
    await pickSentence(S4);
    await expect(page.getByTestId('translation-source')).toHaveValue(`${S3}\n${S4}`);
    await expect(page.getByTestId('translation-result')).toContainText(K4);
    await park(page, 'main');
    await pause(5500);

    // 6. 찾기: ⌘F, a word, the next results.
    await chapter(`${key('CmdOrCtrl+F')}로 찾기 막대를 열고 단어를 입력하면 문서 전체의 결과 수가 세어지고, 다음 결과로 넘어갈 수 있습니다.`, page, 5500);
    await unselect();
    const findAt = await press('f', ['command'], 'library.find', async () => (await page.getByTestId('pdf-find-bar').count()) > 0);
    await expect(page.getByTestId('pdf-find-field').getByRole('searchbox')).toBeFocused();
    await afterKey(findAt, 600);
    await page.keyboard.type('attention', { delay: 140 * PACE });
    await expect(page.getByTestId('pdf-find-count')).toHaveText(/^1 \/ \d+$/);
    await pause(2500);
    await glideClick(page, 'main', page.getByTestId('pdf-find-next'));
    await glideClick(page, 'main', page.getByTestId('pdf-find-next'));
    await expect(page.getByTestId('pdf-find-count')).toHaveText(/^3 \/ \d+$/);
    await pause(3500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-find-bar')).toHaveCount(0);
    await park(page, 'main');
    await pause(1500);

    // 7. 목차: the segment, a chapter.
    await chapter('왼쪽의 ‘목차’로 바꾸면 PDF의 목차가 나오고, 장을 누르면 그 쪽으로 이동합니다.', page, 5000);
    await glideClick(page, 'main', page.getByTestId('reader-nav-outline'));
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await pause(2500);
    await glideClick(page, 'main', page.getByTestId('pdf-outline').getByRole('row', { name: /Chapter 3/ }).first());
    await expect(viewer).toHaveAttribute('data-page', '21');
    await park(page, 'main');
    await pause(3500);

    // 8. Rotation and zoom.
    await chapter(`${key('CmdOrCtrl+R')}로 쪽을 돌리고, 확대 메뉴에서 배율을 고릅니다.`, page, 5000);
    const rotateAt = await press('r', ['command'], 'reader.rotateCw', async () => (await viewer.getAttribute('data-rotation')) === '90');
    await expect(viewer).toHaveAttribute('data-rotation', '90');
    await afterKey(rotateAt);
    const rotateBack = await press('l', ['command'], 'reader.rotateCcw', async () => (await viewer.getAttribute('data-rotation')) === '0');
    await expect(viewer).toHaveAttribute('data-rotation', '0');
    await afterKey(rotateBack, 1200);
    await glideClick(page, 'main', page.getByTestId('pdf-zoom-menu'));
    await pause(1500);
    await glideClick(page, 'main', page.getByRole('menuitemradio', { name: '150%' }));
    await expect(viewer).toHaveAttribute('data-scale', '1.5');
    await park(page, 'main');
    await pause(3500);

    // 9. Page colour: 세피아.
    await chapter('보기 메뉴의 ‘쪽 색’에서 세피아를 고르면 눈이 덜 피로한 종이색으로 바뀝니다.', page, 5000);
    await glideClick(page, 'main', page.getByTestId('pdf-view-menu'));
    await pause(1500);
    await glideClick(page, 'main', page.getByRole('menuitemradio', { name: '세피아' }));
    await expect(viewer).toHaveAttribute('data-page-color', 'sepia');
    await park(page, 'main');
    await pause(4500);

    // 10. Quit and open again: the same place (page, zoom, colour). The app is closed and started again on the same library.
    notes.push('chapter 10: the app is closed and started again once on the same library and settings (a new window; the recording goes on)');
    await chapter('앱을 종료했다가 다시 열고 같은 논문을 열면, 읽던 쪽과 배율과 쪽 색이 그대로입니다. (앱을 한 번 닫았다가 다시 엽니다)', page, 6000);
    await pause(3000);
    await expect.poll(() => progressOf(PAPER_TITLE)).toBeGreaterThan(0.15); // the place is saved (page 21 of 100)
    const scaleBefore = await viewer.getAttribute('data-scale');
    await app.close();
    s = await launch(libraryDir, userData, launchOptions);
    app = s.app;
    onRestore('the app (closing it again)', () => app.close());
    page = s.page;
    await drawFor(page);
    await park(page, 'main');
    // The new window has its own overlay, which starts empty: the caption is shown again here.
    await caption({ target: page }, '앱을 종료했다가 다시 열고 같은 논문을 열면, 읽던 쪽과 배율과 쪽 색이 그대로입니다.', 5000);
    await pause(2500);
    await glideClick(page, 'main', rowByTitle(page, PAPER_TITLE));
    await pause(500);
    await rowByTitle(page, PAPER_TITLE).dblclick();
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page', '21');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-scale', scaleBefore!);
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page-color', 'sepia');
    await park(page, 'main');
    await pause(5500);

    // 11. The library's 진행 column: how far each item has been read.
    await chapter('목록의 ‘진행’ 열에는 자료마다 어디까지 읽었는지가 보이고, 끝까지 읽은 자료에는 ‘완료’가 표시됩니다.', page, 5500);
    await glideClick(page, 'main', page.getByTestId('viewer-back'));
    await expect(page.getByTestId('library-table')).toBeVisible();
    await pause(1000);
    const progressHeader = page.locator('[data-testid="column-header"][data-col="progress"]');
    await glideClick(page, 'main', progressHeader);
    if ((await progressHeader.getAttribute('aria-sort')) !== 'descending') await glideClick(page, 'main', progressHeader);
    await expect(progressHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByTestId('progress-done').first()).toBeVisible();
    await expect(page.getByTestId('progress-cell').first()).toBeVisible();
    await park(page, 'main');
    await pause(6500);

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
    for (const dir of [backups, restores, materialDir]) fs.rmSync(dir, { recursive: true, force: true });
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
    const txt = outFile('m7a-demo.chapters.raw.txt');
    const json = outFile('m7a-demo.chapters.json');
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
            'm7a-demo.chapters.raw.txt': 'the raw recording (m7a-demo.mov / .mp4): ms / 1000 − offset; late on the trimmed file',
            'm7a-demo.final.* and its .chapters.txt/.json': 'the trimmed video that viewers watch: scripts/finish-demo.sh writes them, with the cut head and the Mac file length applied',
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
          /** The overlay over the sidebar's own text, where the script found it (empty: clear throughout). */
          overlayClashes,
          chapters,
        },
        null,
        2,
      )}\n`,
    );
    record({ file: txt.rel, kind: 'data', description: 'M7a demo chapter list on the RAW recording timeline (the trimmed video has its own list from finish-demo.sh)' });
    record({ file: json.rel, kind: 'data', description: 'M7a demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  expect.soft(overlayClashes, 'captions, the tag and the parked pointer keep clear of the sidebar\'s labels and tag chips').toEqual([]);
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M7a demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('m7a-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
