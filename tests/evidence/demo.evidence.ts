// @demo — a 3–4 minute macOS screen recording of the T1a tutor (spec 16.5) with the fake agent: ⌃⌘2 and the consent card; the
// chooser, where the fake of a development build is started (Claude Code is not installed for the recording); a passage dragged over
// and a question; the tool chips and the answer as it comes; a cite chip, its page and the page's outline, ⌘[ back; 출처 없음 and
// 원문 근거로 다시 묻기; offline, the question kept in the composer; the 세션 pane and a name; ⌘⌫ and 실행 취소; the library's 세션
// section — with a chapter list (t1a-demo.chapters.raw.txt / .json; the trimmed video's own list comes from finish-demo.sh), a
// caption per chapter on screen (합니다체), and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the server,
// scripts/record-demo-linux.sh on Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded. The app runs as a test
// build (LEARN_E2E: the fake agent shows, the agent search is an empty folder) and reads PDF bodies as it does for a user
// (LEARN_TEXT_EXTRACTION=run). The M7a, M7b and M7c demos stay in git history.
//
// Honest, readable, polished, safe (Task 13 fix rounds 1 and 2):
// - Every synthetic step is said: the agent is the fake (the chooser and its band say so), the offline turn "시험 훅으로
//   재현합니다" (in its caption, and a lasting tag while it is on screen), the answer that cites a page it did not read "일부러"
//   (its caption); the older sessions written before the recording are never opened. The chapter line keeps the notes.
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
import { commandById, type CommandId } from '../../packages/domain/src/commands';
import { motion } from '../../apps/desktop/src/renderer/src/design/tokens';
import type { LearnPdfProbe } from '../../apps/desktop/src/renderer/src/viewers/pdf/anchorProbe';
import {
  NativeInputNotPermitted, ROOT, bringAppToFront, importFiles, launch, nativeKeyCode, nativeKeystroke, openItem, osascriptLimits, rowByTitle, runMenuCommand, seedSessions,
  textExtraction, textIdle, tutorFakeScript, tutorNetwork, waitImportIdle,
  type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startScreencast, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo, type DisplaySwitch } from './display-mac';
import { captionBottom, parkSpot as parkAt } from './demo-geometry';
import { pressKey } from './demo-keys';
import { OSASCRIPT_MS, glideCursor, hideDock, neutralDesktop, renamedElectron, warpTo } from './demo-mac';
import { PDF_FOOTER, READ_TITLE, writeDemoMedia } from './demo-media';
import { RecordingLost, exitedEarly, lossOf, recordingLoss, type RecordingEnd } from './demo-loss';
import { mergeEnv } from './env';
import { nextFakeScript } from '../e2e/tutor-helpers';

declare global {
  interface Window {
    /** The PDF reader's E2E probe (e2e=1 only): a selection made with it when a drag over the page left none. */
    __learnPdf?: LearnPdfProbe;
  }
}

/** What the demo asks and names (spec 16.5): questions about the note it reads, "세포 신호 전달 개요". */
const QUESTIONS = { first: '증폭이 왜 중요한가요?', second: '이 문장을 쉽게 풀어 주세요.', offline: '신호를 끄는 방법도 알려 주세요.' } as const;
/** Sentences of the note's page 1, each on one line: the passages the demo attaches. */
const PASSAGES = { first: '신호 전달의 핵심은 증폭과 조절이다.', second: '세포는 주변 환경의 변화를 화학 신호로 받아들인다.' } as const;
const SESSION_NAME = '신호 증폭 정리';
/** The older sessions written before the recording (never opened on camera): yesterday's and an earlier day's of the note, two of another. */
const SEEDED = {
  yesterday: 'GPCR과 RTK는 무엇이 다른가요?',
  earlier: '탈감작을 예를 들어 설명해 주세요',
  earlierAt: new Date(2026, 10, 3, 10, 12).toISOString(),
  otherTitle: '단백질 접힘 강의 노트',
  other: ['샤페론은 어떤 일을 하나요?', '잘못 접힌 단백질은 어떻게 되나요?'],
} as const;

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
    // ---- the library and its older sessions, before anything is recorded --------------------------------------------------
    // The demo's study notes and its two videos, put in through the import path as a user would (the file panel is skipped), and their
    // bodies read: the tutor reads the pages it cites from that index. Two older sessions of the notes the demo reads and two of
    // another note are written by a test hook (seedSessions): they fill the 세션 pane's days and the library's 세션 section, and none
    // is opened on camera (their answers are the hook's). The note opens in the reader on 정보, as a reader that was used before.
    const indexProgress = () => page.evaluate(() => window.learn.search.progress().then((r) => (r.ok ? r.data : null)));
    const pdfs = [media.read, ...media.drop].filter((f) => f.endsWith('.pdf'));
    await importFiles(s, [media.read, ...media.drop]);
    await waitImportIdle(page);
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 15_000 });
    await textExtraction(app, 'now');
    await textIdle(app);
    await expect.poll(indexProgress).toEqual({ done: pdfs.length, total: pdfs.length });
    const idOf = async (title: string) => (await rowByTitle(page, title).getAttribute('data-item-id'))!;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(16, 52, 0, 0);
    const readId = await idOf(READ_TITLE);
    await seedSessions(app, { itemId: readId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: yesterday.toISOString(), questions: [SEEDED.yesterday] });
    await seedSessions(app, { itemId: readId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: SEEDED.earlierAt, questions: [SEEDED.earlier] });
    await seedSessions(app, { itemId: await idOf(SEEDED.otherTitle), sessions: 2, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: SEEDED.earlierAt, questions: SEEDED.other });
    notes.push('the 세션 pane\'s two older sessions and the library section\'s other note are seeded by a test hook before the recording; none is opened on camera');
    // The reader has used Learn before: translation was answered 사용 안 함, so its offer never pops up over a selection (no translation
    // request is ever made). The fake answers at a viewer's pace (its demo scripts).
    await page.evaluate(async () => {
      const r = await window.learn.prefs.get();
      if (!r.ok) throw new Error(r.code);
      const done = await window.learn.prefs.set({ translation: { ...r.data.translation, enabled: false } });
      if (!done.ok) throw new Error(done.code);
    });
    await tutorFakeScript(app, 'demo');
    notes.push('translation was set to 사용 안 함 before the recording (as a returning reader has it); the fake runs its demo-paced scripts (demo, demo-unverified)');
    await openItem(page, READ_TITLE);
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]/);
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'info');
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 't1a-demo', 'T1a demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      recordingStartMs = Date.now(); // ffmpeg has opened the screen and its file
      rec = x11;
      stopRec = () => x11.stop();
    } else if (plan.capture === 'screencast') {
      // The last resort: the main window's page through CDP (no native chrome, menus, sheets or Finder in it).
      const cast = await startScreencast(page, 't1a-demo', 'T1a demo: the main window page only (CDP screencast)');
      recordingStartMs = Date.now();
      stopRec = () => cast.stop();
      notes.push('the recording is the main window page only (CDP screencast): screencapture was lost three times');
    } else {
      rec = startRecording(RECORD_SECONDS, 't1a-demo', 'T1a demo (3–4 min)');
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
      'the fake agent answers throughout (Claude Code is not installed for the recording: its row says 설치 안 됨); a test hook sets the fake\'s script between turns — the answer that cites a page it did not read is one of them, and its caption says so; the offline turn is a test setting too, captioned and tagged; the passages are selected by dragging the pointer over the page; ⌃⌘2, ⌘[, ⌥⌘5, ⌘⌫ and ⌘1 are keys (the menu items on Linux); the questions and the name are typed; the rest is clicked by the pointer',
    );
    const shownTab = () => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id');
    const mode = () => page.getByTestId('inspector').getAttribute('data-mode');
    const composer = page.getByTestId('tutor-input');
    const answers = page.getByTestId('tutor-answer');
    const log = page.getByTestId('tutor-log');
    const field = page.getByTestId('pdf-page-field');
    const accel = (id: CommandId) => key(commandById(id).accelerator!);
    /**
     * A sentence of page `n` selected as a reader does it: the pointer pressed on its first letter and dragged to its last, along its
     * line. The passage attaches itself to the next question; a drag that left nothing is made by the reader's own probe (a note).
     */
    const selectSentence = async (sentence: string, n: number) => {
      const at = await page.evaluate(([sentence, n]) => {
        const layer = document.querySelector(`[data-testid="tab-panel"][data-active="true"] .page[data-page-number="${n}"] .textLayer`);
        if (!layer) return null;
        const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
          const from = t.data.indexOf(sentence);
          if (from < 0) continue;
          const range = document.createRange();
          range.setStart(t, from);
          range.setEnd(t, from + sentence.length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          const first = rects[0]!;
          const last = rects.at(-1)!;
          return { x0: first.left + 2, x1: last.right - 2, y: first.top + first.height / 2 };
        }
        return null;
      }, [sentence, n] as const);
      const label = page.getByTestId('tutor-attached-label');
      let attached = false;
      if (at !== null) {
        await glide(page, 'main', at.x0, at.y);
        await pause(300);
        // While the system arrow is the pointer it is the drag's only cursor: the overlay's drawn one goes for the drag (as M7c's did).
        if (cursor !== 'synthetic') await drawnCursor(page, false);
        await page.mouse.down();
        await dragAlong(page, 'main', at.x0, at.x1, at.y);
        await page.mouse.up();
        if (cursor !== 'synthetic') await drawnCursor(page, true);
        attached = await expect(label).toContainText(sentence.slice(0, 8), { timeout: 5000 }).then(() => true, () => false);
      }
      if (!attached) {
        notes.push(`the drag over "${sentence}" attached nothing (${at === null ? 'not one run of text' : 'no selection'}): the reader's probe selected it`);
        const text = await page.evaluate((i) => window.__learnPdf!.pageText(i), n - 1);
        const from = text.indexOf(sentence);
        await page.evaluate(async ([i, s, e]) => window.__learnPdf!.selectText(i!, s!, e!), [n - 1, from, from + sentence.length] as const);
        await expect(label).toContainText(sentence.slice(0, 8));
      }
    };

    /** The pointer rests on a chip's right third: its label stays clear of the drawn pointer, and its tooltip still comes. */
    const hoverRightThird = async (target: Locator) => {
      const box = (await target.boundingBox())!;
      await glide(page, 'main', box.x + (box.width * 5) / 6, box.y + box.height / 2);
    };

    // 1. ⌃⌘2: the right panel turns to the tutor, which asks first — the consent card — and 동의 turns it on.
    await chapter(`${accel('view.inspectorTutor')}로 오른쪽 패널을 튜터로 바꿉니다. 처음에는 동의 카드가 먼저 나와, 질문과 함께 무엇을 어디로 보내는지 알려 줍니다.`, page, 6500);
    await pause(2500);
    const turned = await press('2', ['control', 'command'], 'view.inspectorTutor', async () => (await mode()) === 'tutor');
    await expect(page.getByTestId('tutor-consent')).toBeVisible();
    await afterKey(turned, 8000);
    await glideClick(page, 'main', page.getByTestId('tutor-consent-agree'));
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await park(page, 'main');
    await pause(1500);

    // 2. The chooser: Claude Code is not installed here; the fake agent of a development build is chosen and started.
    await chapter('동의하면 에이전트를 고릅니다. 이 녹화에는 Claude Code가 없어 개발·데모 빌드 전용 가짜 에이전트로 시작합니다. 가짜는 정해 둔 답을 돌려줍니다.', page, 7500);
    await expect(page.getByTestId('agent-row').and(page.locator('[data-agent="claude"]')).getByTestId('agent-flag')).toHaveText('설치 안 됨');
    await pause(5500);
    await glideClick(page, 'main', page.getByTestId('agent-dev-group').getByTestId('agent-row'));
    await expect(page.getByTestId('agent-start')).toHaveText('가짜 에이전트로 시작');
    await park(page, 'main');
    await pause(2000);
    await glideClick(page, 'main', page.getByTestId('agent-start'));
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('tutor-fake-band')).toBeVisible();
    await park(page, 'main');
    await pause(4000);

    // 3. A passage of page 1 selected: it attaches itself (a chip in the composer, a mark on the page); a question typed.
    await chapter('본문에서 구간을 고르면 그 구간이 다음 질문에 붙습니다. 입력창에는 칩으로, 쪽 위에는 표시로 남습니다.', page, 6000);
    await pause(1500);
    await selectSentence(PASSAGES.first, 1);
    await expect(page.getByTestId('tutor-attached')).toBeVisible();
    await pause(3000);
    await glideClick(page, 'main', composer);
    await page.keyboard.type(QUESTIONS.first, { delay: Math.round(110 * PACE) });
    await expect(composer).toHaveValue(QUESTIONS.first);
    await park(page, 'main');
    await pause(2000);

    // 4. ↩: the tool chips, then the answer as it comes.
    await chapter('↩로 보내면 튜터가 붙인 구간과 목차를 확인하고 그 쪽을 읽은 뒤 답합니다. 도구 칩이 무엇을 읽었는지 보여 주고, 답은 받는 대로 흘러나옵니다.', page, 6500);
    await pause(1500);
    await composer.focus();
    await page.keyboard.press('Enter');
    await expect(answers.first().getByTestId('tool-chip')).toHaveText(['선택한 구간 확인', '목차 확인', '1–2쪽 읽음'], { timeout: 30_000 });
    await expect(answers.first()).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
    await park(page, 'main');
    await pause(7000);

    // 5. Its cite chips: the pages this turn read.
    await chapter('답 안의 ‘2쪽’ 같은 인용 칩은 튜터가 이번 답에서 실제로 읽은 쪽만 가리킵니다. 누르면 그 쪽으로 갑니다.', page, 6000);
    const chip = answers.first().getByTestId('cite-chip').filter({ hasText: '2쪽' }).first();
    await expect(chip).toBeInViewport();
    await pause(1500);
    await hoverRightThird(chip);
    await pause(4500);

    // 6. Pressed: the reader at that page, its outline for a moment, the chip current; ⌘[ comes back.
    await chapter(`리더가 그 쪽으로 가고 쪽 둘레가 잠깐 강조됩니다. 칩에는 지금 보는 쪽이라는 테두리가 남고, ${accel('nav.historyBack')}로 돌아옵니다.`, page, 6500);
    await pause(800);
    await glideClick(page, 'main', chip);
    await expect(field).toHaveValue('2');
    await expect(chip).toHaveClass(/\bis-current\b/);
    // Away from the chip at once: its current border shows, and goes once ⌘[ has left the page.
    await park(page, 'main');
    await pause(6000);
    const back = await press('[', ['command'], 'nav.historyBack', async () => (await field.inputValue()) === '1');
    await expect(field).toHaveValue('1');
    await afterKey(back, 2500);
    await park(page, 'main');

    // 7. An answer that cites a page it did not read: 출처 없음, its notice, and 원문 근거로 다시 묻기 — a turn that reads it first.
    await nextFakeScript(page, app, 'demo-unverified');
    // The caption stays until the 출처 없음 chips are there to see, and some seconds more (the next caption takes its place).
    await chapter('튜터가 읽지 않은 쪽을 가리키면 그 인용은 ‘출처 없음’이 되고, 답 아래에 안내가 붙습니다. (가짜 에이전트가 일부러 읽지 않은 쪽을 가리키게 했습니다)', page, 60_000);
    await pause(1000);
    await selectSentence(PASSAGES.second, 1);
    await glideClick(page, 'main', composer);
    await page.keyboard.type(QUESTIONS.second, { delay: Math.round(110 * PACE) });
    await page.keyboard.press('Enter');
    const unverified = answers.nth(1);
    await expect(unverified).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
    await expect(unverified.getByTestId('cite-chip').filter({ hasText: '출처 없음' })).toHaveCount(2);
    await park(page, 'main');
    await pause(3000);
    const none = unverified.getByTestId('cite-chip').filter({ hasText: '출처 없음' }).first();
    await none.scrollIntoViewIfNeeded();
    await hoverRightThird(none);
    await pause(4000);
    await nextFakeScript(page, app, 'demo');
    await caption(lastCaptioned, '‘원문 근거로 다시 묻기’를 누르면 튜터가 그 쪽을 먼저 읽고 다시 답합니다. 이번에는 그 쪽이 확인된 인용이 됩니다.', 6000);
    const reground = page.getByTestId('tutor-reground');
    await reground.scrollIntoViewIfNeeded();
    await pause(1500);
    await glideClick(page, 'main', reground);
    await expect(answers).toHaveCount(3);
    await expect(page.getByTestId('tutor-question').last().locator('.bubble p')).toHaveText('1쪽을 먼저 읽고 다시 답해 주세요.');
    await expect(answers.nth(2)).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
    await expect(answers.nth(2).getByTestId('cite-chip').first()).toHaveText('1쪽');
    await park(page, 'main');
    await pause(8000);

    // 8. Offline: nothing is sent, the question stays in the composer; once online one ↩ sends it.
    await chapter('인터넷에 연결되어 있지 않으면 아무것도 보내지 않고 그렇다고 알립니다. 질문은 입력창에 그대로 남습니다. (연결 끊김은 시험용 설정으로 재현합니다)', page, 6500);
    await tutorNetwork(app, 'offline');
    await scriptedTag('연결 끊김은 시험용 설정으로 재현');
    // The column at its end, where the next turn's place is.
    const end = (await log.boundingBox())!;
    await glide(page, 'main', end.x + end.width / 2, end.y + end.height / 2);
    await page.mouse.wheel(0, 20_000);
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(24);
    await pause(1000);
    await glideClick(page, 'main', composer);
    await page.keyboard.type(QUESTIONS.offline, { delay: Math.round(110 * PACE) });
    await page.keyboard.press('Enter');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'OFFLINE');
    await expect(failure).toBeInViewport();
    await expect(composer).toHaveValue(QUESTIONS.offline);
    await park(page, 'main');
    await pause(7000);
    await tutorNetwork(app, null);
    await scriptedTag(null);
    await caption(lastCaptioned, '연결이 돌아온 뒤 입력창에서 ↩ 한 번으로 보냅니다. 저절로 다시 보내지는 않습니다.', 5000);
    await pause(2500);
    await composer.focus();
    await page.keyboard.press('Enter');
    await expect(failure).toHaveCount(0);
    await expect(answers.last()).toHaveAttribute('data-status', 'complete', { timeout: 30_000 });
    await park(page, 'main');
    await pause(4000);

    // 9. ⌥⌘5: the 세션 pane, by day; ↩ names the tab's session in place.
    await chapter(`${accel('reader.showSessions')}로 왼쪽에 이 자료의 세션을 엽니다. 날짜별로 묶여 있고, 행을 고른 뒤 ↩로 이름을 바꿉니다.`, page, 6500);
    const shown = await press('5', ['option', 'command'], 'reader.showSessions', async () => (await page.getByTestId('reader-sessions').count()) > 0);
    const rows = page.getByTestId('reader-sessions').getByTestId('session-row');
    await expect(rows).toHaveCount(3);
    // The older sessions on screen (here, in chapter 10 and in the library) were written before the recording: a lasting tag says so.
    await scriptedTag('이전 세션은 녹화 전에 넣어 둠');
    const current = page.locator('[data-testid="reader-sessions"] [data-testid="session-row"][aria-selected="true"]');
    await expect(current).toHaveText(QUESTIONS.first);
    await afterKey(shown, 3500);
    await glideClick(page, 'main', current);
    // The pointer away before the name is typed, so it covers none of it.
    await park(page, 'main');
    await page.keyboard.press('Enter');
    const name = page.getByTestId('session-name-input');
    await expect(name).toBeFocused();
    await pause(1500);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(SESSION_NAME, { delay: Math.round(110 * PACE) });
    await pause(800);
    await page.keyboard.press('Enter');
    await expect(name).toHaveCount(0);
    await expect(current).toHaveText(SESSION_NAME);
    await expect(page.getByTestId('tutor-session-head').locator('.t')).toHaveText(SESSION_NAME);
    await park(page, 'main');
    await pause(6500);

    // 10. ⌘⌫ deletes the session at once; 실행 취소 brings it back.
    await chapter(`${accel('item.trash')}로 세션을 지우면 목록에서 곧바로 사라지고, 알림의 ‘실행 취소’로 되돌립니다.`, page, 6000);
    await glideClick(page, 'main', current);
    await press('Backspace', ['command'], 'item.trash', async () => (await rows.count()) === 2, 51);
    await expect(rows).toHaveCount(2);
    const undo = page.getByTestId('session-undo');
    await expect(undo).toBeVisible();
    // The toast stays 5 s: 실행 취소 is pressed while its pill still shows.
    await pause(1800);
    await glideClick(page, 'main', undo.getByTestId('undo-action'));
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: SESSION_NAME })).toHaveCount(1);
    await park(page, 'main');
    await pause(4500);

    // 11. The library's 세션 section: the notes talked about last, each with its newest sessions; a row opens its note on that session.
    await chapter('라이브러리 사이드바의 ‘세션’ 묶음에는 최근 튜터에게 물어본 자료가 세션과 함께 모입니다. 행을 누르면 그 자료와 세션이 함께 열립니다.', page, 6500);
    const library = await press('1', ['command'], 'nav.back', async () => (await shownTab()) === 'library');
    const section = page.getByTestId('library-sessions');
    await expect(section).toBeVisible();
    await afterKey(library, 4000);
    await glideClick(page, 'main', section.getByTestId('session-row').filter({ hasText: SESSION_NAME }));
    await expect.poll(() => shownTab()).toBe(readId);
    await expect(page.getByTestId('tutor-session-head').locator('.t')).toHaveText(SESSION_NAME);
    expect(await mode()).toBe('tutor');
    await park(page, 'main');
    await pause(10000);
    await scriptedTag(null);

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
    const txt = outFile('t1a-demo.chapters.raw.txt');
    const json = outFile('t1a-demo.chapters.json');
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
            't1a-demo.chapters.raw.txt': 'the raw recording (t1a-demo.mov / .mp4): ms / 1000 − offset; late on the trimmed file',
            't1a-demo.final.* and its .chapters.txt/.json': 'the trimmed video that viewers watch: scripts/finish-demo.sh writes them, with the cut head and the Mac file length applied',
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
    record({ file: txt.rel, kind: 'data', description: 'T1a demo chapter list on the RAW recording timeline (the trimmed video has its own list from finish-demo.sh)' });
    record({ file: json.rel, kind: 'data', description: 'T1a demo chapters, offset, input, cursor, screen, display switch, notes' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  if (loss) return { lost: loss };
  expect.soft(overlayClashes, 'captions, the tag and the parked pointer keep clear of the sidebar\'s labels and tag chips').toEqual([]);
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
  return { lost: null };
}

test('T1a demo recording with chapters', { tag: '@demo' }, async () => {
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
  const json = outFile('t1a-demo.chapters.json').abs;
  try {
    const written = JSON.parse(fs.readFileSync(json, 'utf8')) as { notes: string[] };
    fs.writeFileSync(json, `${JSON.stringify({ ...written, notes: [...history, ...written.notes.filter((n) => !history.includes(n))] }, null, 2)}\n`);
  } catch {
    /* nothing written: the error below says it */
  }
  throw new Error(`the demo recording was lost every time: ${history.join(' | ')}`);
});
