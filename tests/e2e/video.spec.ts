// The video reader v2 (M8a spec 6): our own controls, the registry's single-letter keys with their focus exceptions, the remembered
// speed and volume, and the unplayable state. lecture-60s.mp4 is 60 s at 30 fps (pnpm fixtures).
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, mainWindow, openItem, settled, videoReady, videoState } from './helpers';

const LECTURE = path.join(FIXTURES, 'lecture-60s.mp4');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;

const focusedTestId = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
const probe = async (page: Page) => (await videoState(page))!;
const timeMs = async (page: Page) => (await probe(page)).timeMs;
const paused = async (page: Page) => (await probe(page)).paused;

async function openLecture(page: Page) {
  await importPaths(page, [LECTURE]);
  await openItem(page, 'lecture-60s');
  await videoReady(page);
}

/** The point of a horizontal control at `fraction` of its width, at its vertical centre. */
async function pointAt(box: Locator, fraction: number): Promise<{ x: number; y: number }> {
  const b = (await box.boundingBox())!;
  return { x: b.x + b.width * fraction, y: b.y + b.height / 2 };
}

/** A key as the Korean input source sends it: the physical key is K, the character is ㅏ, and no composition is on. */
async function pressHangul(page: Page, code: string, key: string, keyCode: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await cdp.detach();
}

test('the controls with the mouse: play and pause, ten seconds on, the scrubber, its time bubble, the speed menu, mute and the volume bar', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    // No native controls: ours stand in the picture's place.
    expect(await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.controls)).toBe(false);
    await expect(page.getByTestId('video-controls')).toBeVisible();
    await expect(page.getByTestId('video-toolbar')).toBeVisible();
    expect(await paused(page)).toBe(true);
    await expect(page.getByTestId('video-time')).toHaveText('0:00 / 1:00');

    await page.getByTestId('video-play').click();
    await expect.poll(() => paused(page)).toBe(false);
    await page.getByTestId('video-play').click();
    await expect.poll(() => paused(page)).toBe(true);

    await page.getByTestId('video-forward10').click();
    await expect.poll(() => timeMs(page)).toBeGreaterThanOrEqual(10_000);
    await expect(page.getByTestId('video-time')).toContainText('0:10');

    const scrubber = page.getByTestId('video-scrubber');
    const middle = await pointAt(scrubber, 0.5);
    await page.mouse.click(middle.x, middle.y);
    await expect.poll(async () => Math.abs((await timeMs(page)) - 30_000)).toBeLessThanOrEqual(500);
    await expect(scrubber).toHaveAttribute('aria-valuenow', '30');
    await expect(scrubber).toHaveAttribute('aria-valuetext', '30초 / 1분');

    // The bubble names the time under the pointer: a quarter of 60 s is 15 s.
    const quarter = await pointAt(scrubber, 0.25);
    await page.mouse.move(quarter.x, quarter.y);
    await expect(page.getByTestId('video-hover-time')).toHaveText(/^0:1[4-6]$/);
    await page.mouse.move(10, 10);
    await expect(page.getByTestId('video-hover-time')).toHaveCount(0);

    await expect(page.getByTestId('video-speed')).toHaveText('1×');
    await page.getByTestId('video-speed').click();
    await page.getByTestId('video-speed-1.25').click();
    await expect.poll(async () => (await probe(page)).rate).toBe(1.25);
    await expect(page.getByTestId('video-speed')).toHaveText('1.25×');

    expect((await probe(page)).muted).toBe(false);
    await page.getByTestId('video-mute').click();
    await expect.poll(async () => (await probe(page)).muted).toBe(true);
    await page.getByTestId('video-mute').click();
    await expect.poll(async () => (await probe(page)).muted).toBe(false);
    const bar = page.getByTestId('video-volume');
    const at40 = await pointAt(bar, 0.4);
    await page.mouse.click(at40.x, at40.y);
    await expect.poll(async () => Math.abs((await probe(page)).volume - 0.4)).toBeLessThanOrEqual(0.1);
  } finally {
    await app.close();
  }
});

test('the keys with the stage focused: K and Space, J L, the arrows, the frame steps, the speed and M', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const stage = page.getByTestId('video-stage');
    await stage.focus();

    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(false);
    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(true);

    const at = await timeMs(page);
    await page.keyboard.press('l');
    await expect.poll(() => timeMs(page)).toBeGreaterThanOrEqual(at + 9_500);
    await page.keyboard.press('j');
    await expect.poll(() => timeMs(page)).toBeLessThanOrEqual(at + 500);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => timeMs(page)).toBeGreaterThanOrEqual(at + 4_500);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => timeMs(page)).toBeGreaterThanOrEqual(at + 9_500);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Math.abs((await timeMs(page)) - (at + 5_000))).toBeLessThanOrEqual(500);

    // Frame steps, paused: one frame on is a step of at most 100 ms, one back is the same the other way.
    const before = await timeMs(page);
    await page.keyboard.press('.');
    await expect.poll(() => timeMs(page)).toBeGreaterThan(before);
    const forward = await timeMs(page);
    expect(forward - before).toBeLessThanOrEqual(100);
    await page.keyboard.press(',');
    await expect.poll(() => timeMs(page)).toBeLessThan(forward);

    // While it plays the same keys are not taken (the control above shows they are paused's): the key goes on to the page.
    const taken = () =>
      page.evaluate(() => {
        const e = new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true, cancelable: true });
        document.querySelector('[data-testid="video-stage"]')!.dispatchEvent(e);
        return e.defaultPrevented;
      });
    expect(await taken()).toBe(true); // paused: the keymap takes it
    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(false);
    await expect.poll(taken).toBe(false); // the window's context follows the play state a render later
    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(true);

    await page.keyboard.press('Shift+Period');
    await expect.poll(async () => (await probe(page)).rate).toBe(1.25);
    await page.keyboard.press('Shift+Comma');
    await expect.poll(async () => (await probe(page)).rate).toBe(1);

    await page.keyboard.press('m');
    await expect.poll(async () => (await probe(page)).muted).toBe(true);
    await page.keyboard.press('m');
    await expect.poll(async () => (await probe(page)).muted).toBe(false);
  } finally {
    await app.close();
  }
});

test('a Korean input source still plays: the physical key K with the character ㅏ', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-stage').focus();
    await pressHangul(page, 'KeyK', 'ㅏ', 75);
    await expect.poll(() => paused(page)).toBe(false);
    await pressHangul(page, 'KeyK', 'ㅏ', 75);
    await expect.poll(() => paused(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('the focused control keeps its keys: Space presses the play button once, → on the scrubber is five seconds exactly', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('video-scrubber');

    // The scrubber's own arrow: the keymap leaves it, so it is 5 s once, not 10.
    expect(await timeMs(page)).toBe(0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => timeMs(page)).toBe(5_000);
    await settled(page);
    expect(await timeMs(page)).toBe(5_000);
    await page.keyboard.press('PageUp');
    await expect.poll(() => timeMs(page)).toBe(15_000);
    await page.keyboard.press('Home');
    await expect.poll(() => timeMs(page)).toBe(0);

    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('video-back10');
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('video-play');
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(false);
    await settled(page); // a second toggle (the button's and the keymap's) would have paused it again
    expect(await paused(page)).toBe(false);
    await page.keyboard.press('Space');
    await expect.poll(() => paused(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('the speed, the volume and the mute are remembered after a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  try {
    await openLecture(page);
    await page.getByTestId('video-speed').click();
    await page.getByTestId('video-speed-1.5').click();
    await expect.poll(async () => (await probe(page)).rate).toBe(1.5);
    const bar = page.getByTestId('video-volume');
    const at40 = await pointAt(bar, 0.4);
    await page.mouse.click(at40.x, at40.y);
    await expect.poll(async () => Math.abs((await probe(page)).volume - 0.4)).toBeLessThanOrEqual(0.1);
    const volume = (await probe(page)).volume;
    await page.getByTestId('video-mute').click();
    await expect.poll(async () => (await probe(page)).muted).toBe(true);
    // The settings reach main before the app goes.
    const stored = (key: 'video.playbackRate' | 'video.volume' | 'video.muted') => page.evaluate((k) => window.learn.settings.get({ key: k }).then((r) => (r.ok ? r.data : null)), key);
    await expect.poll(() => stored('video.playbackRate')).toBe(1.5);
    await expect.poll(() => stored('video.muted')).toBe(true);
    await expect.poll(() => stored('video.volume')).toBeCloseTo(volume, 5);
    await app.close();

    ({ app, page } = await launch(lib, ud));
    await videoReady(page); // the session reopens the reader tab
    await expect.poll(async () => (await probe(page)).rate).toBe(1.5);
    await expect.poll(async () => (await probe(page)).muted).toBe(true);
    expect(Math.abs((await probe(page)).volume - volume)).toBeLessThan(0.01);
    await expect(page.getByTestId('video-speed')).toHaveText('1.5×');
  } finally {
    await app.close().catch(() => {});
  }
});

test('the volume bar folds when the row would overflow, and floats over its button on hover', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await expect(page.getByTestId('video-volume')).toBeVisible();
    // The guard only: no M8a layout is narrower than 560, so the reader is made narrow (the window at its smallest, the text at its largest).
    await page.evaluate(() => window.learn.prefs.set({ fontSize: 15 }));
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(960, 640));
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.video-reader')!.style.width = '500px';
    });
    await expect(page.getByTestId('video-volume')).toHaveCount(0);
    await page.getByTestId('video-mute').hover();
    await expect(page.getByTestId('video-volume')).toBeVisible();
    const button = (await page.getByTestId('video-mute').boundingBox())!;
    const pop = (await page.getByTestId('video-volume').boundingBox())!;
    expect(pop.y + pop.height).toBeLessThanOrEqual(button.y); // above the button
  } finally {
    await app.close();
  }
});

test('an unplayable video: the notice alone, inside the stage at 1024 × 768; no controls, no strip; the sidebar says there is no transcript', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, 768));
    await importPaths(page, [MPEG4]);
    await openItem(page, 'sample-mpeg4part2');
    await expect(page.getByTestId('video-error')).toBeVisible();
    const stage = (await page.getByTestId('video-stage').boundingBox())!;
    for (const id of ['video-error', 'codec-reveal', 'codec-open']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.x, id).toBeGreaterThanOrEqual(stage.x);
      expect(b.y, id).toBeGreaterThanOrEqual(stage.y);
      expect(b.x + b.width, id).toBeLessThanOrEqual(stage.x + stage.width);
      expect(b.y + b.height, id).toBeLessThanOrEqual(stage.y + stage.height);
    }
    await expect(page.getByTestId('video-controls')).toHaveCount(0);
    await expect(page.getByTestId('video-toolbar')).toHaveCount(0);
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('표시할 대본이 없습니다');
    expect((await videoState(page))?.status).toBe('unplayable');
  } finally {
    await app.close();
  }
});
