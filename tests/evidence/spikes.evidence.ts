// M0 spikes (@evidence): what the macOS runner lets us capture, and the packaged app.
// Each spike records its outcome in evidence-results/spikes.json; a failed capture is data, not a test failure,
// unless the app itself misbehaves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, launch, mainWindow, openItem, stubOpenDialog, type LaunchOptions, type Session } from '../e2e/helpers';
import { EVIDENCE_ROOT, IS_MAC, captureOpenMenu, focusApp, fullScreenShot, menuBarNames, menuItemNames, nativeWindowShot, pageShot, pressEscape, startRecording, startScreencast, tryExec, writeJson } from './capture';

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
      const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('window=main'))!;
      setTimeout(() => menu.popup({ window: main, x: 420, y: 260 }), 0);
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
  const winState = async () => (await mainWindow(s.app)).evaluate((w) => ({ isFullScreen: w.isFullScreen(), bounds: w.getBounds() }));
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
        await (await mainWindow(s.app)).evaluate((w) => w.setFullScreen(false));
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
    const info = await s.page.evaluate(() => window.learn.app.info());
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

/** A menu item name that reads English: Latin letters and no Hangul (a separator is "-"; "Learn" is the app's name). */
const readsEnglish = (name: string) => name !== '-' && name !== 'Learn' && /[A-Za-z]{2}/.test(name) && !/[\u3131-\u318e\uac00-\ud7a3]/.test(name);

/** Info.plist values of an app bundle (PlistBuddy prints arrays as `Array {` … `}`); null when the key is absent. */
async function plistValue(appDir: string, key: string): Promise<string | string[] | null> {
  const r = await tryExec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appDir, 'Contents', 'Info.plist')]);
  if (!r.ok) return null;
  const out = r.stdout.trim();
  if (!out.startsWith('Array {')) return out;
  return out.split('\n').slice(1, -1).map((l) => l.trim()).filter(Boolean);
}

async function bundleLocalization(appDir: string) {
  const resources = path.join(appDir, 'Contents', 'Resources');
  return {
    lproj: fs.existsSync(resources) ? fs.readdirSync(resources).filter((n) => n.endsWith('.lproj')).sort() : [],
    developmentRegion: await plistValue(appDir, 'CFBundleDevelopmentRegion'),
    localizations: await plistValue(appDir, 'CFBundleLocalizations'),
  };
}

// Task 14: AppKit's own items in 편집 and 윈도우 (AutoFill, Start Dictation…, Emoji & Symbols, Close All …) came out in
// English on the runner (Task 8), whose system language is English. The packaged app is launched once with
// `-AppleLanguages (ko)` (a user whose Mac is in Korean). If those items are still English, it is launched once more
// from a copy whose Info.plist says what electron-builder's `extendInfo` would (CFBundleDevelopmentRegion ko,
// CFBundleLocalizations [ko, en]) with a ko.lproj in its Resources if the bundle had none, so one run tells whether the
// bundle needs it. The 편집 menu is captured open each time. Data, like every spike: only a launch failure fails it.
test('spike 6: AppKit menu items in Korean (packaged, -AppleLanguages (ko))', TAG, async () => {
  test.skip(!PACKAGED || !IS_MAC, 'the packaged macOS app (workflow input packaged=true)');
  test.setTimeout(240_000);
  const bundle = path.resolve(PACKAGED, '../../..');
  const attempt = async (executablePath: string, label: string) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-spike-ko-'));
    const errors: string[] = [];
    let s: Session | null = null;
    let attempts = 0;
    for (attempts = 1; attempts <= 3 && !s; attempts++) {
      try {
        s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), { executablePath, args: ['-AppleLanguages', '(ko)'] });
      } catch (e) {
        errors.push(String((e as Error).message ?? e).slice(0, 300));
      }
    }
    attempts -= 1;
    try {
      if (!s) return { launched: false, attempts, errors };
      await focusApp(s.app);
      const pid = s.app.process().pid!;
      const locale = await s.app.evaluate(({ app }) => ({ locale: app.getLocale(), preferred: app.getPreferredSystemLanguages(), system: app.getSystemLocale() }));
      const bar = await menuBarNames('Learn');
      const edit = await menuItemNames(pid, 4);
      const windowMenu = await menuItemNames(pid, 7);
      const opened = await captureOpenMenu(s.app, pid, 4, `spike6-ko-${label}-menu-edit`, `packaged, -AppleLanguages (ko), ${label}: 편집 open`);
      const english = [...new Set([...(edit ?? []), ...(windowMenu ?? [])].filter(readsEnglish))];
      return {
        launched: true,
        attempts,
        errors,
        locale,
        menuBar: bar.ok ? bar.stdout.trim() : `error: ${bar.stderr.trim()}`,
        edit,
        window: windowMenu,
        english,
        shots: [opened.click.shot, opened.keyboard.shot],
      };
    } finally {
      await s?.app.close().catch(() => {});
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
  type Attempt = Awaited<ReturnType<typeof attempt>>;
  const englishLeft = (a: Attempt) => !a.launched || (a as { english: string[] }).english.length > 0 || !(a as { edit: string[] | null }).edit;

  const asBuilt = { bundle: await bundleLocalization(bundle), ...(await attempt(PACKAGED, 'as-built')) };
  let withKo: Record<string, unknown> | null = null;
  if (asBuilt.launched && englishLeft(asBuilt)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-ko-app-'));
    try {
      const copy = path.join(dir, 'Learn.app');
      const steps: Record<string, boolean | string> = {};
      const run = async (name: string, cmd: string, args: string[], ms = 60_000) => {
        const r = await tryExec(cmd, args, ms);
        steps[name] = r.ok ? true : (r.stderr || r.stdout).trim().split('\n')[0] ?? 'failed';
        return r.ok;
      };
      const plist = path.join(copy, 'Contents', 'Info.plist');
      let ok = await run('ditto', 'ditto', [bundle, copy], 180_000);
      if (ok) {
        await run('delete CFBundleLocalizations', '/usr/libexec/PlistBuddy', ['-c', 'Delete :CFBundleLocalizations', plist]); // absent is fine
        ok =
          ((await run('set CFBundleDevelopmentRegion', '/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDevelopmentRegion ko', plist])) ||
            (await run('add CFBundleDevelopmentRegion', '/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleDevelopmentRegion string ko', plist]))) &&
          (await run('add CFBundleLocalizations', '/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleLocalizations array', '-c', 'Add :CFBundleLocalizations:0 string ko', '-c', 'Add :CFBundleLocalizations:1 string en', plist]));
        const ko = path.join(copy, 'Contents', 'Resources', 'ko.lproj');
        if (ok && !fs.existsSync(ko)) {
          fs.mkdirSync(ko);
          steps['mkdir ko.lproj'] = true;
        }
        if (ok) ok = await run('codesign', 'codesign', ['--force', '--deep', '--sign', '-', copy], 300_000);
      }
      withKo = ok ? { bundle: await bundleLocalization(copy), steps, ...(await attempt(path.join(copy, 'Contents', 'MacOS', path.basename(PACKAGED)), 'info-plist-ko')) } : { steps };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const verdict = !asBuilt.launched
    ? 'could not launch the packaged app'
    : !englishLeft(asBuilt)
      ? 'Korean as built: no bundle change needed'
      : !withKo || !(withKo as { launched?: boolean }).launched
        ? 'English as built; the Info.plist ko copy could not be tried (see steps)'
        : englishLeft(withKo as Attempt)
          ? 'English even with Info.plist ko: AppKit follows the system language the runner has (manual on a Korean Mac, P6 packaging)'
          : 'Korean only with Info.plist ko: add extendInfo (CFBundleDevelopmentRegion, CFBundleLocalizations) to electron-builder.yml';
  saveSpike('6-menu-language', { result: verdict, args: ['-AppleLanguages', '(ko)'], asBuilt, withInfoPlistKo: withKo });
  expect(asBuilt.launched, `the packaged app did not start: ${(asBuilt as { errors: string[] }).errors.join(' | ')}`).toBe(true);
});
