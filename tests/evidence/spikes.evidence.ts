// M0 spikes (@evidence): what the macOS runner lets us capture, and the packaged app.
// Each spike records its outcome in evidence-results/spikes.json; a failed capture is data, not a test failure,
// unless the app itself misbehaves.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, launch, openItem, stubOpenDialog, type LaunchOptions, type Session } from '../e2e/helpers';
import { EVIDENCE_ROOT, IS_MAC, focusApp, fullScreenShot, nativeWindowShot, pageShot, startRecording, startScreencast, tryExec, writeJson } from './capture';

const TAG = { tag: '@evidence' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const PACKAGED = process.env['LEARN_PACKAGED_APP'] ?? '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function saveSpike(id: string, result: Record<string, unknown>): void {
  const file = path.join(EVIDENCE_ROOT, 'spikes.json');
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  all[id] = { ...result, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() };
  writeJson('spikes.json', all, 'M0 spike outcomes');
}

/** Pixel size of a PNG via `sips` (macOS). */
async function pngSize(rel: string | null): Promise<string | null> {
  if (!rel || !IS_MAC) return null;
  const r = await tryExec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(EVIDENCE_ROOT, rel)]);
  const w = /pixelWidth: (\d+)/.exec(r.stdout)?.[1];
  const h = /pixelHeight: (\d+)/.exec(r.stdout)?.[1];
  return w && h ? `${w}x${h}` : null;
}

/** Names of the menu bar items System Events sees for `processName` (item 2 is the app menu). */
async function menuBarNames(processName: string) {
  return tryExec('osascript', ['-e', `tell application "System Events" to get name of every menu bar item of menu bar 1 of process "${processName}"`], 20_000);
}

const pressEscape = () => tryExec('osascript', ['-e', 'tell application "System Events" to key code 53'], 10_000);

/**
 * Open menu bar item `index` of `processName` two ways and capture the screen each time.
 * Run 39443865113 showed that `click` under `ignoring application responses` returned at once but no
 * open menu was captured, so: (a) the plain, blocking AXPress click run in the background, and
 * (b) the keyboard: ⌃F2 focuses the menu bar (Apple menu), → moves to item `index`, ↓ opens it.
 */
async function captureOpenMenu(app: ElectronApplication, processName: string, index: number, prefix: string, what: string) {
  await focusApp(app);
  const child = spawn('osascript', ['-e', `tell application "System Events" to tell process "${processName}" to click menu bar item ${index} of menu bar 1`], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<string>((resolve) => child.on('exit', (code, signal) => resolve(`exit ${code ?? signal}`)));
  await sleep(1500);
  const runningAfterDelay = child.exitCode === null && child.signalCode === null;
  const clickShot = await fullScreenShot(`${prefix}-click`, `${what}: blocking System Events click, captured while it runs`);
  child.kill('SIGTERM');
  // A pending AXPress keeps System Events busy; restart it only on throwaway CI machines.
  const unblock = process.env['CI'] ? await tryExec('killall', ['System Events']) : { ok: false, skipped: 'not CI' };
  await sleep(800);
  await pressEscape();
  await sleep(300);
  const click = {
    shot: clickShot.file,
    osascriptStillRunningAfter1500ms: runningAfterDelay,
    osascript: await Promise.race([exited, sleep(5000).then(() => 'still running')]),
    stderr: stderr.trim(),
    killallSystemEvents: 'skipped' in unblock ? unblock.skipped : unblock.ok,
  };

  await focusApp(app);
  const keys = ['tell application "System Events"', 'key code 120 using control down', 'delay 0.4'];
  for (let i = 1; i < index; i++) keys.push('key code 124', 'delay 0.15');
  keys.push('key code 125', 'end tell');
  const typed = await tryExec('osascript', keys.flatMap((l) => ['-e', l]), 20_000);
  await sleep(1200);
  const keyShot = await fullScreenShot(`${prefix}-keyboard`, `${what}: ⌃F2, → ×${index - 1}, ↓ via System Events`);
  await pressEscape();
  await pressEscape();
  const keyboard = { shot: keyShot.file, ok: typed.ok, stderr: typed.stderr.trim() };
  return { click, keyboard };
}


async function freshSession(opts: LaunchOptions = {}): Promise<Session & { tmp: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-spike-'));
  const s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), opts);
  await stubOpenDialog(s.app, [PDF, MP4]);
  await s.page.getByTestId('import-managed').click();
  await expect(s.page.getByTestId('item-row')).toHaveCount(2);
  return { ...s, tmp };
}

async function closeSession(s: { app: ElectronApplication; tmp: string }): Promise<void> {
  await s.app.close().catch(() => {});
  fs.rmSync(s.tmp, { recursive: true, force: true });
}

/** A short scripted tour used while recording. */
async function tour(page: Page): Promise<void> {
  await sleep(800);
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await sleep(1200);
  await page.getByTestId('pdf-next').click();
  await sleep(1200);
  await page.getByTestId('viewer-back').click();
  await sleep(600);
  await openItem(page, 'sample-h264-aac');
  const video = page.getByTestId('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await sleep(3000);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  await page.getByTestId('viewer-back').click();
  await sleep(600);
}

test('spike 1+2: screencapture from the Node test process, screen recording vs CDP screencast', TAG, async () => {
  const s = await freshSession();
  try {
    await focusApp(s.app);
    const recording = startRecording(10, 'spike2-screen-recording', 'screencapture -v -V 10 during a scripted tour');
    const cast = await startScreencast(s.page, 'spike2-cdp-screencast', 'same tour, renderer only');
    await tour(s.page);
    const castEntry = await cast.stop();
    const rec = await recording.done;
    const win = await nativeWindowShot(s.app, 'spike1-window', 'window capture from the Playwright worker (Node child process)');
    const full = await fullScreenShot('spike1-screen', 'full-screen capture from the Playwright worker (Node child process)');
    saveSpike('1-screencapture-from-node', {
      result: !IS_MAC ? 'skipped (not darwin)' : win.file && full.file && rec.file ? 'pass' : 'fail',
      window: { ...win, size: await pngSize(win.file) },
      fullscreen: { ...full, size: await pngSize(full.file) },
      recording: rec,
      note: 'pass = files written without a hang or TCC prompt; check PNGs show app windows (not just wallpaper)',
    });
    saveSpike('2-screen-recording', {
      result: !IS_MAC ? 'skipped (not darwin); CDP screencast only' : rec.file ? 'recorded (playability checked on the server)' : 'fail',
      screencapture: rec,
      cdpScreencast: castEntry,
      playwrightRecordVideo: 'not usable: Playwright 1.64.1 recordVideo leaves the Electron 44 window paused before navigation (reproduced on Linux with a minimal app)',
    });
  } finally {
    await closeSession(s);
  }
});

test('spike 3+4: native context menu and menu bar capture', TAG, async () => {
  const s = await freshSession();
  try {
    // 3. A temporary native context menu (the app has none yet), captured from the test process.
    await focusApp(s.app);
    await s.app.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.buildFromTemplate([
        { label: '열기' },
        { label: 'Finder에서 보기' },
        { type: 'separator' },
        { label: '태그', submenu: [{ label: '빨강' }, { label: '파랑' }] },
        { type: 'separator' },
        { label: '휴지통으로 이동' },
      ]);
      (globalThis as { __evidenceMenu?: Electron.Menu }).__evidenceMenu = menu;
      setTimeout(() => menu.popup({ window: BrowserWindow.getAllWindows()[0]!, x: 420, y: 260 }), 0);
    });
    await sleep(1200);
    const ctxShot = await fullScreenShot('spike3-context-menu', 'temporary native context menu opened with Menu.popup()');
    const closeT0 = Date.now();
    const closed = await Promise.race([
      s.app
        .evaluate(() => {
          (globalThis as { __evidenceMenu?: Electron.Menu }).__evidenceMenu?.closePopup();
          return 'closePopup';
        })
        .catch((e: Error) => `evaluate failed: ${e.message}`),
      sleep(8000).then(() => 'timeout (main thread busy in menu tracking?)'),
    ]);
    let escape: unknown = null;
    if (closed !== 'closePopup' && IS_MAC) escape = await pressEscape();
    saveSpike('3-context-menu', {
      result: !IS_MAC ? 'skipped (not darwin)' : ctxShot.file ? 'captured (check PNG shows the menu)' : 'fail',
      shot: { ...ctxShot, size: await pngSize(ctxShot.file) },
      close: { how: closed, ms: Date.now() - closeT0, escape },
    });

    // 4. Menu bar: JSON dump always; on macOS also open a menu via System Events and capture it.
    const menu = await s.app.evaluate(({ Menu }) => {
      type Item = { label: string; role?: string; accelerator?: string; type: string; enabled: boolean; visible: boolean; submenu?: Item[] };
      const dump = (m: Electron.Menu | null): Item[] | null =>
        m
          ? m.items.map((i) => ({
              label: i.label,
              ...(i.role ? { role: i.role } : {}),
              ...(i.accelerator ? { accelerator: String(i.accelerator) } : {}),
              type: i.type,
              enabled: i.enabled,
              visible: i.visible,
              ...(i.submenu ? { submenu: dump(i.submenu) ?? [] } : {}),
            }))
          : null;
      return dump(Menu.getApplicationMenu());
    });
    writeJson('menu.json', menu, 'Menu.getApplicationMenu() dump (unpackaged app)');
    let menubar: Record<string, unknown> = { result: 'skipped (not darwin)' };
    if (IS_MAC) {
      await focusApp(s.app);
      const names = await menuBarNames('Electron');
      const opened = await captureOpenMenu(s.app, 'Electron', 3, 'spike4-menubar', 'menu bar item 3 (File)');
      menubar = {
        result: 'see PNGs: an open File menu means the strategy works',
        processName: 'Electron',
        menuBarItems: names.ok ? names.stdout.trim() : `error: ${names.stderr.trim()}`,
        ...opened,
      };
    }
    saveSpike('4-menu-bar', { ...menubar, menuJsonTopLevel: menu?.map((m) => m.label) ?? null });
  } finally {
    await closeSession(s);
  }
});

// Not one of the six planned spikes: run 39442173392 (macos-15) hung in tests/e2e/first-session.spec.ts at
// `document.exitFullscreen()` right after `requestFullscreen()`. Characterise it without touching the app.
test('extra: HTML video fullscreen enter/exit', TAG, async () => {
  const s = await freshSession();
  const within = async (fn: () => Promise<unknown>, ms: number) => {
    const t0 = Date.now();
    const outcome = await Promise.race([
      fn().then(
        () => 'resolved',
        (e: Error) => `rejected: ${e.message.split('\n')[0]}`,
      ),
      sleep(ms).then(() => 'timeout'),
    ]);
    return { outcome, ms: Date.now() - t0 };
  };
  const winState = () =>
    s.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return { isFullScreen: w.isFullScreen(), bounds: w.getBounds() };
    });
  const docFullscreen = async () => {
    const r = await Promise.race([s.page.evaluate(() => document.fullscreenElement !== null), sleep(5000).then(() => 'timeout')]);
    return r;
  };
  try {
    await openItem(s.page, 'sample-h264-aac');
    const video = s.page.getByTestId('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    const attempts: Array<Record<string, unknown>> = [];
    // First with a pause between enter and exit (as a user would), then immediately (as the E2E does).
    for (const pauseMs of [2500, 0]) {
      const enter = await within(() => video.evaluate((v: HTMLVideoElement) => v.requestFullscreen()), 15_000);
      const afterEnter = { window: await winState(), documentFullscreen: await docFullscreen() };
      await sleep(pauseMs);
      const shot = pauseMs ? await fullScreenShot('spikeX-fullscreen-video', 'HTML fullscreen video (native macOS full screen)') : null;
      const exit = await within(() => s.page.evaluate(() => document.exitFullscreen()), 15_000);
      await sleep(1000);
      const afterExit = { window: await winState(), documentFullscreen: await docFullscreen() };
      let recovery: Record<string, unknown> | null = null;
      if (exit.outcome !== 'resolved' || afterExit.window.isFullScreen) {
        await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(false));
        await sleep(3000);
        recovery = { via: 'BrowserWindow.setFullScreen(false)', window: await winState(), documentFullscreen: await docFullscreen() };
      }
      attempts.push({ pauseMs, enter, afterEnter, shot: shot?.file ?? null, exit, afterExit, recovery });
    }
    const after = await fullScreenShot('spikeX-fullscreen-after', 'after both fullscreen attempts');
    saveSpike('x-html-fullscreen', {
      result: attempts.every((a) => (a['exit'] as { outcome: string }).outcome === 'resolved') ? 'exit resolves' : 'exitFullscreen did not resolve (see attempts)',
      attempts,
      after: after.file,
    });
  } finally {
    await closeSession(s);
  }
});

test('spike 5: packaged app (electron-builder --dir) via executablePath', TAG, async () => {
  test.skip(!PACKAGED, 'set LEARN_PACKAGED_APP to the packaged executable (workflow input packaged=true)');
  const errors: string[] = [];
  let s: (Session & { tmp: string }) | null = null;
  let attempts = 0;
  // Playwright #43247: firstWindow() can miss the window of a packaged Electron 44 app; retry.
  for (attempts = 1; attempts <= 3 && !s; attempts++) {
    try {
      s = await freshSession({ executablePath: PACKAGED });
    } catch (e) {
      errors.push(String((e as Error).message ?? e).slice(0, 500));
    }
  }
  attempts -= 1;
  if (!s) {
    saveSpike('5-packaged', { result: 'fail: could not launch', executablePath: PACKAGED, attempts, errors });
    throw new Error(`packaged app did not start after ${attempts} attempts:\n${errors.join('\n')}`);
  }
  try {
    const appState = await s.app.evaluate(({ app: a }) => ({
      name: a.getName(),
      isPackaged: a.isPackaged,
      exe: a.getPath('exe'),
      userData: a.getPath('userData'),
    }));
    const info = await s.page.evaluate(() => window.learn.appInfo());
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await s.page.getByTestId('viewer-back').click();
    await pageShot(s.page, 'spike5-packaged-library', 'packaged app library');
    await focusApp(s.app);
    const win = await nativeWindowShot(s.app, 'spike5-packaged', 'packaged app window');
    const full = await fullScreenShot('spike5-packaged', 'packaged app: menu bar should read "Learn"');
    let menubar: Record<string, unknown> | null = null;
    if (IS_MAC) {
      const names = await menuBarNames('Learn');
      const opened = await captureOpenMenu(s.app, 'Learn', 2, 'spike5-packaged-appmenu', 'packaged app menu (item 2)');
      menubar = { menuBarItems: names.ok ? names.stdout.trim() : `error: ${names.stderr.trim()}`, ...opened };
    }
    saveSpike('5-packaged', {
      result: appState.isPackaged && info.ok ? 'pass' : 'fail',
      executablePath: PACKAGED,
      attempts,
      errors,
      app: appState,
      schemaVersion: info.ok ? info.data.schemaVersion : null,
      shots: { window: win.file, fullscreen: full.file },
      menubar,
    });
    expect(appState.isPackaged).toBe(true);
  } finally {
    await closeSession(s);
  }
});
