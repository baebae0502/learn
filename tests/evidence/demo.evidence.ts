// @demo — a 2–4 minute macOS screen recording of the M3 shell with a chapter list (m3-demo.chapters.txt / .json). Real
// ⌘ keys through System Events; the demo overlay (LEARN_DEMO_OVERLAY=1) draws the pointer and the keys, which neither
// synthetic input nor the recording shows. Elsewhere (Linux CI) the same script runs at 1/10 pace, unrecorded.
//
// Display spike (Task 13): before launching, the demo switches the main screen to the best mode displayplacer lists
// (display.ts) and puts it back afterwards, so the suites after it measure the runner's own screen; env.json records
// displayModes and displaySwitch, with the screen as the launched app's Electron re-reads it.
//
// scripts/record-demo-linux.sh records it on Linux too: LEARN_DEMO_PACE=1 (full pace), LEARN_DEMO_SCALE=2
// (--force-device-scale-factor) and LEARN_DEMO_GRAB=<w>x<h>+<x>,<y> (ffmpeg x11grab of that region, which must be
// exactly the window: checked below).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { acceleratorLabel } from '../../packages/domain/src/accelerator';
import { commandById, commandLabel, type CommandId } from '../../packages/domain/src/commands';
import {
  FIXTURES, NativeInputNotPermitted, bringAppToFront, bringFinderToFront, closeSheet, drag, expectWindow, launch, mainWindow, nativeKeystroke, openItem, osascript,
  runMenuCommand, stubOpenDialog, type KeyModifier, type Session,
} from '../e2e/helpers';
import { IS_MAC, movePointer, outFile, record, startRecording, startX11Recording, type Recording, type StoppableRecording } from './capture';
import { savedDisplayModes, switchDisplayForDemo } from './display-mac';
import { mergeEnv } from './env';

const PACE = IS_MAC || process.env['LEARN_DEMO_PACE'] === '1' ? 1 : 0.1;
/**
 * The macOS recording's fixed length (screencapture -V): the chapters at full pace on the runner plus a short tail.
 * Linux at full pace: 120 s (Task 13 report). macOS drops the Linux-only ⌘1 chapter (−3 s) and adds full screen
 * (≈ 17 s with both animations), Finder (≈ 7 s) and System Events for 12 keys (≈ 4 s): ≈ 146 s, plus 2 s of tail and
 * 12 s of margin for a runner not measured here. chapters.json `demoSeconds` gives the real total to tighten it. A
 * demo that outruns the recording fails at the end (its last chapters would be missing from the video).
 */
const RECORD_SECONDS = 160;
const SCALE = !IS_MAC && /^[1-4]$/.test(process.env['LEARN_DEMO_SCALE'] ?? '') ? Number(process.env['LEARN_DEMO_SCALE']) : 1;
const GRAB = (() => {
  const m = IS_MAC ? null : /^(\d+)x(\d+)\+(\d+),(\d+)$/.exec(process.env['LEARN_DEMO_GRAB'] ?? '');
  return m ? { width: Number(m[1]), height: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null;
})();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Time to look at a settled state (not a wait for one: those are expect / waitFor). */
const pause = (ms: number) => sleep(ms * PACE);
/** Imported newest first in the list: sample.pdf ends up on the first row, where F6 and ↩ open it. */
const FILES = ['sample-mpeg4part2.mp4', 'sample-h264-aac.mp4', '한글 경로 (테스트) #1.pdf', 'sample.pdf'].map((f) => path.join(FIXTURES, f));
const DROPPED = [['ch06.pdf', 'application/pdf'], ['paper.pdf', 'application/pdf'], ['lecture.mp4', 'video/mp4']] as const;
/** A shortcut as this platform's menus write it (⌘O on macOS, Ctrl+O elsewhere). */
const key = (accelerator: string) => acceleratorLabel(accelerator, process.platform);
const label = (id: CommandId) => commandLabel(commandById(id), process.platform);

/** Which pane holds the focus (data-pane), or null. */
const inPane = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
const isDark = (page: Page) => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);

test('M3 demo recording with chapters', { tag: '@demo' }, async () => {
  test.setTimeout(480_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-demo-'));
  const display = await switchDisplayForDemo();
  let s: Session | null = null;
  let rec: Recording | null = null;
  /** x11grab recordings end when told (macOS screencapture after RECORD_SECONDS). */
  let stopRec: StoppableRecording['stop'] | null = null;
  const chapters: Array<{ at: number; ms: number; title: string }> = [];
  const notes: string[] = [];
  const input = { native: 0, menu: 0 };
  let started = Date.now();
  let demoSeconds = 0;
  let screen: unknown = null;
  try {
    s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), {
      env: { LEARN_DEMO_OVERLAY: '1' },
      // The page follows the theme pref through nativeTheme, as on a user's Mac (no light emulation; Task 8 M1).
      colorScheme: null,
      ...(SCALE !== 1 ? { args: [`--force-device-scale-factor=${SCALE}`] } : {}),
    });
    const app = s.app;
    const page = s.page;
    // The screen as Electron reads it now (after a display switch: the re-read the spike asks for).
    screen = await app.evaluate(({ BrowserWindow, screen }) => {
      const d = screen.getPrimaryDisplay();
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'));
      return { display: { bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor }, window: w?.getBounds() ?? null, content: w?.getContentBounds() ?? null };
    });
    if (display.result.status === 'switched') {
      const d = (screen as { display: { bounds: { width: number; height: number } } }).display.bounds;
      const to = display.result.to!;
      display.result.electron = (screen as { display: unknown }).display;
      // displayplacer said yes; the screen the app got is what counts.
      if (d.width !== to.width || d.height !== to.height) {
        const from = display.result.from;
        display.result.status = from && d.width === from.width && d.height === from.height ? 'unavailable' : 'switched';
        display.result.reason = `Electron reads ${d.width}×${d.height} after asking for ${to.width}×${to.height}`;
      }
    } else display.result.electron = (screen as { display: unknown }).display;
    if (GRAB) {
      // The recorded region must be the window itself, at @SCALE: no 1 px shrink, no strip of the X root around it.
      const want = { x: GRAB.x / SCALE, y: GRAB.y / SCALE, width: GRAB.width / SCALE, height: GRAB.height / SCALE };
      expect((screen as { window: unknown }).window, 'the window fills the recorded region').toEqual(want);
      expect((screen as { content: unknown }).content, 'the page fills the window (frameless)').toEqual(want);
    }

    const chapter = (title: string) => {
      const ms = Date.now() - started;
      chapters.push({ at: Math.floor(ms / 1000), ms, title });
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
    const bounds = async () => (await win()).evaluate((w) => w.getBounds());
    /** macOS: rest the real pointer on the content's empty bottom, where it hovers nothing (no tooltip). */
    const restPointer = async () => {
      if (!IS_MAC) return;
      const b = await bounds();
      await movePointer(b.x + Math.round(b.width * 0.62), b.y + b.height - 40);
    };
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
        const isKey = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('window=settings') ?? false);
        if (isKey) {
          try {
            osascript('tell application "System Events" to keystroke "w" using command down');
            input.native++;
            if (await Promise.race([closed.then(() => true), sleep(5000).then(() => false)])) return;
            notes.push('⌘W did not close the settings window within 5 s');
          } catch (e) {
            if (!(e instanceof NativeInputNotPermitted)) throw e;
            notes.push(`System Events refused ⌘W (${e.message})`);
          }
        } else notes.push('the settings window was not the key window: closed without ⌘W');
      }
      input.menu++;
      await settings.close();
      await closed;
    };
    const rows = page.getByTestId('item-row');
    const firstTitle = page.getByTestId('open-item').first();

    if (IS_MAC) await bringAppToFront(app);
    await restPointer();
    if (GRAB) {
      const x11 = await startX11Recording(GRAB, 'm3-demo', 'M3 shell demo (Linux, Pretendard, no native chrome)', RECORD_SECONDS + 120);
      rec = x11;
      stopRec = () => x11.stop();
    } else rec = startRecording(RECORD_SECONDS, 'm3-demo', 'M3 shell demo (2–4 min)');
    started = Date.now();

    // 1. First run.
    chapter('레이아웃 B 셸의 첫 실행 화면입니다.');
    await expect(page.getByTestId('content').getByRole('button').first()).toBeVisible();
    await page.mouse.move(700, 430, { steps: 12 });
    await pause(8000);

    // 2. The window-wide drop overlay (a synthetic drag from Finder: a real one cannot be scripted).
    chapter(`파일을 창에 끌어 놓으면 사본으로 가져오고, ${key('Alt')}를 누르면 연결합니다.`);
    const overlay = page.getByTestId('drop-overlay');
    await drag(page, 'dragenter', DROPPED);
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await pause(5000);
    await drag(page, 'dragover', DROPPED, { altKey: true });
    await expect(overlay).toHaveAttribute('data-mode', 'link');
    await pause(5000);
    await drag(page, 'dragover', DROPPED);
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await pause(2000);
    await drag(page, 'dragleave', DROPPED);
    await expect(overlay).toHaveCount(0);
    await pause(2000);

    // 3. ⌘O: four files, the result as a toast (success closes by itself after 5 s; focus or hover holds it).
    chapter(`${key('CmdOrCtrl+O')}로 파일을 가져오면 결과가 알림으로 뜹니다.`);
    await stubOpenDialog(app, FILES);
    await press('o', ['command'], 'file.importManaged');
    await expect(rows).toHaveCount(FILES.length);
    const toast = page.getByTestId('import-done');
    await expect(toast).toBeVisible();
    await expect(firstTitle).toHaveAttribute('data-title', 'sample');
    await pause(1500);

    // 4. F6 / ⇧F6 from nowhere: 내 라이브러리 (accent fill, no ring), the first title (focus ring), the toast, back.
    chapter(`F6으로 사이드바, 목록, 알림 사이를 옮겨 다닙니다.`);
    const content = (await page.getByTestId('content').boundingBox())!;
    await page.mouse.click(content.x + content.width * 0.6, content.y + content.height - 40); // nothing there takes the focus
    await pause(400);
    await page.keyboard.press('F6');
    await expect(page.getByTestId('nav-library')).toBeFocused();
    await pause(900);
    await page.keyboard.press('F6');
    await expect(firstTitle).toBeFocused();
    await pause(900);
    if (await toast.isVisible()) {
      await page.keyboard.press('F6');
      await expect.poll(() => inPane(page)).toBe('toasts');
      await pause(2200);
      await page.keyboard.press('Shift+F6');
      await expect(firstTitle).toBeFocused();
      await pause(2500);
    } else notes.push('the import toast had closed before F6 reached it');
    await page.keyboard.press('Enter');

    // 5. The PDF reader.
    chapter('PDF를 열어 다음 쪽으로 넘깁니다.');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await pause(4000);
    const indicator = page.getByTestId('pdf-page-indicator');
    const pageOne = await indicator.textContent();
    await page.getByTestId('pdf-next').click();
    await expect(indicator).not.toHaveText(pageOne ?? '');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await pause(4000);

    // 6. macOS: full screen, where the title strip shows the window title, which follows the view; then back to the
    //    frame. Elsewhere: back to the library.
    if (IS_MAC) {
      chapter(`${key('Ctrl+Cmd+F')} 전체 화면에서도 제목 띠가 지금 화면을 따라갑니다.`);
      const before = await bounds();
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
      await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(true)));
      await expect.poll(isFull, { timeout: 10_000 }).toBe(true);
      await settle('full screen fills the screen', fillsScreen);
      const top = async () => {
        const b = await bounds();
        await movePointer(b.x + Math.round(b.width / 2), b.y);
      };
      await top(); // the menu bar and the title strip ("sample") come down
      await pause(4000);
      await restPointer();
      await pause(1500);
      await press('1', ['command'], 'nav.back');
      await expect(page.getByTestId('library-table')).toBeVisible();
      await top(); // the strip now says 내 라이브러리
      await pause(3500);
      await restPointer();
      await pause(1000);
      await press('f', ['control', 'command'], async () => (await win()).evaluate((w) => w.setFullScreen(false)));
      await expect.poll(isFull, { timeout: 10_000 }).toBe(false);
      await settle('the window is back at its frame', async () => JSON.stringify(await bounds()) === JSON.stringify(before));
      await restPointer();
      await pause(2000);
    } else {
      chapter(`${key('CmdOrCtrl+1')}로 라이브러리로 돌아갑니다.`);
      await press('1', ['command'], 'nav.back');
      await expect(page.getByTestId('library-table')).toBeVisible();
      await pause(2500);
    }

    // 7. A video this platform cannot play: what to do next, with the file buttons.
    chapter(`재생할 수 없는 동영상은 ${label('item.showInFolder')}와 ${label('item.openExternally')}를 안내합니다.`);
    await openItem(page, 'sample-mpeg4part2');
    await expect(page.getByTestId('video-error')).toBeVisible();
    await pause(8000);
    await press('1', ['command'], 'nav.back');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await page.mouse.move(700, 430, { steps: 10 }); // off the row it clicked (no hover left behind)
    await pause(1500);

    // 8. ⌃⌘S, then the boundary dragged wider and back.
    chapter(`${key('Ctrl+Cmd+S')}로 사이드바를 접고, 경계를 끌어 폭을 바꿉니다.`);
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
    const y = Math.round(sep.y + sep.height * 0.55);
    const x0 = Math.round(sep.x + sep.width / 2);
    await page.mouse.move(x0, y, { steps: 12 });
    await page.mouse.down();
    await page.mouse.move(x0 + 80, y, { steps: 30 });
    await page.mouse.up();
    await expect.poll(sidebarWidth).toBeGreaterThan(width0 + 40);
    await pause(3000);
    await page.mouse.move(x0 + 80, y);
    await page.mouse.down();
    await page.mouse.move(x0, y, { steps: 30 });
    await page.mouse.up();
    await expect.poll(sidebarWidth).toBeLessThan(width0 + 10);
    await page.mouse.move(700, 430, { steps: 10 });
    await pause(2000);

    // 9. ⌘K: with an empty query the first row has the cursor; 초성 ㅅㅈ finds 설정…, and ↩ runs it.
    chapter(`${key('CmdOrCtrl+K')} 명령 팔레트는 초성으로도 찾습니다: ㅅㅈ → 설정.`);
    await press('k', ['command'], 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    const cursor = page.locator('[data-testid="palette-item"][data-focused]');
    await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
    await pause(4000);
    for (const ch of ['ㅅ', 'ㅈ']) {
      await page.keyboard.insertText(ch);
      await expect(page.getByTestId('palette-input')).toHaveValue(new RegExp(`${ch}$`));
      await pause(1000);
    }
    await expect(cursor).toHaveAttribute('data-command-id', 'app.settings');
    await pause(3000);
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));

    // 10. The settings window is a window of its own: the main window behind it is not main, so its chrome dims.
    chapter('설정은 따로 뜨는 창이고, 뒤의 메인 창은 흐려집니다.');
    const html = page.locator('html');
    if (IS_MAC) await expect(html).toHaveAttribute('data-window-not-main', '');
    else await settle('the main window is not main behind the settings window', async () => (await html.getAttribute('data-window-not-main')) !== null, 3000);
    await pause(3500);
    for (const [id, attr, value] of [['density-compact', 'data-density', 'compact'], ['font-size-14', 'data-font-size', '14'], ['font-size-13', 'data-font-size', '13'], ['density-regular', 'data-density', 'regular']] as const) {
      await settings.getByTestId(id).click();
      await expect(html).toHaveAttribute(attr, value);
      await pause(3000);
    }
    await settings.getByTestId('theme-tile-dark').click();
    await expect.poll(() => isDark(page)).toBe(true);
    await expect.poll(() => isDark(settings)).toBe(true);
    await pause(4000);
    await closeSettings(settings);
    if (IS_MAC) await expect(html).not.toHaveAttribute('data-window-not-main', '');

    // 11. Dark.
    chapter('다크 모드에서도 같은 화면, 같은 정보입니다.');
    await page.mouse.move(640, 300, { steps: 10 });
    await pause(6000);

    // 12. macOS: another app in front — the window is inactive and its chrome dims, as Finder's does; then back.
    if (IS_MAC) {
      chapter('다른 앱이 앞에 오면 창이 비활성으로 흐려집니다.');
      try {
        await bringFinderToFront();
        await expect(html).toHaveAttribute('data-window-inactive', '');
        await pause(4000);
        await bringAppToFront(app);
        await expect(html).not.toHaveAttribute('data-window-inactive', '');
        await pause(2000);
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        notes.push(`System Events refused Finder (${e.message})`);
      }
    }

    // 13. ⌘/: the shortcut sheet as it is (F6 / ⇧F6 under 앱); ↩ closes it.
    chapter(`${key('CmdOrCtrl+/')} 단축키 도움말에는 F6 / ${key('Shift+F6')}도 있습니다.`);
    const sheet = await expectWindow(app, 'sheet', () => press('/', ['command'], 'app.shortcuts'));
    await expect(sheet.getByTestId('shortcut-row').filter({ hasText: 'F6' }).first()).toBeVisible();
    await pause(9000);
    await closeSheet(sheet, 'Enter');
    await pause(1500);

    // 14. ⌘, (the shortcut, run by main) and back to the system theme; the library stays on screen to the end.
    chapter(`${key('CmdOrCtrl+,')}로 설정을 열어 시스템 테마로 되돌립니다.`);
    const again = await expectWindow(app, 'settings', () => press(',', ['command'], 'app.settings'));
    await pause(2000);
    await again.getByTestId('theme-tile-system').click();
    await expect.poll(() => isDark(page)).toBe(false);
    await pause(3000);
    await closeSettings(again);
    await pause(3000);

    demoSeconds = Math.round((Date.now() - started) / 100) / 10;
    if (IS_MAC && rec.file !== null) {
      // screencapture -V stops by itself: the library rests on screen for whatever is left, plus a second.
      const left = RECORD_SECONDS - (Date.now() - started) / 1000;
      if (left > 0) await sleep(left * 1000 + 1000);
    } else await pause(2000); // the tail of an x11grab recording
  } finally {
    const entry = stopRec ? await stopRec() : rec ? await rec.done : null;
    await s?.app.close().catch(() => {});
    await display.restore();
    fs.rmSync(tmp, { recursive: true, force: true });
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const txt = outFile('m3-demo.chapters.txt');
    const json = outFile('m3-demo.chapters.json');
    fs.writeFileSync(txt.abs, chapters.map((c) => `${mmss(c.at)} ${c.title}`).join('\n') + '\n');
    fs.writeFileSync(
      json.abs,
      `${JSON.stringify(
        {
          recording: entry?.file ?? null,
          recordingError: entry?.error ?? entry?.skipped ?? null,
          recordSeconds: IS_MAC ? RECORD_SECONDS : null,
          demoSeconds,
          truncated: IS_MAC && entry?.file ? demoSeconds > RECORD_SECONDS : false,
          pace: PACE,
          scale: SCALE,
          grab: GRAB,
          platform: `${process.platform}-${process.arch}`,
          input,
          screen,
          displaySwitch: display.result,
          notes,
          chapters,
        },
        null,
        2,
      )}\n`,
    );
    record({ file: txt.rel, kind: 'data', description: 'M3 demo chapter list (m:ss from the start of the recording)' });
    record({ file: json.rel, kind: 'data', description: 'M3 demo chapters, input, screen and display switch' });
    mergeEnv({ displayModes: savedDisplayModes(), displaySwitch: display.result });
  }
  // A demo longer than the fixed macOS recording lost its end: say so (the files above are written either way).
  if (IS_MAC && rec?.file) expect(demoSeconds, 'the demo fits the recording (RECORD_SECONDS)').toBeLessThanOrEqual(RECORD_SECONDS);
});
