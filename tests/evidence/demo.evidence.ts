// @demo — a 2–4 minute macOS screen recording of the M3 shell with a chapter list (m3-demo.chapters.txt / .json), a
// caption per chapter on screen, and the chapters embedded in the video afterwards (scripts/finish-demo.sh on the
// server, scripts/record-demo-linux.sh on Linux). Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded.
//
// Honest, readable, polished, safe (Task 13 fix round 1):
// - Every synthetic step is said: the drag is "스크립트로 재현", ⌘O "건너뜁니다" the file panel; both in the chapter line
//   and on screen.
// - Real-looking content (demo-media.ts) in a readable library folder; each state stays up long enough to read; the
//   pointer glides to what it clicks and parks clear of the pill, the caption and the toasts.
// - On macOS one pointer: the system cursor moves (posted CGEvents) and the overlay's cursor follows it; the app is a
//   copy named Learn; the Dock is hidden. Every Mac-only step that fails writes a note and the demo carries on from a
//   known state; the core chapters keep their assertions.
// - The recording runs RECORD_SECONDS and is trimmed to the demo afterwards, with the start offset measured here.
//
// Display spike (Task 13): before launching, the demo switches the main screen to the best mode displayplacer lists
// (display.ts) and puts it back afterwards; env.json records displayModes and displaySwitch.
//
// scripts/record-demo-linux.sh records it on Linux too: LEARN_DEMO_PACE=1 (full pace), LEARN_DEMO_SCALE=2
// (--force-device-scale-factor) and LEARN_DEMO_GRAB=<w>x<h>+<x>,<y> (ffmpeg x11grab of exactly the window).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { acceleratorLabel } from '../../packages/domain/src/accelerator';
import { commandById, commandLabel, type CommandId } from '../../packages/domain/src/commands';
import {
  NativeInputNotPermitted, ROOT, bringAppToFront, closeSheet, drag, dropSource, expectWindow, launch, mainWindow, nativeKeystroke, osascript, runMenuCommand,
  stubOpenDialog, type KeyModifier, type LaunchOptions, type Session,
} from '../e2e/helpers';
import { IS_MAC, outFile, record, startRecording, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo } from './display-mac';
import { closeFinderWindow, dragCursor, glideCursor, hideDock, openFinderWindow, renamedElectron } from './demo-mac';
import { READ_TITLE, UNPLAYABLE_TITLE, writeDemoMedia } from './demo-media';
import { mergeEnv } from './env';

const PACE = IS_MAC || process.env['LEARN_DEMO_PACE'] === '1' ? 1 : 0.1;
/**
 * The macOS recording's fixed length (screencapture -V): longer than any plausible demo (Linux at full pace: see the
 * Task 13 report; macOS adds the full-screen and Finder chapters and System Events), then trimmed on the server to
 * the demo plus 2 s (scripts/finish-demo.sh, from chapters.json `demoSeconds` and `offset`). A demo that still outran
 * it fails at the end, after its files are written.
 */
const RECORD_SECONDS = 220;
const SCALE = !IS_MAC && /^[1-4]$/.test(process.env['LEARN_DEMO_SCALE'] ?? '') ? Number(process.env['LEARN_DEMO_SCALE']) : 1;
const GRAB = (() => {
  const m = IS_MAC ? null : /^(\d+)x(\d+)\+(\d+),(\d+)$/.exec(process.env['LEARN_DEMO_GRAB'] ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null;
})();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Time to look at a settled state (not a wait for one: those are expect / waitFor). */
const pause = (ms: number) => sleep(ms * PACE);
/** A shortcut as this platform's menus write it (⌘O on macOS, Ctrl+O elsewhere). */
const key = (accelerator: string) => acceleratorLabel(accelerator, process.platform);
const label = (id: CommandId) => commandLabel(commandById(id), process.platform);
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));

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

type WindowKind = 'main' | 'settings';
/**
 * How the demo moves the pointer. synthetic: Playwright's mouse, drawn by the overlay (Linux; macOS when the system
 * cursor cannot be moved at all). system: macOS, the system cursor through posted CGEvents, which the overlay's cursor
 * follows (one pointer, T13-M8 a). warp: macOS when posting is refused: the system cursor is warped and the overlay's
 * cursor hidden (T13-M8 b); Playwright's mouse still gives the hover.
 */
type CursorMode = 'synthetic' | 'system' | 'warp';

test('M3 demo recording with chapters', { tag: '@demo' }, async () => {
  test.setTimeout(600_000);
  const work = path.join(os.tmpdir(), 'learn-demo');
  fs.mkdirSync(work, { recursive: true });
  const libraryDir = libraryFolder(work);
  // A local folder left by an interrupted run would start the demo with its items (CI's home folder is never reused).
  if (libraryDir.startsWith(work)) fs.rmSync(libraryDir, { recursive: true, force: true });
  const userData = fs.mkdtempSync(path.join(work, 'userdata-'));
  const notes: string[] = [];
  const input = { native: 0, menu: 0 };
  const chapters: Array<{ at: number; ms: number; title: string }> = [];
  let s: Session | null = null;
  let rec: Recording | null = null;
  /** x11grab recordings end when told; macOS screencapture after RECORD_SECONDS. */
  let stopRec: StoppableRecording['stop'] | null = null;
  let started = Date.now();
  let recordingExitMs: number | null = null;
  let demoSeconds = 0;
  let screen: unknown = null;
  // Widened on purpose: glide() changes it from inside a closure, where narrowing cannot see.
  let cursor = (IS_MAC ? 'system' : 'synthetic') as CursorMode;
  let restoreDock: (() => Promise<void>) | null = null;
  /** A macOS-only step: any failure is a note, then `recover` puts a known state back (review minor 2). */
  const macStep = async (what: string, run: () => Promise<void>, recover: () => Promise<void> = async () => {}) => {
    try {
      await run();
    } catch (e) {
      notes.push(`${what}: ${errorText(e)}`);
      await recover().catch((e2: unknown) => notes.push(`${what}: recovering failed: ${errorText(e2)}`));
    }
  };

  const media = await writeDemoMedia(path.join(work, '자료'));
  const display = await switchDisplayForDemo();
  let launchOptions: LaunchOptions = {
    env: { LEARN_DEMO_OVERLAY: '1' },
    // The page follows the theme pref through nativeTheme, as on a user's Mac (no light emulation; Task 8 M1).
    colorScheme: null,
    ...(SCALE !== 1 ? { args: [`--force-device-scale-factor=${SCALE}`] } : {}),
  };
  if (IS_MAC) {
    await macStep('Dock autohide', async () => {
      restoreDock = await hideDock();
    });
    await macStep('the app copy named Learn (the plain Electron binary runs instead)', async () => {
      const executablePath = await renamedElectron(path.join(work, 'app'));
      launchOptions = { ...launchOptions, executablePath, args: [path.join(ROOT, 'apps/desktop')] };
    });
  } else notes.push('the full-screen and Finder-in-front chapters are macOS only: not in this recording');

  try {
    s = await launch(libraryDir, userData, launchOptions);
    const app = s.app;
    const page = s.page;
    // The screen as Electron reads it now (after a display switch: the re-read the spike asks for).
    screen = await app.evaluate(({ BrowserWindow, screen }) => {
      const d = screen.getPrimaryDisplay();
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'));
      return { display: { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }, window: w?.getBounds() ?? null, content: w?.getContentBounds() ?? null };
    });
    const shownDisplay = (screen as { display: { bounds: { width: number; height: number } } }).display;
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
    const drawnCursor = (p: Page, shown: boolean) =>
      p.isClosed() ? Promise.resolve() : p.evaluate((hidden) => dispatchEvent(new CustomEvent('learn:demo-pointer', { detail: { hidden } })), !shown).catch(() => {});
    /** Hides the overlay's own cursor in every demo window (the system cursor is the one pointer, T13-M8 b). */
    const hideDrawnCursor = async () => {
      for (const p of [page, ...settingsPages]) await drawnCursor(p, false);
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
      if (entered && cursor !== 'warp') await drawnCursor(entered, true);
      pointerIn = kind;
    };
    /** Moves the pointer to (x, y) of a window's page, as the current cursor mode does it. */
    const glide = async (p: Page, kind: WindowKind, x: number, y: number) => {
      await pointerTo(kind);
      if (cursor !== 'synthetic') {
        const o = await originOf(kind);
        const r = await glideCursor({ x: o.x + x, y: o.y + y }).catch((e: unknown) => {
          notes.push(`moving the system cursor failed (${errorText(e)}): the drawn cursor only`);
          return { moved: false, warped: false };
        });
        if (cursor === 'system' && !r.moved) {
          cursor = r.warped ? 'warp' : 'synthetic';
          notes.push(
            r.warped
              ? 'posting mouse events was refused: the system cursor is warped and the drawn cursor hidden (T13-M8 b)'
              : 'the system cursor could not be moved: the drawn cursor only (two pointers may show)',
          );
          if (cursor === 'warp') await hideDrawnCursor();
        }
        if (cursor === 'system') return;
        await p.mouse.move(x, y); // warp: the hover; synthetic: the drawn cursor
        return;
      }
      await p.mouse.move(x, y, { steps: 16 });
    };
    /** Glides onto the middle of an element, then presses it (Playwright's click lands where the pointer already is). */
    const glideClick = async (p: Page, kind: WindowKind, target: ReturnType<Page['getByTestId']>) => {
      const box = (await target.boundingBox())!;
      await glide(p, kind, box.x + box.width / 2, box.y + box.height / 2);
      await target.click();
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
    /** A chapter starts: its time, and its title as the on-screen caption (T13-m4). */
    const chapter = async (title: string) => {
      const ms = Date.now() - started;
      chapters.push({ at: Math.floor(ms / 1000), ms, title });
      await page.evaluate((text) => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: text })), title);
    };
    /** A shortcut: the real key through System Events on macOS (NSMenu sees it), else the menu item's own click(). */
    const press = async (k: string, modifiers: KeyModifier[], fallback: CommandId | (() => Promise<unknown>)) => {
      if (IS_MAC) {
        try {
          await nativeKeystroke(app, k, modifiers);
          input.native++;
          return;
        } catch (e) {
          if (!(e instanceof NativeInputNotPermitted)) throw e;
          notes.push(`System Events refused a key (${e.message}): menu click instead`);
        }
      }
      input.menu++;
      if (typeof fallback === 'function') await fallback();
      else await runMenuCommand(app, fallback);
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
    const firstTitle = page.getByTestId('open-item').first();
    const html = page.locator('html');
    const backToLibrary = async () => {
      if (await page.getByTestId('viewer-back').isVisible()) await runMenuCommand(app, 'nav.back');
      await expect(page.getByTestId('library-table')).toBeVisible();
    };

    if (IS_MAC) await bringAppToFront(app);
    await park(page, 'main');
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm3-demo', 'M3 shell demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      rec = x11;
      stopRec = () => x11.stop();
    } else {
      rec = startRecording(RECORD_SECONDS, 'm3-demo', 'M3 shell demo (2–4 min)');
      void rec.done.then(() => (recordingExitMs = Date.now()));
    }
    started = Date.now();

    // 1. First run: the empty library says how to bring files in.
    await chapter('Learn을 처음 열면 빈 라이브러리가 가져오는 방법을 안내합니다.');
    await expect(page.getByTestId('content').getByRole('button').first()).toBeVisible();
    await pause(4500);

    // 2. Files dragged in (a synthetic drag of real files: a Finder drag cannot be scripted): the window becomes the
    //    drop target; holding ⌥ / Alt switches to linking; releasing it switches back.
    const { w: mainW, h: mainH } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await dropSource(page, media.drop);
    await chapter(`파일을 창으로 끌어 오면 창 전체가 놓을 곳이 됩니다. ${key('Alt')} 키를 누르고 있으면 연결로 바뀝니다. (끌기는 스크립트로 재현)`);
    const overlay = page.getByTestId('drop-overlay');
    await glide(page, 'main', 14, mainH * 0.55); // the pointer comes in from the window's left edge
    await drag(page, 'dragenter', 'source');
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
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

    // 3. Dropped: copies imported, the result in a toast.
    await chapter('놓으면 사본으로 가져오고, 결과를 알림으로 알려 줍니다.');
    await drag(page, 'drop', 'source');
    await expect(rows).toHaveCount(media.drop.length);
    await expect(page.getByTestId('import-done')).toBeVisible();
    await park(page, 'main');
    await pause(3500);

    // 4. ⌘O, one file: the one F6 and ↩ will open. The file panel is skipped (said in the chapter line and caption).
    await stubOpenDialog(app, [media.read]);
    await chapter(`${key('CmdOrCtrl+O')} 키로도 가져올 수 있습니다. 결과는 알림으로 뜹니다. (데모에서는 파일 선택 창을 건너뜁니다)`);
    await press('o', ['command'], 'file.importManaged');
    await expect(rows).toHaveCount(media.drop.length + 1);
    await expect(firstTitle).toHaveAttribute('data-title', READ_TITLE);
    // The drop's toast can still be up: this one is the ⌘O result (one item).
    const toast = page.getByTestId('import-done').filter({ hasText: '1개' });
    await expect(toast).toBeVisible();
    await pause(3300);

    // 5. ⇧F6 from nowhere goes to the last pane, the toast (while it is up; the focus holds it), then F6 cycles on:
    //    내 라이브러리 (the accent fill, no ring), the first title (its ring); ↩ opens it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // n1: a reset, not a gesture
    await chapter(`${key('F6')} / ${key('Shift+F6')} 키로 사이드바, 표, 알림 패널 사이를 옮겨 다닙니다.`);
    if (await toast.isVisible()) {
      await page.keyboard.press('Shift+F6');
      await expect.poll(() => inPane(page)).toBe('toasts');
      await pause(2500);
    } else notes.push('the ⌘O toast had closed before ⇧F6 reached it');
    await page.keyboard.press('F6');
    await expect(page.getByTestId('nav-library')).toBeFocused();
    await pause(2500);
    await page.keyboard.press('F6');
    await expect(firstTitle).toBeFocused();
    await pause(3500);
    await page.keyboard.press('Enter');

    // 6. The PDF reader: page 1, then the next page.
    await chapter('PDF를 열어 다음 쪽으로 넘깁니다.');
    const canvas = page.getByTestId('pdf-canvas');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await pause(3500);
    const indicator = page.getByTestId('pdf-page-indicator');
    const pageOne = await indicator.textContent();
    await glideClick(page, 'main', page.getByTestId('pdf-next'));
    await park(page, 'main');
    await expect(indicator).not.toHaveText(pageOne ?? '');
    await expect(canvas).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await pause(3500);

    // 7. macOS: full screen, where the title strip shows the window title, which follows the view; then back to the
    //    frame. Elsewhere: back to the library.
    if (IS_MAC) {
      await chapter(`${key('Ctrl+Cmd+F')} 키로 전체 화면에 들어가도 위쪽 제목 띠에 지금 보는 화면의 이름이 나옵니다.`);
      const before = await (await win()).evaluate((w) => w.getBounds());
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
      await macStep(
        'full screen',
        async () => {
          await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(true)));
          await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
          await settle('full screen fills the screen', fillsScreen);
          const fullW = await page.evaluate(() => innerWidth);
          await glide(page, 'main', fullW / 2, 1); // the menu bar and the title strip ("세포 신호 전달 개요") come down
          await pause(3500);
          await park(page, 'main');
          await pause(1000);
          await press('1', ['command'], 'nav.back');
          await expect(page.getByTestId('library-table')).toBeVisible();
          await glide(page, 'main', fullW / 2, 1); // the strip now says 내 라이브러리
          await pause(3000);
          await park(page, 'main');
          await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(false)));
          await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
          await settle('the window is back at its frame', async () => JSON.stringify(await (await win()).evaluate((w) => w.getBounds())) === JSON.stringify(before));
          await park(page, 'main');
          await pause(1500);
        },
        async () => {
          if (await isFull()) {
            await (await win()).evaluate((w) => w.setFullScreen(false));
            await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
            await sleep(1500);
          }
          await bringAppToFront(app);
          await backToLibrary();
        },
      );
      await backToLibrary();
    } else {
      await chapter(`${key('CmdOrCtrl+1')} 키를 누르면 라이브러리로 돌아갑니다.`);
      await press('1', ['command'], 'nav.back');
      await expect(page.getByTestId('library-table')).toBeVisible();
      await pause(2500);
    }

    // 8. A video this platform cannot play: why, and what to do next.
    await chapter(`재생할 수 없는 동영상은 이유를 알리고 ‘${label('item.showInFolder')}’와 ‘${label('item.openExternally')}’를 권합니다.`);
    await glideClick(page, 'main', page.locator(`[data-testid="open-item"][data-title="${UNPLAYABLE_TITLE}"]`));
    await park(page, 'main');
    await expect(page.getByTestId('video-error')).toBeVisible();
    await pause(2200);
    const reveal = (await page.getByTestId('codec-reveal').boundingBox())!;
    await glide(page, 'main', reveal.x + reveal.width / 2, reveal.y + reveal.height / 2); // pointed at, not pressed
    await pause(1600);
    await park(page, 'main');
    await pause(1200);
    await press('1', ['command'], 'nav.back');
    await expect(page.getByTestId('library-table')).toBeVisible();

    // 9. ⌃⌘S, then the boundary dragged wider and back.
    await chapter(`${key('Ctrl+Cmd+S')} 키로 사이드바를 접고, 경계를 끌어 폭을 바꿉니다.`);
    const shell = page.getByTestId('shell');
    await press('s', ['control', 'command'], 'view.toggleSidebar');
    await expect(shell).toHaveAttribute('data-sidebar', 'hidden');
    await pause(4000);
    await press('s', ['control', 'command'], 'view.toggleSidebar');
    await expect(shell).toHaveAttribute('data-sidebar', 'shown');
    await pause(2000);
    const sidebarWidth = () => page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    const width0 = await sidebarWidth();
    const sep = (await page.locator('#pane-separator').boundingBox())!;
    const y = Math.round(sep.y + sep.height * 0.5);
    const x0 = Math.round(sep.x + sep.width / 2);
    /** One drag of the separator: the system cursor's own press and drag on macOS, Playwright's mouse elsewhere. */
    const dragSeparator = async (from: number, to: number) => {
      await glide(page, 'main', from, y);
      if (cursor === 'system') {
        const o = await originOf('main');
        if (await dragCursor({ x: o.x + from, y: o.y + y }, { x: o.x + to, y: o.y + y }).catch(() => false)) return;
        notes.push('the system cursor could not drag the separator: Playwright drags it');
      }
      await page.mouse.move(from, y);
      await page.mouse.down();
      await page.mouse.move(to, y, { steps: 30 });
      await page.mouse.up();
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
    await press('k', ['command'], 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    const paletteCursor = page.locator('[data-testid="palette-item"][data-focused]');
    await expect(paletteCursor).toHaveAttribute('data-command-id', 'file.importManaged');
    await pause(3000);
    for (const ch of ['ㅅ', 'ㅈ']) {
      await page.keyboard.insertText(ch);
      await expect(page.getByTestId('palette-input')).toHaveValue(new RegExp(`${ch}$`));
      await pause(1000);
    }
    await expect(paletteCursor).toHaveAttribute('data-command-id', 'app.settings');
    await pause(2000);
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));
    settingsPages.push(settings);
    if (cursor === 'warp') await hideDrawnCursor();

    // 11a. The settings window is a window of its own: the main window behind it is not main, so its chrome dims.
    await chapter('설정은 따로 뜨는 창이고, 뒤의 메인 창은 흐려집니다.');
    if (IS_MAC) await expect(html).toHaveAttribute('data-window-not-main', '');
    else await settle('the main window is not main behind the settings window', async () => (await html.getAttribute('data-window-not-main')) !== null, 3000);
    await park(settings, 'settings');
    await pause(3500);

    // 11b. Density and text size reach the main window at once. The settings window moves aside first, as a user may,
    //      so the list behind it shows the change.
    await chapter('밀도와 글자 크기는 메인 창에 바로 반영됩니다.');
    await app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const main = all.find((w) => w.webContents.getURL().includes('window=main'))!;
      const set = all.find((w) => w.webContents.getURL().includes('window=settings'))!;
      const m = main.getBounds();
      const b = set.getBounds();
      set.setPosition(Math.max(m.x, m.x + m.width - b.width - 24), b.y);
    });
    await park(settings, 'settings');
    await pause(800);
    for (const [id, attr, value, look] of [
      ['density-compact', 'data-density', 'compact', 3000],
      ['font-size-15', 'data-font-size', '15', 3000],
      ['density-regular', 'data-density', 'regular', 1500],
      ['font-size-13', 'data-font-size', '13', 1500],
    ] as const) {
      await glideClick(settings, 'settings', settings.getByTestId(id));
      await park(settings, 'settings'); // off the segment: its "pt" tooltip never opens
      await expect(html).toHaveAttribute(attr, value);
      await pause(look);
    }

    // 11c. The theme changes both windows together.
    await chapter('테마는 두 창이 함께 바뀝니다.');
    await glideClick(settings, 'settings', settings.getByTestId('theme-tile-dark'));
    await park(settings, 'settings');
    await expect.poll(() => isDark(page)).toBe(true);
    await expect.poll(() => isDark(settings)).toBe(true);
    await pause(3000);
    await closeSettings(settings);
    if (IS_MAC) await expect(html).not.toHaveAttribute('data-window-not-main', '');
    await park(page, 'main');

    // 12. Dark: the same screens and information — the populated list, the palette over it.
    await chapter('다크 모드에서도 같은 화면, 같은 정보입니다.');
    await pause(2000);
    await press('k', ['command'], 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await pause(2500);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    await pause(1500);

    // 13. macOS: another app in front — a Finder window — and the Learn window turns inactive; then back.
    if (IS_MAC) {
      await chapter('다른 앱이 앞에 오면 Learn 창은 비활성으로 흐려집니다.');
      await macStep(
        'Finder in front',
        async () => {
          const b = await (await win()).evaluate((w) => w.getBounds());
          const d = (screen as { display: { bounds: { x: number; y: number; width: number; height: number } } }).display.bounds;
          const left = Math.min(b.x + b.width * 0.5, d.x + d.width - 440);
          const top = Math.min(b.y + b.height * 0.3, d.y + d.height - 320);
          openFinderWindow([left, top, left + 420, top + 300]);
          await expect(html).toHaveAttribute('data-window-inactive', '', { timeout: 5000 });
          if (cursor !== 'synthetic') {
            await pointerTo('elsewhere');
            await glideCursor({ x: left + 210, y: top + 150 });
          }
          await pause(4000);
          closeFinderWindow();
          await bringAppToFront(app);
          await expect(html).not.toHaveAttribute('data-window-inactive', '');
          await park(page, 'main');
          await pause(1000);
        },
        async () => {
          try {
            closeFinderWindow();
          } catch {
            /* no Finder window to close */
          }
          await bringAppToFront(app);
          await park(page, 'main');
        },
      );
    }

    // 14. ⌘/: the shortcut sheet as it is (F6 / ⇧F6 under 앱); ↩ closes it.
    await chapter(`${key('CmdOrCtrl+/')} 키로 단축키 도움말을 엽니다. ${key('F6')} / ${key('Shift+F6')}도 있습니다.`);
    const sheet = await expectWindow(app, 'sheet', () => press('/', ['command'], 'app.shortcuts'));
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: 'F6' }).first()).toBeVisible();
    await pause(5000);
    await closeSheet(sheet, 'Enter');

    // 15. The end: the populated library in dark, held.
    await chapter('Learn 둘러보기를 마칩니다.');
    await park(page, 'main');
    await pause(3000);

    demoSeconds = Math.round((Date.now() - started) / 100) / 10;
    if (!stopRec && rec?.file) {
      // screencapture -V stops by itself; finish-demo.sh trims the rest away.
      const left = RECORD_SECONDS - (Date.now() - started) / 1000;
      if (left > 0) await sleep(left * 1000 + 1000);
    } else await pause(2000); // the tail of an x11grab recording
  } finally {
    const entry = stopRec ? await stopRec() : rec ? await rec.done : null;
    await s?.app.close().catch(() => {});
    if (restoreDock) await (restoreDock as () => Promise<void>)().catch((e: unknown) => notes.push(`restoring the Dock failed: ${errorText(e)}`));
    await display.restore();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(libraryDir, { recursive: true, force: true });
    // macOS: the recording began when screencapture's first frame did, RECORD_SECONDS before it exited (T13-m9).
    const offset = recordingExitMs !== null ? Math.max(0, Math.round(((recordingExitMs - started) / 1000 - RECORD_SECONDS) * 10) / 10) : 0;
    const inVideo = (c: { ms: number }) => Math.max(0, Math.floor(c.ms / 1000 - offset));
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const txt = outFile('m3-demo.chapters.txt');
    const json = outFile('m3-demo.chapters.json');
    fs.writeFileSync(txt.abs, chapters.map((c) => `${mmss(inVideo(c))} ${c.title}`).join('\n') + '\n');
    fs.writeFileSync(
      json.abs,
      `${JSON.stringify(
        {
          recording: entry?.file ?? null,
          recordingError: entry?.error ?? entry?.skipped ?? null,
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
          notes,
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
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
});
