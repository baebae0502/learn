// @m8a — the main window's display mode across a relaunch (M8a final review M6, N1), for the Mac `all` run to settle: a quit or a kill
// on the video stage comes back as a window with the stage off, and a full screen of the user's own comes back as it was, F and esc then
// toggling the stage alone. Each launch's main log has the window's display mode as it is made and shown and every change after it
// ([stage] lines, E2E only), and stage-relaunch.json keeps what each relaunch showed. macOS asserts all of it. Linux under Xvfb saves this
// app's window as a window even when it quits in full screen, so there the values are recorded and only what Linux can show is asserted.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { FIXTURES, importPaths, launch, mainWindow, openItem, stageState, videoReady, type Session } from '../e2e/helpers';
import { IS_MAC, writeJson } from './capture';

const TAG = { tag: '@m8a' };
const VIDEO = path.join(FIXTURES, 'lecture-60s.mp4');
type StageState = Awaited<ReturnType<typeof stageState>>;
const OFF: StageState = { stage: false, fullScreen: false, pending: false };
const ON: StageState = { stage: true, fullScreen: true, pending: false };
/** How long a relaunched window is watched: a restore (macOS animates into its own Space) and any leave after it land inside it. */
const WATCH_MS = 5000;
const SAMPLE_MS = 250;
const results: Record<string, unknown> = {};

/** The stage's setting as the page reads it: null when nothing was ever written. */
const stored = (page: Page) => page.evaluate(() => window.learn.settings.get({ key: 'ui.stageFullScreen' }).then((r) => (r.ok ? (r.data ?? null) : r.code)));

/**
 * The window's stage and full screen every 250 ms for five seconds from the relaunch. A fixed span on purpose: what is asked is that
 * nothing changes it in that time (a late restore, or a leave after one), which no single state to wait for can say.
 */
async function watch(app: ElectronApplication): Promise<Array<{ ms: number; state: StageState }>> {
  const samples: Array<{ ms: number; state: StageState }> = [];
  const t0 = Date.now();
  while (Date.now() - t0 < WATCH_MS) {
    samples.push({ ms: Date.now() - t0, state: await stageState(app) });
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
  samples.push({ ms: Date.now() - t0, state: await stageState(app) });
  return samples;
}

/** Each launch's [stage] lines, from main.log, main-2.log, … in this test's folder. */
function stageLines(testInfo: TestInfo): string[][] {
  const logs = fs.readdirSync(testInfo.outputDir).filter((f) => /^main(-\d+)?\.log$/.test(f));
  const order = (f: string) => Number(/-(\d+)\.log$/.exec(f)?.[1] ?? 1);
  return logs
    .sort((a, b) => order(a) - order(b))
    .map((f) => fs.readFileSync(path.join(testInfo.outputDir, f), 'utf8').split('\n').filter((l) => l.includes('[stage] ')).map((l) => l.slice(l.indexOf('[stage] '))));
}

/** What a relaunch showed, in the report and in stage-relaunch.json. */
function keep(testInfo: TestInfo, name: string, value: Record<string, unknown>): void {
  const observed = { ...value, platform: `${process.platform}-${process.arch}`, stageLines: stageLines(testInfo) };
  results[name] = observed;
  testInfo.annotations.push({ type: 'observed', description: `${name}: ${JSON.stringify(observed)}` });
  writeJson('stage-relaunch.json', results, 'M8a M6/N1: the main window after a quit or a kill on the video stage, and after one in the user\'s own full screen');
}

/** The lecture imported and open in its reader, playable. */
async function onVideo(s: Session): Promise<void> {
  await importPaths(s.page, [VIDEO]);
  await openItem(s.page, 'lecture-60s');
  await videoReady(s.page);
}

async function pressF(page: Page): Promise<void> {
  await page.getByTestId('video-stage').focus();
  await page.keyboard.press('f');
}

test('a quit on the stage: the next launch is a window with the stage off, and its window was made without the display mode', TAG, async ({}, testInfo) => {
  const [lib, ud] = [testInfo.outputPath('library'), testInfo.outputPath('userdata')];
  let s = await launch(lib, ud);
  try {
    await onVideo(s);
    expect(await stageState(s.app)).toEqual(OFF);
    await pressF(s.page);
    await expect.poll(() => stageState(s.app)).toEqual(ON);
    await expect.poll(() => stored(s.page)).toBe(true);
    await s.app.close();

    s = await launch(lib, ud);
    const samples = await watch(s.app);
    const flag = await stored(s.page);
    keep(testInfo, 'quitOnStage', { samples, flagAfter: flag });
    expect(stageLines(testInfo).at(-1)?.[0]).toMatch(/made restoreDisplayMode=false/);
    expect(samples.at(-1)!.state).toEqual(OFF);
    if (IS_MAC) expect(samples.every((x) => !x.state.stage)).toBe(true);
    expect(flag).toBe(false);
    // The stage works as on any launch.
    await videoReady(s.page); // the session reopened the reader tab
    await pressF(s.page);
    await expect.poll(() => stageState(s.app)).toEqual(ON);
    await s.page.keyboard.press('Escape');
    await expect.poll(() => stageState(s.app)).toEqual(OFF);
  } finally {
    await s.app.close();
  }
});

test("the user's own full screen comes back after a quit, and F and esc on a video then toggle the stage alone", TAG, async ({}, testInfo) => {
  const [lib, ud] = [testInfo.outputPath('library'), testInfo.outputPath('userdata')];
  let s = await launch(lib, ud);
  try {
    await onVideo(s);
    // The ⌃⌘F path: main changes the window's full screen, and the stage takes it as the user's.
    await (await mainWindow(s.app)).evaluate((w) => w.setFullScreen(true));
    await expect.poll(() => stageState(s.app)).toEqual({ stage: false, fullScreen: true, pending: false });
    expect(await stored(s.page)).toBeNull();
    await s.app.close();

    s = await launch(lib, ud);
    const samples = await watch(s.app);
    const restored = samples.at(-1)!.state.fullScreen;
    keep(testInfo, 'ownFullScreen', { samples, restored });
    expect(stageLines(testInfo).at(-1)?.[0]).toMatch(/made restoreDisplayMode=true/);
    if (IS_MAC) {
      expect(samples.at(-1)!.state).toEqual({ stage: false, fullScreen: true, pending: false });
      // Once full screen it stays: nothing left it again within the watch.
      const first = samples.findIndex((x) => x.state.fullScreen);
      expect(samples.slice(first).every((x) => x.state.fullScreen)).toBe(true);
    }
    // F turns the stage on, esc turns it off and leaves the window as it came back: full screen on a Mac.
    await videoReady(s.page);
    await pressF(s.page);
    await expect.poll(() => stageState(s.app)).toEqual(ON);
    await s.page.keyboard.press('Escape');
    await expect.poll(() => stageState(s.app)).toEqual({ stage: false, fullScreen: restored, pending: false });
  } finally {
    await s.app.close();
  }
});

test('a kill on the stage: the next launch is a window with nothing pending', TAG, async ({}, testInfo) => {
  const [lib, ud] = [testInfo.outputPath('library'), testInfo.outputPath('userdata')];
  let s = await launch(lib, ud);
  try {
    await onVideo(s);
    await pressF(s.page);
    await expect.poll(() => stageState(s.app)).toEqual(ON);
    await expect.poll(() => stored(s.page)).toBe(true);
    const proc = s.app.process();
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    proc.kill('SIGKILL');
    await exited;

    s = await launch(lib, ud);
    const samples = await watch(s.app);
    const flag = await stored(s.page);
    keep(testInfo, 'killedOnStage', { samples, flagAfter: flag });
    expect(stageLines(testInfo).at(-1)?.[0]).toMatch(/made restoreDisplayMode=false/);
    expect(samples.at(-1)!.state).toEqual(OFF);
    if (IS_MAC) expect(samples.every((x) => !x.state.stage && !x.state.pending)).toBe(true);
    expect(flag).toBe(false);
  } finally {
    await s.app.close();
  }
});
