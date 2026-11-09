// @demo — a 3–4 minute macOS screen recording of the M7c work (five pictures dropped on the window; a photo opened fitted,
// pinched, dragged, turned and set on a dark ground; its tab closed and opened again in the same place; the quick search's
// scope set to 정보와 본문; a two-letter Korean word that finds PDF bodies; the item panel's 본문 일치; a page opened from it with
// the find bar on the word; the index progress line; a match leaving for the trash), with a chapter list
// (m7c-demo.chapters.raw.txt / .json; the trimmed video's own list comes from finish-demo.sh), a caption per chapter on screen,
// and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the server, scripts/record-demo-linux.sh on
// Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded. The app reads PDF bodies as it does for a user
// (LEARN_TEXT_EXTRACTION=run). The M7a and M7b demos stay in git history.
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
  NativeInputNotPermitted, ROOT, bringAppToFront, drag, dropSource, imageState, importFiles,
  launch, nativeKeyCode, nativeKeystroke, osascriptLimits, rowByTitle, runMenuCommand, stubOpenDialog, textExtraction, textIdle, waitImportIdle,
  type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionBottom, parkSpot as parkAt } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, glideCursor, hideDock, neutralDesktop, renamedElectron, warpTo } from './demo-mac';
import { MATCHES_TITLE, PDF_FOOTER, PHOTO_TITLE, PICTURES, SEARCH_WORD, TRASHED_TITLE, writeDemoMedia, writeDemoPictures, type Picture } from './demo-media';
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
 * Work done in a hidden window of the launched app, at most PRINT_MS: work that takes longer throws, and its hidden window is
 * destroyed from here (every window this made is kept in a list for that); work that fails destroys its own.
 */
async function inHiddenWindow(app: ElectronApplication, work: Promise<string>, what: string): Promise<Buffer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${PRINT_MS / 1000} s`)), PRINT_MS);
  });
  try {
    return Buffer.from(await Promise.race([work, limit]), 'base64');
  } catch (e) {
    void work.catch(() => {}); // it may still settle after the limit
    await app
      .evaluate(() => {
        for (const w of (globalThis as { __learnDemoPrints?: Electron.BrowserWindow[] }).__learnDemoPrints ?? []) if (!w.isDestroyed()) w.destroy();
      })
      .catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prints an HTML file to PDF in the launched app: a hidden window loads it, waits for its fonts, and Chromium prints it
 * with the page's own size and margins and a page-number footer. Chromium subsets the font (T13R2-n1).
 */
const printPdfWith = (app: ElectronApplication) => (htmlFile: string): Promise<Buffer> =>
  inHiddenWindow(
    app,
    app.evaluate(
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
    ),
    'printing',
  );

/** Draws one of the demo's pictures on a canvas in a hidden window of the launched app and returns its file bytes. */
const drawPictureWith = (app: ElectronApplication) => (htmlFile: string, spec: Picture): Promise<Buffer> =>
  inHiddenWindow(
    app,
    app.evaluate(
      async ({ BrowserWindow }, { file, spec }) => {
        const g = globalThis as { __learnDemoPrints?: Electron.BrowserWindow[] };
        const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true } });
        (g.__learnDemoPrints ??= []).push(w);
        try {
          await w.loadFile(file);
          const url = (await w.webContents.executeJavaScript(`window.drawPicture(${JSON.stringify(spec)})`, true)) as string;
          if (!url.startsWith(`data:${spec.mime};base64,`)) throw new Error(`the canvas gave ${url.slice(0, 24)}…, not ${spec.mime}`);
          return url.slice(url.indexOf(',') + 1);
        } finally {
          if (!w.isDestroyed()) w.destroy();
        }
      },
      { file: htmlFile, spec },
    ),
    'drawing',
  );

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
  const pictureDir = path.join(work, '사진과 도판');
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
    // The body index runs as it does for a user (E2E otherwise holds it until a test lets it go).
    env: { LEARN_DEMO_OVERLAY: '1', LEARN_TEXT_EXTRACTION: 'run' },
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
     * Not while Playwright's button is down (dragAlong does that: a native mouse-moved event carries no button, and the app ends a
     * drag whose move comes with the button up).
     */
    const glide = async (p: Page, kind: WindowKind, x: number, y: number) => {
      await pointerTo(kind);
      /** Playwright's mouse along the same eased path, step by step (the drawn cursor's, and a held drag's own moves). */
      const stepped = async () => {
        const from = mouseAt.get(p) ?? { x, y }; // a window's first glide starts where it is going
        const steps = 20;
        for (let i = 1; i <= steps; i++) {
          const t = ease(i / steps);
          await p.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t);
          await pause(21);
        }
        mouseAt.set(p, { x, y });
      };
      if (cursor !== 'synthetic') {
        const o = await originOf(kind);
        const to = { x: o.x + x, y: o.y + y };
        const once = () => glideCursor(to, { warpOnly: cursor === 'warp' });
        // A glide that throws (a stuck Apple Event) is tried once more before the mode changes (round 3 m2).
        const moved = once()
          .catch(async (e: unknown) => {
            notes.push(`moving the system cursor failed (${errorText(e)}): tried once more`);
            return once();
          })
          .catch((e: unknown) => {
            notes.push(`moving the system cursor failed again (${errorText(e)}): the drawn cursor only`);
            return { moved: false, warped: false };
          });
        const r = await moved;
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
      await stepped();
    };
    /**
     * Moves the pointer along an eased path from (x0, y) to (x1, y) while Playwright's button is down: one clock. For each step
     * the system cursor is warped to the point (no event: a native mouse-moved event carries no button and would end the drag) and
     * Playwright's mouse is moved to the same point, both awaited before the next step, so the dragged tab is where the visible
     * cursor is (critique m7b-mac M3). Synthetic input (Linux): the drawn cursor follows Playwright's mouse, which is the one clock.
     */
    const dragAlong = async (p: Page, kind: WindowKind, x0: number, x1: number, y0: number, y1 = y0) => {
      const o = cursor === 'synthetic' ? null : await originOf(kind);
      const steps = 24;
      let failed = false;
      for (let i = 1; i <= steps; i++) {
        const x = x0 + (x1 - x0) * ease(i / steps);
        const y = y0 + (y1 - y0) * ease(i / steps);
        const warped = o
          ? warpTo({ x: o.x + x, y: o.y + y }).then(
              (r) => r.warped,
              () => false,
            )
          : Promise.resolve(true);
        const [ok] = await Promise.all([warped, p.mouse.move(x, y)]);
        if (!ok) failed = true;
        if (!o) await pause(30);
      }
      if (failed) notes.push('the held drag: the system cursor could not be warped at some step, the drawn cursor only');
      mouseAt.set(p, { x: x1, y: y1 });
    };
    /** The main window's sidebar as drawn now: the tag selector's top (null: none drawn) and the bottom of the last tree row or of the hint. */
    const sidebarNow = (p: Page) =>
      p.evaluate(() => {
        const tags = document.querySelector('.sidebar .tag-selector')?.getBoundingClientRect();
        const rows = [...document.querySelectorAll('[data-testid="sidebar-tree"] [role="row"]')].map((r) => r.getBoundingClientRect().bottom);
        // With no collections the tree shows a hint under its rows; the pointer must not rest on it.
        const hint = document.querySelector('[data-testid="sidebar-hint"]')?.getBoundingClientRect();
        if (hint && hint.height > 0) rows.push(hint.bottom);
        // A PDF reader shown: the empty stretch of its toolbar between the page group and the zoom field (the sidebar there lists
        // thumbnails under the caption, and the launcher sits at the top: neither is a place to rest on).
        const gap = document.querySelector('[data-testid="tab-panel"][data-active="true"] .reader-toolbar .spacer')?.getBoundingClientRect();
        const rest = gap && gap.width >= 24 ? { x: Math.round(gap.x + gap.width / 2), y: Math.round(gap.y + gap.height / 2) } : null;
        return { h: innerHeight, w: innerWidth, tagTop: tags && tags.height > 0 ? tags.top : null, treeBottom: rows.length > 0 ? Math.max(...rows) : 0, rest };
      });
    /**
     * Where the pointer rests when it hovers nothing and covers no overlay element (demo.css): in the main window a shown PDF
     * reader's empty toolbar stretch, else the sidebar's tree's empty part, clear of the tag chips and of the caption above them (demo-geometry.ts parkSpot); the settings
     * window's empty header corner.
     */
    const parkSpot = async (p: Page, kind: WindowKind) => {
      const now = await sidebarNow(p);
      return kind === 'main' ? (now.rest ?? parkAt(now.h, now.treeBottom, now.tagTop)) : { x: now.w - 40, y: 18 };
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
    // The demo's study notes (all but the two that the index chapter brings in) and its two videos, put in through the import path
    // as a user would (the file panel is skipped), and their bodies read: the app reads them as it does for a user, and the demo
    // only skips the wait after the window's first idle and waits for the reading to end. The five pictures are drawn now and
    // dropped on camera. None of this is on camera.
    const pictures = await writeDemoPictures(pictureDir, drawPictureWith(app), (text) => notes.push(text));
    const indexProgress = () => page.evaluate(() => window.learn.search.progress().then((r) => (r.ok ? r.data : null)));
    const firstPdfs = [media.read, ...media.drop].filter((f) => f.endsWith('.pdf'));
    await importFiles(s, [media.read, ...media.drop]);
    await waitImportIdle(page);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 15_000 });
    await textExtraction(app, 'now');
    await textIdle(app);
    await expect.poll(indexProgress).toEqual({ done: firstPdfs.length, total: firstPdfs.length });
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm7c-demo', 'M7c demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm7c-demo', 'M7c demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm7c-demo', 'M7c demo (3–4 min)');
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

    notes.push(
      'the pictures are dropped by synthetic drag events on the window and the pinch is synthetic ctrl-wheel events (their captions say so); the picture is dragged by the pointer; ⌘R, ⌘W, ⇧⌘T, ⌘1, ⌘O and ⌘⌫ are keys (the menu items on Linux); the search word is typed; the rest is clicked by the pointer',
    );
    const shownTab = () => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id');
    const stage = () => page.locator('[data-testid="tab-panel"][data-active="true"] [data-testid="image-stage"]');
    const drawn = () => expect.poll(async () => (await imageState(page))?.status, { timeout: 15_000 }).toBe('shown');
    const searchField = page.getByTestId('search-field').locator('input');
    const scopeMenu = page.getByRole('menu', { name: '검색 범위' });
    const titleOf = (file: string) => path.basename(file, path.extname(file));
    const backToLibrary = async () => {
      const at = await press('1', ['command'], 'nav.back', async () => (await shownTab()) === 'library');
      await expect(page.getByTestId('library-table')).toBeVisible();
      return at;
    };

    // 1. Five pictures dropped on the window: the overlay counts them, the table lists them as 이미지.
    await chapter('사진과 도판 다섯 장을 창에 끌어다 놓으면 이미지 자료로 들어옵니다. PNG, JPEG, WebP 모두 됩니다. (끌어 놓기는 스크립트로 재현합니다)', page, 6500);
    await pause(1500);
    await dropSource(page, pictures);
    const middle = await page.evaluate(() => ({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) }));
    await glide(page, 'main', middle.x, middle.y);
    await scriptedTag('끌어 놓기는 스크립트로 재현');
    await drag(page, 'dragenter', 'source');
    await drag(page, 'dragover', 'source');
    await expect(page.getByTestId('drop-summary')).toContainText(`${PICTURES.length}개`);
    await pause(4500);
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('import-done').filter({ hasText: `자료 ${PICTURES.length}개를 가져왔습니다` })).toBeVisible();
    for (const file of pictures) await expect(rowByTitle(page, titleOf(file)).locator('[data-col="type"]')).toHaveText('이미지');
    await scriptedTag(null);
    await park(page, 'main');
    await pause(10000);

    // 2. The photo: fitted on opening, a pinch about a point, a drag, a quarter turn, the dark ground.
    await chapter(`사진을 열면 창에 맞춰 보입니다. 핀치로 손가락 아래를 키우고, 끌어서 옮기고, ${key('CmdOrCtrl+R')}로 돌리고, 보기 메뉴에서 배경을 고릅니다. (핀치는 스크립트로 재현합니다)`, page, 6500);
    await pause(1200);
    await glideClick(page, 'main', rowByTitle(page, PHOTO_TITLE));
    await pause(400);
    await page.keyboard.press('Enter');
    await drawn();
    expect((await imageState(page))!.zoom).toBe('fit');
    await park(page, 'main');
    await pause(4500);
    const box = (await stage().boundingBox())!;
    const at = { x: Math.round(box.x + box.width * 0.6), y: Math.round(box.y + box.height * 0.42) };
    await glide(page, 'main', at.x, at.y);
    await scriptedTag('핀치는 스크립트로 재현');
    for (let i = 0; i < 24; i++) {
      await stage().evaluate((el, p) => void el.dispatchEvent(new WheelEvent('wheel', { deltaY: -6, ctrlKey: true, clientX: p.x, clientY: p.y, cancelable: true, bubbles: true })), at);
      await pause(45);
    }
    await expect(stage()).toHaveAttribute('data-pannable', '');
    await scriptedTag(null);
    await pause(3500);
    // A drag of the picture, as a reader moves a large picture about.
    await page.mouse.move(at.x, at.y);
    if (cursor !== 'synthetic') await drawnCursor(page, false);
    await page.mouse.down();
    await dragAlong(page, 'main', at.x, at.x - 300, at.y, at.y - 170);
    await pause(400);
    await page.mouse.up();
    if (cursor !== 'synthetic') await drawnCursor(page, true);
    await pause(3500);
    const turned = await press('r', ['command'], 'reader.rotateCw', async () => (await imageState(page))?.rotation === 90);
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);
    await afterKey(turned, 1800);
    await glideClick(page, 'main', page.locator('[data-testid="tab-panel"][data-active="true"] [data-testid="image-view-menu"]'));
    await pause(1500);
    await glideClick(page, 'main', page.getByRole('menuitemradio', { name: '어둡게' }));
    await expect(stage()).toHaveAttribute('data-bg', 'dark');
    await park(page, 'main');
    await pause(6500);

    // 3. The tab closed and opened again: the same zoom, the same point in the middle, the same turn.
    await chapter(`탭을 닫았다가 ${key('Shift+CmdOrCtrl+T')}로 다시 열어도 확대 배율과 보던 자리, 회전이 그대로 돌아옵니다.`, page, 6000);
    const before = (await imageState(page))!;
    const photoId = before.itemId;
    await pause(3000);
    const closed = await press('w', ['command'], 'tab.close', async () => (await page.locator('[data-testid="tab"]').count()) <= 1);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await afterKey(closed, 3000);
    const reopened = await press('t', ['command', 'shift'], 'tab.reopenClosed', async () => (await shownTab()) === photoId);
    await drawn();
    const after = (await imageState(page))!;
    expect(after.itemId).toBe(photoId);
    expect(after.rotation).toBe(before.rotation);
    expect(after.scale).toBeCloseTo(before.scale, 3);
    expect(Math.abs(after.cx - before.cx)).toBeLessThan(0.01);
    expect(Math.abs(after.cy - before.cy)).toBeLessThan(0.01);
    await afterKey(reopened, 6500);
    await park(page, 'main');
    await pause(2500);

    // 4. The quick search's scope: 정보와 본문.
    await chapter('라이브러리 검색 필드 앞의 단추로 검색 범위를 고릅니다. ‘정보와 본문’을 고르면 PDF 본문까지 찾습니다.', page, 6000);
    await afterKey(await backToLibrary(), 1000);
    await glideClick(page, 'main', page.getByTestId('search-scope'));
    await expect(scopeMenu).toBeVisible();
    await pause(5000);
    await glideClick(page, 'main', scopeMenu.getByRole('menuitemradio', { name: '정보와 본문', exact: true }));
    await expect(scopeMenu).toHaveCount(0);
    await expect(searchField).toHaveAttribute('placeholder', '제목, 저자, 태그, 본문 검색');
    await park(page, 'main');
    await pause(7000);

    // 5. A two-letter Korean word: the title that has it (marked) and the PDFs whose pages have it, together.
    await chapter(`한국어 두 글자 ‘${SEARCH_WORD}’로 찾으면 제목이 맞는 자료와 본문에 그 낱말이 있는 PDF가 함께 나옵니다. 표시는 제목이 맞은 곳에만 붙습니다.`, page, 6500);
    await glideClick(page, 'main', searchField);
    await pause(800);
    await page.keyboard.type(SEARCH_WORD, { delay: Math.round(500 * PACE) });
    await expect(searchField).toHaveValue(SEARCH_WORD);
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await expect(rowByTitle(page, MATCHES_TITLE)).toBeVisible();
    await expect(rowByTitle(page, TRASHED_TITLE)).toBeVisible();
    await expect(page.locator('[data-testid="item-row"] mark')).toHaveText([SEARCH_WORD]);
    await park(page, 'main');
    await pause(12000);

    // 6. The item panel's 본문 일치: the pages with the word, each with its words around it.
    await chapter('자료를 고르면 항목 패널 맨 위 ‘본문 일치’에 그 낱말이 나온 쪽과 앞뒤 글이 보입니다.', page, 6000);
    await glideClick(page, 'main', rowByTitle(page, MATCHES_TITLE));
    const matchRows = page.getByTestId('matches-section').getByTestId('match-row');
    await expect(matchRows.first()).toBeVisible();
    await park(page, 'main');
    await pause(12000);

    // 7. A page opened from it: the reader at that page, the find bar on the word, its match there marked.
    await chapter('쪽을 누르면 그 쪽에서 PDF가 열리고, 찾기 막대에 같은 낱말이 들어가 그 쪽의 일치가 강조됩니다.', page, 6000);
    const row = (await matchRows.count()) > 1 ? matchRows.nth(1) : matchRows.first();
    const pageNumber = await row.getAttribute('data-page');
    await glideClick(page, 'main', row);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
    await expect(page.getByTestId('pdf-find-field').getByRole('searchbox')).toHaveValue(SEARCH_WORD);
    await expect(page.locator(`[data-testid="tab-panel"][data-active="true"] .page[data-page-number="${pageNumber}"] .textLayer .highlight.selected`)).toBeVisible();
    await park(page, 'main');
    await pause(13000);

    // 8. Two notes come in while the index is held: the scope menu counts the PDFs read, and the line goes once they are.
    notes.push('chapter 8: a test hook holds the body index while the two notes come in and the menu opens, then lets it go (two short notes are read before a menu could open)');
    await chapter('새로 가져온 PDF는 뒤에서 본문을 색인합니다. 그동안 검색 범위 메뉴 아래에 색인 진행이 보이고, 끝나면 사라집니다. (파일 패널은 건너뛰고, 색인은 잠시 멈춰 둡니다)', page, 6500);
    await afterKey(await backToLibrary(), 800);
    await textExtraction(app, 'pause');
    await stubOpenDialog(app, media.extra);
    const imported = await press('o', ['command'], 'file.importManaged');
    await expect(page.getByTestId('import-done').filter({ hasText: `자료 ${media.extra.length}개를 가져왔습니다` })).toBeVisible();
    await afterKey(imported, 1200);
    const total = firstPdfs.length + media.extra.length;
    await expect.poll(indexProgress).toEqual({ done: firstPdfs.length, total });
    await glideClick(page, 'main', page.getByTestId('search-scope'));
    const progressLine = page.getByTestId('search-scope-progress');
    await expect(progressLine).toHaveText(new RegExp(`^본문 색인 ${firstPdfs.length}\\s/\\s${total}$`));
    await pause(6000);
    await textExtraction(app, 'now');
    await expect(progressLine).toHaveCount(0, { timeout: 30_000 });
    await pause(6000);
    await page.keyboard.press('Escape');
    await expect(scopeMenu).toHaveCount(0);
    await park(page, 'main');
    await pause(1500);

    // 9. A body match moved to the trash leaves the results.
    await chapter('본문이 일치한 자료도 휴지통으로 옮기면 검색 결과와 본문 일치에서 빠집니다.', page, 6000);
    await glideClick(page, 'main', rowByTitle(page, TRASHED_TITLE));
    await expect(page.getByTestId('matches-section').getByTestId('match-row').first()).toBeVisible();
    await pause(4000);
    const trashed = await press('Backspace', ['command'], 'item.trash', async () => (await rowByTitle(page, TRASHED_TITLE).count()) === 0, 51);
    await expect(rowByTitle(page, TRASHED_TITLE)).toHaveCount(0);
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await afterKey(trashed, 3500);
    await park(page, 'main');
    await pause(10500);

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
    for (const dir of [backups, restores, materialDir, pictureDir]) fs.rmSync(dir, { recursive: true, force: true });
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
    const txt = outFile('m7c-demo.chapters.raw.txt');
    const json = outFile('m7c-demo.chapters.json');
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
            'm7c-demo.chapters.raw.txt': 'the raw recording (m7c-demo.mov / .mp4): ms / 1000 − offset; late on the trimmed file',
            'm7c-demo.final.* and its .chapters.txt/.json': 'the trimmed video that viewers watch: scripts/finish-demo.sh writes them, with the cut head and the Mac file length applied',
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
    record({ file: txt.rel, kind: 'data', description: 'M7c demo chapter list on the RAW recording timeline (the trimmed video has its own list from finish-demo.sh)' });
    record({ file: json.rel, kind: 'data', description: 'M7c demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  expect.soft(overlayClashes, 'captions, the tag and the parked pointer keep clear of the sidebar\'s labels and tag chips').toEqual([]);
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M7c demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('m7c-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
