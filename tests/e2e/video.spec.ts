// The video reader v2 (M8a spec 6): our own controls, the registry's single-letter keys with their focus exceptions, the remembered
// speed and volume, and the unplayable state. lecture-60s.mp4 is 60 s at 30 fps (pnpm fixtures).
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, mainWindow, openItem, runMenuCommand, settled, stageState, videoReady, videoState } from './helpers';

const LECTURE = path.join(FIXTURES, 'lecture-60s.mp4');
const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;

const focusedTestId = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
const probe = async (page: Page) => (await videoState(page))!;
const timeMs = async (page: Page) => (await probe(page)).timeMs;
const paused = async (page: Page) => (await probe(page)).paused;

/** The speed menu is open and has taken the focus (react-aria moves it a frame after the pop-up shows). */
const menuHasFocus = (page: Page) => expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="menu"]') !== null && document.activeElement?.closest('[role="menu"]') !== undefined)).toBe(true);

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

test('the speed button says what it changes (name, tooltip with keys, menu name), and its visible text is inside the name', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const speed = page.getByTestId('video-speed');
    await expect(speed).toHaveText('1×');
    await expect(speed).toHaveAttribute('aria-label', '재생 속도 1×');
    await speed.click();
    await page.getByTestId('video-speed-1.25').click();
    await expect(speed).toHaveText('1.25×');
    await expect(speed).toHaveAttribute('aria-label', '재생 속도 1.25×');
    await expect(page.getByTestId('video-speed-1.25')).toHaveCount(0); // the first pop-up is gone before the next opens
    await speed.click();
    await expect(page.getByRole('menu', { name: '재생 속도' })).toBeVisible();
    await menuHasFocus(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('video-speed-1.25')).toHaveCount(0);
    // The tooltip opens on the keyboard focus at once, with the two keys.
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(speed).toBeFocused();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('재생 속도');
    await expect(tip).toContainText(process.platform === 'darwin' ? '⇧, ⇧.' : 'Shift+, · Shift+.');
  } finally {
    await app.close();
  }
});

test('the volume bar changes the sound while it is dragged and saves the value when the drag ends', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const bar = page.getByTestId('video-volume');
    const from = await pointAt(bar, 0.9);
    const to = await pointAt(bar, 0.3);
    const stored = () => page.evaluate(() => window.learn.settings.get({ key: 'video.volume' }).then((r) => (r.ok ? r.data : null)));
    expect(await stored()).toBeNull();
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    // Still held: the sound is at the bar, nothing is written yet.
    await expect.poll(async () => Math.abs((await probe(page)).volume - 0.3)).toBeLessThanOrEqual(0.12);
    expect(await stored()).toBeNull();
    await page.mouse.up();
    await expect.poll(async () => Math.abs(((await stored()) as number | null ?? 1) - 0.3)).toBeLessThanOrEqual(0.12);
  } finally {
    await app.close();
  }
});

test('a held key does not repeat a toggle (K, Space, M) and does repeat a seek (L); an open menu keeps its letters', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-stage').focus();
    // The event as the keyboard sends it while a key is held.
    const key = (code: string, repeat: boolean) =>
      page.evaluate(
        ([code, repeat]) => {
          const e = new KeyboardEvent('keydown', { code: code!, key: code === 'Space' ? ' ' : code!.slice(-1).toLowerCase(), repeat: repeat === 'true', bubbles: true, cancelable: true });
          document.activeElement!.dispatchEvent(e);
          return e.defaultPrevented;
        },
        [code, String(repeat)],
      );
    // A first press toggles (the control); its repeats are taken and change nothing.
    expect(await key('KeyK', false)).toBe(true);
    await expect.poll(() => paused(page)).toBe(false);
    for (let i = 0; i < 4; i++) expect(await key('KeyK', true)).toBe(true);
    await settled(page);
    expect(await paused(page)).toBe(false);
    for (let i = 0; i < 3; i++) expect(await key('Space', true)).toBe(true);
    await settled(page);
    expect(await paused(page)).toBe(false);
    expect(await key('KeyK', false)).toBe(true);
    await expect.poll(() => paused(page)).toBe(true);
    expect(await key('KeyM', false)).toBe(true);
    await expect.poll(async () => (await probe(page)).muted).toBe(true);
    for (let i = 0; i < 3; i++) await key('KeyM', true);
    await settled(page);
    expect((await probe(page)).muted).toBe(true);
    // A seek repeats: three repeated L are three skips.
    const at = await timeMs(page);
    for (let i = 0; i < 3; i++) {
      await key('KeyL', true);
      await expect.poll(() => timeMs(page)).toBeGreaterThanOrEqual(at + 9_500 * (i + 1));
    }

    // With the speed menu open its own typeahead has the letters: K does not play.
    await page.getByTestId('video-speed').click();
    await expect(page.getByTestId('video-speed-1.25')).toBeVisible();
    await menuHasFocus(page);
    await page.keyboard.press('k');
    await settled(page);
    expect(await paused(page)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('video-speed-1.25')).toHaveCount(0);
    // The control: the same key with the menu closed plays.
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(false);
  } finally {
    await app.close();
  }
});

// ---- The stage (spec 6.6): the window's full screen through main's controller, the chrome hidden, idle controls hidden -------------

const OFF = { stage: false, fullScreen: false, pending: false };
const ON = { stage: true, fullScreen: true, pending: false };
const html = (page: Page) => page.locator('html');
const stageOn = async (app: Parameters<typeof stageState>[0], page: Page) => {
  await expect.poll(() => stageState(app)).toEqual(ON);
  await expect(html(page)).toHaveAttribute('data-video-stage', '');
};
const stageOff = async (app: Parameters<typeof stageState>[0], page: Page) => {
  await expect.poll(() => stageState(app)).toEqual(OFF);
  await expect(html(page)).not.toHaveAttribute('data-video-stage');
};

test('F puts the video on the stage, esc takes it off: the tab strip, the sidebar and the strip are hidden meanwhile', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-stage').focus();
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('video-toolbar')).toBeVisible();
    await page.keyboard.press('f');
    await stageOn(app, page);
    await expect(page.getByTestId('tab-bar')).toBeHidden();
    await expect(page.getByTestId('video-toolbar')).toBeHidden();
    await expect(page.getByTestId('sidebar-top')).toBeHidden();
    await expect(page.getByTestId('video-controls')).toBeVisible(); // the controls stay: over the picture
    await page.keyboard.press('Escape');
    await stageOff(app, page);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect(page.getByTestId('video-toolbar')).toBeVisible();
    await expect(page.getByTestId('sidebar-top')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the full-screen button goes in and out, and names what it does', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const button = page.getByTestId('video-fullscreen');
    await expect(button).toHaveAttribute('aria-label', '전체 화면으로 보기');
    await button.click();
    await stageOn(app, page);
    await expect(button).toHaveAttribute('aria-label', '전체 화면 끝내기');
    await button.click();
    await stageOff(app, page);
    await expect(button).toHaveAttribute('aria-label', '전체 화면으로 보기');
  } finally {
    await app.close();
  }
});

test('esc with the speed menu open closes only the menu; the next esc leaves the stage', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await page.getByTestId('video-speed').click();
    await expect(page.getByTestId('video-speed-1.25')).toBeVisible();
    await menuHasFocus(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('video-speed-1.25')).toHaveCount(0);
    await settled(page);
    expect(await stageState(app)).toEqual(ON);
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('Escape');
    await stageOff(app, page);
  } finally {
    await app.close();
  }
});

test('the window leaving full screen by itself ends the stage', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await (await mainWindow(app)).evaluate((w) => w.setFullScreen(false));
    await stageOff(app, page);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('on the stage a still pointer hides the controls and the pointer while it plays; movement, a key or a pause brings them back', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const reader = page.locator('.video-reader');
    // Windowed, nothing hides.
    await page.getByTestId('video-play').click();
    await expect.poll(() => paused(page)).toBe(false);
    await settled(page);
    await expect(reader).not.toHaveAttribute('data-idle');
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await page.mouse.move(400, 300);
    await expect(reader).toHaveAttribute('data-idle', '', { timeout: 6_000 });
    await expect(page.getByTestId('video-controls')).toHaveCSS('opacity', '0');
    await expect(page.getByTestId('video-stage')).toHaveCSS('cursor', 'none');
    // The video box does not move while the controls come and go.
    const box = (await page.getByTestId('video').boundingBox())!;
    await page.mouse.move(420, 320);
    await expect(reader).not.toHaveAttribute('data-idle');
    await expect(page.getByTestId('video-controls')).toHaveCSS('opacity', '1');
    expect(await page.getByTestId('video').boundingBox()).toEqual(box);
    await expect(reader).toHaveAttribute('data-idle', '', { timeout: 6_000 });
    // A key shows them again; a pause keeps them shown.
    await page.keyboard.press('j');
    await expect(reader).not.toHaveAttribute('data-idle');
    await expect(reader).toHaveAttribute('data-idle', '', { timeout: 6_000 });
    await page.keyboard.press('k');
    await expect.poll(() => paused(page)).toBe(true);
    await expect(reader).not.toHaveAttribute('data-idle');
    await settled(page);
    await expect(reader).not.toHaveAttribute('data-idle'); // paused: the controls stay
  } finally {
    await app.close();
  }
});

test('on the stage a switch to another tab ends the stage', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [LECTURE, PDF]);
    await openItem(page, 'lecture-60s');
    await videoReady(page);
    await page.locator('[data-testid="tab"][data-item-id="library"]').click();
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await runMenuCommand(app, 'tab.next'); // a tab opened from the library stands left of the one opened before: the video is to its right
    await videoReady(page);
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await runMenuCommand(app, 'tab.previous');
    await stageOff(app, page);
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await expect(page.getByTestId('tab-bar')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('closing the video on the stage ends the stage', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await runMenuCommand(app, 'tab.close');
    await stageOff(app, page);
    await expect(page.getByTestId('library-table')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a page cannot enter HTML full screen: the request ran and never took, and the window stays as it is', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    // Positive control first: the window's own full screen works through main, so a window that stays put below is the page's refusal.
    await page.getByTestId('video-fullscreen').click();
    await stageOn(app, page);
    await page.getByTestId('video-fullscreen').click();
    await stageOff(app, page);
    // The page asks inside a real press (a user gesture). With the permission gone Electron neither enters nor rejects: the promise stays
    // pending and no fullscreenchange comes. `asked` proves the request ran; nothing changing afterwards is then the refusal.
    await page.evaluate(() => {
      const w = window as unknown as { __fs: string[] };
      w.__fs = [];
      document.addEventListener('fullscreenchange', () => w.__fs.push('change'));
      addEventListener('click', () => {
        w.__fs.push('asked');
        document.documentElement.requestFullscreen().then(() => w.__fs.push('entered'), (e: Error) => w.__fs.push(`rejected ${e.name}`));
      }, { once: true });
    });
    await page.getByTestId('video-stage').click(); // also plays the video: harmless here
    await expect.poll(() => page.evaluate(() => (window as unknown as { __fs: string[] }).__fs.includes('asked'))).toBe(true);
    await settled(page, 10);
    const result = await page.evaluate(() => ({ events: (window as unknown as { __fs: string[] }).__fs, element: document.fullscreenElement === null }));
    expect(result.events).not.toContain('entered');
    expect(result.events).not.toContain('change');
    expect(result.element).toBe(true);
    expect(await (await mainWindow(app)).evaluate((w) => w.isFullScreen())).toBe(false);
    expect(await stageState(app)).toEqual(OFF);
  } finally {
    await app.close();
  }
});
