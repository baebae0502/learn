// @demo — a 3–4 minute macOS screen recording of M8a, the video reader and its subtitles (spec 15, "데모"): a video and its Korean subtitle file
// dropped on the library together; the video opened, K / J / L and the speed keys; the subtitle on the picture; the transcript (a sentence
// pressed, the list following the playhead, a search with ↩); an English subtitle dropped on the video's tab; the track changed and C;
// F for the full screen and back; the library's 정보와 본문 search finding a word only the subtitles have, its time row in the item panel and
// the video opening at that sentence; a subtitle removed and 실행 취소; and, after the app is closed and opened again, the same time and the
// same track — with a chapter list (m8a-demo.chapters.raw.txt / .json; the trimmed video's own list comes from finish-demo.sh), a caption
// per chapter on screen (합니다체), and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the server,
// scripts/record-demo-linux.sh on Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded. The app runs as a test
// build (LEARN_E2E) and reads PDF bodies as it does for a user (LEARN_TEXT_EXTRACTION=run). The M7a, M7b, M7c and T1a demos stay in git history.
//
// Honest, readable, polished, safe (as the T1a demo's fix rounds left it):
// - Every synthetic step is said: a drop from Finder is reproduced by the test tool (the captions say so, and a lasting tag is on screen
//   while it is), the app is closed and started once in the last chapter (its caption says so). The chapter line keeps the notes.
// - Real-looking content (demo-media.ts) in a readable library folder; the lecture is the 60-second fixture under a readable name, its two
//   subtitle files the fixtures written for this repository. Every state stays up long enough to read: a key whose result is the point keeps
//   2.5 s on the result after its pill has gone (afterKey); a caption stays as long as it takes to read. The pointer glides to what it
//   clicks, rests on it, and parks clear of the pill, the caption and the toasts.
// - On macOS one pointer: the system cursor moves (posted CGEvents, on a 120 Hz schedule), and the overlay draws only
//   a ring while a button is down (critique mac1 M1); with synthetic input (Linux) the overlay's disc is the pointer.
//   The app is a copy named Learn; the Dock is hidden; a neutral built-in desktop picture is behind it. Every Apple Event
//   may take 5 s at most, and a core shortcut that times out runs from its menu item instead (round 3 m2). The video's own keys are
//   single letters of the renderer's keymap (no menu item): they go to the page as keys on both platforms.
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
import { commandById, type CommandId } from '../../packages/domain/src/commands';
import { motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import {
  NativeInputNotPermitted, ROOT, bringAppToFront, importFiles, launch, nativeKeyCode, nativeKeystroke, openItem, osascriptLimits, rowByTitle, runMenuCommand, showItemPanel,
  stageState, textExtraction, textIdle, videoReady, waitImportIdle,
  drag, dropSource,
  type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionBottom, parkSpot as parkAt } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, glideCursor, hideDock, neutralDesktop, renamedElectron } from './demo-mac';
import { PDF_FOOTER, READ_TITLE, writeDemoMedia } from './demo-media';
import { RecordingLost, exitedEarly, lossOf, recordingLoss, type RecordingEnd } from './demo-loss';
import { mergeEnv } from './env';

/** The lecture the demo drops in: the 60-second fixture under a readable name; its subtitles are named after it, so the import pairs them. */
const LECTURE_TITLE = '세포막과 물질 수송 강의';
/** The word only the lecture's subtitles have (the library's search, the item panel's time rows, the transcript search). */
const QUERY = '칼슘 펌프';
/** The fixtures it copies from (fixtures/generated, made by `pnpm fixtures`): the video, the Korean SRT and the English VTT. */
const LECTURE_FILES = { video: 'lecture-60s.mp4', ko: 'lecture-60s.ko.srt', en: 'lecture-60s.en.vtt' } as const;

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
/** T13R2-m3: a caption stays as long as it takes to read at 12 characters a second: 3.5 s at least, 9 s at most. */
const captionMs = (text: string) => Math.min(9000, Math.max(3500, Math.round((text.length / 12) * 1000)));
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
  const lectureDir = path.join(work, '강의');
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
    /** The main window's sidebar as drawn now: the tag selector's top (null: none drawn) and the bottom of the last tree row or of the hint. */
    const sidebarNow = (p: Page) =>
      p.evaluate(() => {
        const tags = document.querySelector('.sidebar .tag-selector')?.getBoundingClientRect();
        const rows = [...document.querySelectorAll('[data-testid="sidebar-tree"] [role="row"]')].map((r) => r.getBoundingClientRect().bottom);
        // With no collections the tree shows a hint under its rows; the pointer must not rest on it.
        const hint = document.querySelector('[data-testid="sidebar-hint"]')?.getBoundingClientRect();
        if (hint && hint.height > 0) rows.push(hint.bottom);
        // A reader with no pages (a picture) shows a note in the sidebar instead: the pointer rests under it, not on the launcher.
        for (const note of document.querySelectorAll('[data-testid="reader-sidebar-empty"]')) {
          const r = note.getBoundingClientRect();
          if (r.height > 0) rows.push(r.bottom);
        }
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
    /**
     * Glides onto the middle of an element (or, with `at`, onto that fraction of its width), rests on it (`restMs`, 250 by
     * default), presses it (where the pointer already is: `at` also gives the press its place) and stays a beat. `timeout`
     * bounds the press, so a target that went away fails in seconds, not at the test's timeout.
     */
    const glideClick = async (
      p: Page,
      kind: WindowKind,
      target: Locator,
      opts: { modifiers?: Array<'Shift' | 'Meta' | 'Control'>; button?: 'right'; restMs?: number; timeout?: number; at?: number } = {},
    ) => {
      const box = (await target.boundingBox())!;
      const dx = box.width * (opts.at ?? 0.5);
      await glide(p, kind, box.x + dx, box.y + box.height / 2);
      await pause(opts.restMs ?? 250);
      await target.click({
        ...(opts.modifiers ? { modifiers: opts.modifiers } : {}),
        ...(opts.button ? { button: opts.button } : {}),
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        ...(opts.at !== undefined ? { position: { x: dx, y: box.height / 2 } } : {}),
      });
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
     * the section labels and the tag selector; the pill, the caption and the tag off a toast shown now (beside the tutor its column
     * reaches into the pill band); a parked pointer (`at`, its tip, the arrow 20 px below it) off the chips and the caption.
     * Anything found is recorded in overlayClashes, judged at the end.
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
        const pills = boxes('[data-testid="demo-pill"]:not([data-leaving])');
        for (const t of boxes('.toasts .toast')) {
          for (const [name, rects] of Object.entries({ pill: pills, caption: captions, tag: tags })) {
            for (const c of rects) if (hit(c, t)) out.push(`${name} ${at(c)} over a toast ${at(t)}`);
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
    // ---- the library, before anything is recorded ------------------------------------------------------------------------------
    // The demo's study notes and its two other videos, put in through the import path as a user would (the file panel is skipped), and
    // their bodies read: the library a lecture is then dropped into. The lecture and its two subtitle files wait in their own folder.
    const indexProgress = () => page.evaluate(() => window.learn.search.progress().then((r) => (r.ok ? r.data : null)));
    const pdfs = [media.read, ...media.drop].filter((f) => f.endsWith('.pdf'));
    await importFiles(s, [media.read, ...media.drop]);
    await waitImportIdle(page);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 15_000 });
    await textExtraction(app, 'now');
    await textIdle(app);
    await expect.poll(indexProgress).toEqual({ done: pdfs.length, total: pdfs.length });
    fs.mkdirSync(lectureDir, { recursive: true });
    const lecture = {
      video: path.join(lectureDir, `${LECTURE_TITLE}.mp4`),
      ko: path.join(lectureDir, `${LECTURE_TITLE}.ko.srt`),
      en: path.join(lectureDir, `${LECTURE_TITLE}.en.vtt`),
    };
    for (const k of ['video', 'ko', 'en'] as const) fs.copyFileSync(path.join(ROOT, 'fixtures/generated', LECTURE_FILES[k]), lecture[k]);
    await expect(rowByTitle(page, LECTURE_TITLE)).toHaveCount(0);
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm8a-demo', 'M8a demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 'm8a-demo', 'M8a demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 'm8a-demo', 'M8a demo (3–4 min)');
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
      'the lecture is the 60-second fixture video with its two subtitle files (Korean SRT, English VTT); Finder\'s drops (chapters 1 and 5) are reproduced with synthetic drag events over the files\' real paths, captioned and tagged; the video\'s keys (K, J, L, ⇧., ⇧,, C, F, esc) are keys of the page on both platforms (the renderer\'s keymap has no menu item for them); ⌘1 is a key (the menu item on Linux); the query and the pointer\'s presses are typed and clicked; the app is closed and started once in chapter 11 (a new window; the recording goes on)',
    );
    const shownTab = () => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id');
    const videoNow = () => page.evaluate(() => window.__learnVideo!.state());
    const lectureRow = () => rowByTitle(page, LECTURE_TITLE);
    const subtitlesButton = () => page.getByTestId('subtitles-menu');
    const overlay = () => page.getByTestId('subtitle-overlay');
    const transcriptField = () => page.getByTestId('transcript-search').getByRole('searchbox');
    const cueRow = (i: number) => page.locator(`[data-testid="cue-row"][data-index="${i}"]`);
    const typeDelay = Math.round(110 * PACE);
    /** A key of the video reader's keymap, sent to the page; returns when it went out (for afterKey). */
    const tap = async (k: string) => {
      const at = Date.now();
      await page.keyboard.press(k);
      return at;
    };
    /** The playhead is within `ms` of `at` (a seek lands on a frame). */
    const atTime = (at: number, within = 400) => expect.poll(async () => Math.abs(((await videoNow())?.timeMs ?? -1e9) - at), { message: `the video near ${at} ms`, timeout: 15_000 }).toBeLessThan(within);
    /** Opens a menu from its button and waits for it: a press while another menu is still closing lands on the page behind it. */
    const openSubtitles = async () => {
      await expect(page.getByRole('menu')).toHaveCount(0);
      await glideClick(page, 'main', subtitlesButton());
      await expect(page.getByRole('menu')).toBeVisible();
    };
    /** The stage of the window as main reports it (the full screen the F key asks for). */
    const stageIs = (on: boolean) => expect.poll(() => stageState(app).then((st) => st.stage && !st.pending), { timeout: 20_000, message: `the stage is ${on ? 'on' : 'off'}` }).toBe(on);

    // 1. The lecture and its Korean subtitle file dropped on the library together: the import pairs them by name.
    await chapter('동영상과 이름이 같은 자막 파일을 라이브러리에 함께 끌어 놓으면 자막이 그 동영상에 붙어 들어옵니다. (Finder의 끌어 놓기는 시험 도구로 재현합니다)', page, 7500);
    await scriptedTag('끌어 놓기는 스크립트로 재현');
    await pause(2500);
    await dropSource(page, [lecture.video, lecture.ko]);
    await drag(page, 'dragenter', 'source');
    await expect(page.getByTestId('drop-summary')).toContainText('동영상 1');
    await expect(page.getByTestId('drop-summary')).toContainText('자막 1');
    await pause(4000);
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('import-done')).toContainText('자막 1개');
    await expect(lectureRow()).toBeVisible();
    await scriptedTag(null);
    await park(page, 'main');
    await pause(5500);

    // 2. Opened by a double click, played with the pointer, then the keys: K, L, J, ⇧. and ⇧,.
    await chapter('동영상을 열고 재생합니다. K는 재생과 일시정지, L과 J는 10초 앞뒤로 갑니다. ⇧.와 ⇧,는 재생 속도를 바꿉니다.', page, 8000);
    await pause(1500);
    {
      const box = (await lectureRow().boundingBox())!;
      await glide(page, 'main', box.x + box.width / 2, box.y + box.height / 2);
      await pause(300);
      await lectureRow().dblclick();
      await releasePointer(page, 'main');
    }
    await videoReady(page);
    await expect(page.getByTestId('video-stage')).toBeVisible();
    await park(page, 'main');
    await pause(2500);
    await glideClick(page, 'main', page.getByTestId('video-play'));
    await expect.poll(async () => (await videoNow())?.timeMs ?? 0, { timeout: 20_000 }).toBeGreaterThan(2500);
    await afterKey(await tap('l'), 3000);
    await afterKey(await tap('j'), 3000);
    await afterKey(await tap('Shift+Period'), 3000);
    await expect.poll(async () => (await videoNow())?.rate ?? 1).toBeGreaterThan(1);
    await afterKey(await tap('Shift+Comma'), 2500);
    await expect.poll(async () => (await videoNow())?.rate ?? 0).toBe(1);
    await afterKey(await tap('k'), 2500);
    await expect.poll(async () => (await videoNow())?.paused).toBe(true);
    await park(page, 'main');

    // 3. The scrubber pressed near 6.6 s, the subtitle on the picture while it plays.
    await chapter('자막은 지금 재생 위치의 문장을 그림 아래에 보여 줍니다. 그림의 크기가 바뀌면 글자 크기도 따라 바뀝니다.', page, 7000);
    await pause(1500);
    await glideClick(page, 'main', page.getByTestId('video-scrubber'), { at: 0.11 });
    await atTime(6600, 2500);
    await pause(1000);
    await afterKey(await tap('k'), 500);
    await expect(overlay()).toBeVisible({ timeout: 15_000 });
    await park(page, 'main');
    await pause(5000);
    await tap('k');
    await expect.poll(async () => (await videoNow())?.paused).toBe(true);
    await pause(2500);

    // 4. The transcript: a sentence pressed, the list following the playhead, a search with ↩.
    await chapter('사이드바의 대본에는 자막 문장이 시각과 함께 나열됩니다. 문장을 누르면 그 시각으로 이동하고, 재생하면 목록이 현재 위치를 따라갑니다.', page, 8500);
    await expect(cueRow(0)).toBeVisible();
    await pause(2000);
    await glideClick(page, 'main', cueRow(7));
    await atTime(27_000, 300);
    await expect(cueRow(7)).toHaveAttribute('data-current', 'true');
    await pause(1500);
    await tap('k');
    await expect(cueRow(8)).toHaveAttribute('data-current', 'true', { timeout: 15_000 });
    await pause(2500);
    await tap('k');
    await expect.poll(async () => (await videoNow())?.paused).toBe(true);
    await park(page, 'main');
    await caption(lastCaptioned, '대본에서 찾기에 낱말을 쓰고 ↩를 누르면 일치하는 문장으로 차례로 이동하고, 끝에서는 처음부터 다시 돌아옵니다. ⇧↩는 거꾸로 갑니다.', 7000);
    await glideClick(page, 'main', transcriptField());
    await park(page, 'main');
    await page.keyboard.type(QUERY, { delay: typeDelay });
    await expect(page.getByTestId('transcript-count')).toHaveText('2개');
    await pause(1500);
    // ↩ goes to the first match on or after the playhead (30 s here), the next ↩ passes the end and comes round to the first one.
    await page.keyboard.press('Enter');
    await atTime(34_500, 300);
    await pause(3500);
    await page.keyboard.press('Enter');
    await atTime(19_000, 300);
    await expect(page.getByTestId('transcript-count')).toHaveText(/^처음부터\s· 1 \/ 2$/);
    await pause(4500);
    await page.keyboard.press('Escape');
    await expect(transcriptField()).toHaveValue('');
    await pause(1000);

    // 5. An English subtitle file dropped on the video's tab: the overlay while it is over, then the toast.
    await chapter('영상 탭에도 자막 파일을 끌어 놓을 수 있습니다. 영어 자막을 놓으면 이 동영상의 두 번째 자막으로 붙습니다. (끌어 놓기는 시험 도구로 재현합니다)', page, 8000);
    await scriptedTag('끌어 놓기는 스크립트로 재현');
    await pause(2500);
    await dropSource(page, [lecture.en]);
    await drag(page, 'dragenter', 'source');
    await expect(page.getByTestId('subtitle-drop-overlay')).toBeVisible();
    await expect(page.getByTestId('subtitle-drop-overlay')).toContainText('자막으로 붙이기');
    await pause(4000);
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('subtitle-drop-overlay')).toHaveCount(0);
    await expect(page.getByTestId('subtitle-attached')).toContainText('자막 1개를 붙였습니다');
    await scriptedTag(null);
    await park(page, 'main');
    await pause(5500);

    // 6. The subtitle menu chooses the English track; C turns the subtitle off and on.
    await chapter('자막 메뉴에서 자막을 고릅니다. 이름은 언어로 보입니다. C를 누르면 자막이 꺼지고, 한 번 더 누르면 켜집니다.', page, 7500);
    await openSubtitles();
    await pause(1500);
    await glideClick(page, 'main', page.getByRole('menuitemradio', { name: '영어' }));
    await expect(subtitlesButton()).toHaveText('영어');
    await expect(overlay()).toContainText('calcium');
    await park(page, 'main');
    await pause(4500);
    await afterKey(await tap('c'), 2500);
    await expect(subtitlesButton()).toHaveText('자막 끔');
    await expect(overlay()).toHaveCount(0);
    await afterKey(await tap('c'), 2500);
    await expect(subtitlesButton()).toHaveText('영어');
    await expect(overlay()).toContainText('calcium');
    await park(page, 'main');

    // 7. F: the window's full screen with the stage; the controls go when the pointer rests; F or esc comes back.
    await chapter('F는 영상을 전체 화면으로 봅니다. 포인터가 2초 멈추면 컨트롤이 사라지고 자막은 그대로 남습니다. F나 esc로 돌아옵니다.', page, 8500);
    await pause(1500);
    await tap('k');
    await expect.poll(async () => (await videoNow())?.paused).toBe(false);
    const entered = await tap('f');
    await stageIs(true);
    await expect(page.locator('html')).toHaveAttribute('data-video-stage', '');
    await afterKey(entered, 8000);
    const left = await tap('Escape');
    await stageIs(false);
    await expect(page.locator('html')).not.toHaveAttribute('data-video-stage');
    await afterKey(left, 2500);
    await tap('k');
    await expect.poll(async () => (await videoNow())?.paused).toBe(true);
    await park(page, 'main');
    await pause(1500);

    // 8. The library: 정보와 본문 finds a word only the subtitles have; the item panel lists the sentences with their times.
    await chapter('라이브러리의 검색 범위를 ‘정보와 본문’으로 두면 자막에만 있는 낱말로도 동영상을 찾습니다.', page, 7500);
    const library = await press('1', ['command'], 'nav.back', async () => (await shownTab()) === 'library');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await afterKey(library, 2500);
    await showItemPanel(app, page);
    await glideClick(page, 'main', page.getByTestId('search-scope'));
    const scopeMenu = page.getByRole('menu', { name: '검색 범위' });
    await expect(scopeMenu).toBeVisible();
    await pause(1500);
    await glideClick(page, 'main', scopeMenu.getByRole('menuitemradio', { name: '정보와 본문', exact: true }));
    await expect(scopeMenu).toHaveCount(0);
    const search = page.getByTestId('search-field').locator('input');
    await glideClick(page, 'main', search);
    await park(page, 'main');
    await page.keyboard.type(QUERY, { delay: typeDelay });
    await expect(lectureRow()).toBeVisible();
    const lectureId = (await lectureRow().getAttribute('data-item-id'))!;
    await glideClick(page, 'main', lectureRow());
    const section = page.getByTestId('matches-section');
    await expect(section.getByTestId('matches-count')).toHaveText('문장 2개');
    await park(page, 'main');
    await pause(6000);

    // 9. A time row pressed: the video opens at that sentence, the transcript search holding the word.
    await chapter('‘본문 일치’의 시간 행을 누르면 동영상이 그 문장의 시각에서 열리고, 대본 검색에 찾은 낱말이 들어 있습니다.', page, 7500);
    const timeRow = section.getByRole('listbox', { name: '본문 일치' }).locator('[data-testid="match-row"]').filter({ has: page.locator('.pg', { hasText: '0:34' }) });
    await expect(timeRow).toBeVisible();
    await pause(1500);
    await glideClick(page, 'main', timeRow);
    await expect.poll(shownTab).toBe(lectureId);
    await atTime(34_500, 300);
    await expect(transcriptField()).toHaveValue(QUERY);
    expect((await videoNow())!.paused).toBe(true);
    await expect(cueRow(9)).toHaveAttribute('data-current', 'true');
    await park(page, 'main');
    await pause(6500);

    // 10. A subtitle removed from its menu; 실행 취소 brings it back, in its place and shown.
    await chapter('자막 메뉴의 ‘이 자막 제거’로 자막을 뺍니다. 알림의 ‘실행 취소’를 누르면 같은 자리에 같은 모습으로 돌아옵니다.', page, 8000);
    await openSubtitles();
    await pause(1500);
    const shownTrack = (await videoNow())!.trackId;
    await glideClick(page, 'main', page.getByRole('menuitem', { name: '이 자막 제거' }));
    const removed = page.getByTestId('subtitle-removed');
    await expect(removed).toContainText('자막을 제거했습니다');
    await expect(subtitlesButton()).toHaveText('영어');
    // The arrow goes onto 실행 취소 at once and the toast holds while the pointer is on it (react-aria's hover hold), so nothing here is
    // timed against its 5 s; it rests there about 1.5 s with the label readable, and the press comes where it rests.
    const undoAction = removed.getByTestId('undo-action');
    const undoBox = (await undoAction.boundingBox())!;
    await glide(page, 'main', undoBox.x + undoBox.width * 0.85, undoBox.y + undoBox.height / 2);
    await glideClick(page, 'main', undoAction, { at: 0.85, restMs: 1500, timeout: 3000 });
    await expect(subtitlesButton()).toHaveText('한국어');
    await expect.poll(async () => (await videoNow())?.trackId).toBe(shownTrack);
    await park(page, 'main');
    await pause(5000);

    // 11. The app closed and opened again: the same time, the same track.
    await chapter('앱을 종료했다가 다시 열면 같은 시각에서 같은 자막으로 돌아옵니다. (앱을 한 번 닫았다가 다시 엽니다)', page, 6500);
    await pause(2500);
    const before = (await videoNow())!;
    // The place is saved as it is made (the track at once, the time on the reader's timer): the poll waits for both.
    await expect
      .poll(
        () =>
          page.evaluate(async (id) => {
            const r = await window.learn.reader.getPosition({ itemId: id });
            const loc = r.ok ? r.data?.locator : null;
            return loc && loc.kind === 'video' ? { timeMs: loc.timeMs, track: loc.captions?.assetId ?? null, on: loc.captions?.on ?? null } : null;
          }, before.itemId),
        { timeout: 20_000 },
      )
      .toEqual({ timeMs: expect.any(Number), track: before.trackId, on: true });
    await app.close();
    s = await launch(libraryDir, userData, launchOptions);
    app = s.app;
    onRestore('the app (closing it again)', () => app.close());
    page = s.page;
    await drawFor(page);
    await park(page, 'main');
    // The new window has its own overlay, which starts empty: the caption is shown again here.
    await caption({ target: page }, '앱을 종료했다가 다시 열면 같은 시각에서 같은 자막으로 돌아옵니다.', 6000);
    await videoReady(page);
    await expect(subtitlesButton()).toHaveText('한국어');
    await atTime(before.timeMs, 1500);
    expect(await shownTab()).toBe(before.itemId);
    expect((await videoNow())!.trackId).toBe(before.trackId);
    await expect(overlay()).toBeVisible();
    await park(page, 'main');
    await pause(9000);

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
    for (const dir of [backups, restores, materialDir, lectureDir]) fs.rmSync(dir, { recursive: true, force: true });
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
    const txt = outFile('m8a-demo.chapters.raw.txt');
    const json = outFile('m8a-demo.chapters.json');
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
            'm8a-demo.chapters.raw.txt': 'the raw recording (m8a-demo.mov / .mp4): ms / 1000 − offset; late on the trimmed file',
            'm8a-demo.final.* and its .chapters.txt/.json': 'the trimmed video that viewers watch: scripts/finish-demo.sh writes them, with the cut head and the Mac file length applied',
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
    record({ file: txt.rel, kind: 'data', description: 'M8a demo chapter list on the RAW recording timeline (the trimmed video has its own list from finish-demo.sh)' });
    record({ file: json.rel, kind: 'data', description: 'M8a demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  expect.soft(overlayClashes, 'captions, the tag, the pill and the parked pointer keep clear of the sidebar\'s labels and tag chips and of the toasts').toEqual([]);
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('M8a demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('m8a-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
