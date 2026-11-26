// Subtitles on screen (M8a spec 5.1, 5.4, 5.5, 6.4, 6.5, 6.8): the file picker of 자막 ▾, the overlay over the drawn picture, the menu's tracks and
// off, C, remove with its undo, the choice remembered per video, the toasts at the stage's top right, and the item panel's 자막 line.
// lecture-60s.mp4 is 60 s; its ko/en cue files are fixtures (pnpm fixtures).
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { Cue, SubtitleTrack } from '../../packages/domain/src/subtitles';
import { FIXTURES, importPaths, launch, libraryTab, openItem, rowByTitle, stageState, stubOpenDialog, videoReady, videoState } from './helpers';

const fixture = (name: string): string => path.join(FIXTURES, name);
const KO = fixture('lecture-60s.ko.srt');
const EN = fixture('lecture-60s.en.vtt');
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;

const state = async (page: Page) => (await videoState(page))!;
const menuButton = (page: Page): Locator => page.getByTestId('subtitles-menu');
const tracksOf = (page: Page, itemId: string): Promise<SubtitleTrack[]> =>
  page.evaluate(async (itemId) => {
    const r = await window.learn.subtitles.list({ itemId });
    return r.ok ? r.data.tracks : [];
  }, itemId);
const cuesOf = (page: Page, itemId: string, assetId: string): Promise<Cue[]> =>
  page.evaluate(async ({ itemId, assetId }) => {
    const r = await window.learn.subtitles.cues({ itemId, assetId });
    return r.ok ? r.data.cues : [];
  }, { itemId, assetId });
/** Moves the playhead as the scrubber does: the element's own time, whose `seeked` the overlay follows. */
/** The open menu has taken the focus (react-aria moves it a frame after the pop-up shows): only then does Escape reach it. */
const menuHasFocus = (page: Page) => expect.poll(() => page.evaluate(() => document.activeElement?.closest('[role="menu"]') != null)).toBe(true);
/** Opens 자막 ▾ once any menu that was just chosen from has gone: a press while it still closes lands on the page behind it. */
async function openMenu(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCount(0);
  await menuButton(page).click();
}
const seek = (page: Page, ms: number) => page.getByTestId('video').evaluate((v: HTMLVideoElement, ms) => void (v.currentTime = ms / 1000), ms);

/** The video opened in a reader; its item. */
async function openLecture(page: Page) {
  const [item] = await importPaths(page, [fixture('lecture-60s.mp4')]);
  await openItem(page, 'lecture-60s');
  await videoReady(page);
  return item!;
}

/** 자막 파일 추가… from the menu, the open panel answering with `files`. */
async function addFromMenu(page: Page, app: ElectronApplication, files: string[]): Promise<void> {
  await stubOpenDialog(app, files);
  await openMenu(page);
  await page.getByTestId('subtitle-add').click();
}

/** The two tracks on a fresh lecture, ko first: the reader's menu, as the owner does it. */
async function withTracks(page: Page, app: ElectronApplication) {
  const item = await openLecture(page);
  await addFromMenu(page, app, [KO, EN]);
  await expect(page.getByTestId('subtitle-attached')).toBeVisible();
  const tracks = await tracksOf(page, item.id);
  expect(tracks.map((t) => t.language)).toEqual(['ko', 'en']);
  return { item, tracks, ko: await cuesOf(page, item.id, tracks[0]!.assetId), en: await cuesOf(page, item.id, tracks[1]!.assetId) };
}

test('no subtitles: the button says so with its reason, the picker attaches two files at the stage\'s top right, and the first (Korean) shows', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await expect(menuButton(page)).toHaveText('자막 없음');
    const captions = page.getByTestId('video-captions');
    await expect(captions).toHaveAttribute('aria-disabled', 'true');
    // The reason is the tooltip's second line, where the shortcut would stand (design-spec 6).
    await captions.hover();
    await expect(page.getByRole('tooltip')).toContainText('자막 켜기');
    await expect(page.getByRole('tooltip')).toContainText('자막 없음');
    await page.mouse.move(5, 5);
    // The menu of no track is the picker alone.
    await openMenu(page);
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    await menuHasFocus(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await addFromMenu(page, app, [KO, EN]);
    const toast = page.getByTestId('subtitle-attached');
    await expect(toast).toContainText('자막 2개를 붙였습니다');
    await expect(menuButton(page)).toHaveText('한국어');
    await expect(captions).not.toHaveAttribute('aria-disabled');
    await expect.poll(async () => (await state(page)).captionsOn).toBe(true);

    // The video reader's toasts stand 16 from the stage's top and right edges, not over the controls.
    // (It rises in as it appears: the place is waited for, not read on its first frame.)
    const stage = (await page.getByTestId('video-stage').boundingBox())!;
    await expect.poll(async () => Math.abs((await toast.boundingBox())!.y - (stage.y + 16))).toBeLessThanOrEqual(1);
    const box = (await toast.boundingBox())!;
    expect(Math.abs(box.x + box.width - (stage.x + stage.width - 16))).toBeLessThanOrEqual(1);
    const controls = (await page.getByTestId('video-controls').boundingBox())!;
    expect(box.y + box.height).toBeLessThan(controls.y);

    // The library's item panel has the 자막 line, in the tracks' order, and follows a removal.
    await libraryTab(page).click();
    await rowByTitle(page, 'lecture-60s').click();
    const row = page.locator('[data-testid="file-row"][data-field="subtitles"]');
    await expect(row).toHaveText('자막한국어 · 영어');
  } finally {
    await app.close();
  }
});

test('the overlay follows the playhead inside the drawn picture; the menu changes the track; C and 끄기 turn it off and on', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko, en } = await withTracks(page, app);
    const overlay = page.getByTestId('subtitle-overlay');
    await seek(page, 1000);
    await expect.poll(async () => (await state(page)).cueText).toBe(ko[0]!.text);
    await expect(overlay).toHaveText(ko[0]!.text);
    // A cue later: the fifth.
    await seek(page, ko[4]!.startMs);
    await expect.poll(async () => (await state(page)).cueText).toBe(ko[4]!.text);

    // It stands over the picture's lower part: centred, 6 % of the picture's height above its bottom, within 78 % of its width.
    await seek(page, 1000);
    await expect(overlay).toBeVisible();
    const video = (await page.getByTestId('video').boundingBox())!;
    const pic = await page.getByTestId('video').evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight }));
    const scale = Math.min(video.width / pic.w, video.height / pic.h);
    const shown = { x: video.x + (video.width - pic.w * scale) / 2, y: video.y + (video.height - pic.h * scale) / 2, w: pic.w * scale, h: pic.h * scale };
    const text = (await overlay.boundingBox())!;
    expect(Math.abs(text.x + text.width / 2 - (shown.x + shown.w / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(shown.y + shown.h - (text.y + text.height) - shown.h * 0.06)).toBeLessThanOrEqual(2);
    expect(text.width).toBeLessThanOrEqual(shown.w * 0.78 + 1);
    // Cue text is a text node: markup in a cue would be shown as it is written, and the element has no child but text lines.
    expect(await overlay.evaluate((el) => [...el.querySelectorAll('*')].every((c) => c.classList.contains('sub-line')))).toBe(true);

    // The English track from the menu: the same moment, its own sentence.
    await openMenu(page);
    await page.getByRole('menuitemradio', { name: '영어' }).click();
    await expect(menuButton(page)).toHaveText('영어');
    await expect.poll(async () => (await state(page)).cueText).toBe(en[0]!.text);
    await expect(overlay).toHaveText(en[0]!.text);

    // C turns it off (nothing is drawn, the button says 자막 끔) and on again.
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).captionsOn).toBe(false);
    await expect(overlay).toHaveCount(0);
    await expect(menuButton(page)).toHaveText('자막 끔');
    await expect.poll(async () => (await state(page)).cueText).toBeNull();
    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).cueText).toBe(en[0]!.text);
    await expect(menuButton(page)).toHaveText('영어');

    // 끄기 in the menu does the same, and is checked while it is off.
    await openMenu(page);
    await page.getByRole('menuitemradio', { name: /^끄기/ }).click();
    await expect(menuButton(page)).toHaveText('자막 끔');
    await openMenu(page);
    await expect(page.getByRole('menuitemradio', { name: /^끄기/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitem', { name: '이 자막 제거' })).toHaveAttribute('aria-disabled', 'true');
    await menuHasFocus(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.getByTestId('video-captions').click();
    await expect(menuButton(page)).toHaveText('영어');
  } finally {
    await app.close();
  }
});

test('remove takes the shown track off with a toast; 실행 취소 brings it back, in its place, shown', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { item, tracks } = await withTracks(page, app);
    await expect(menuButton(page)).toHaveText('한국어');
    await openMenu(page);
    await page.getByRole('menuitem', { name: '이 자막 제거' }).click();
    const toast = page.getByTestId('subtitle-removed');
    await expect(toast).toContainText('‘한국어’ 자막을 제거했습니다');
    await expect.poll(async () => (await tracksOf(page, item.id)).map((t) => t.language)).toEqual(['en']);
    // The next track by the default rule shows.
    await expect(menuButton(page)).toHaveText('영어');
    await expect.poll(async () => (await state(page)).trackId).toBe(tracks[1]!.assetId);

    await toast.getByTestId('undo-action').click();
    await expect.poll(async () => (await tracksOf(page, item.id)).map((t) => [t.language, t.assetId])).toEqual([['ko', tracks[0]!.assetId], ['en', tracks[1]!.assetId]]);
    await expect(menuButton(page)).toHaveText('한국어');
    expect(await state(page)).toMatchObject({ trackId: tracks[0]!.assetId, captionsOn: true });
  } finally {
    await app.close();
  }
});

test('the track and its on or off are remembered per video across a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  try {
    const { item, tracks } = await withTracks(page, app);
    await openMenu(page);
    await page.getByRole('menuitemradio', { name: '영어' }).click();
    await expect(menuButton(page)).toHaveText('영어');
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('c');
    await expect(menuButton(page)).toHaveText('자막 끔');
    // The choice is saved at once, not on the place's own timer.
    await expect
      .poll(() => page.evaluate((itemId) => window.learn.reader.getPosition({ itemId }).then((r) => (r.ok && r.data?.locator.kind === 'video' ? r.data.locator.captions ?? null : null)), item.id))
      .toEqual({ assetId: tracks[1]!.assetId, on: false });
    await app.close();

    ({ app, page } = await launch(lib, ud));
    await videoReady(page);
    await expect(menuButton(page)).toHaveText('자막 끔');
    expect(await state(page)).toMatchObject({ trackId: tracks[1]!.assetId, captionsOn: false, cueText: null });
    await page.getByTestId('video-captions').click();
    await expect(menuButton(page)).toHaveText('영어');
  } finally {
    await app.close().catch(() => {});
  }
});

test('a file with no sentences is a failure toast with its row and next step; the same file again is already on', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await addFromMenu(page, app, [fixture('broken.srt')]);
    const failed = page.getByTestId('subtitle-failed');
    await expect(failed).toContainText('자막 1개를 붙이지 못했습니다');
    await expect(failed).toContainText('broken.srt');
    await expect(failed).toContainText('자막 문장을 찾지 못했습니다');
    await expect(failed).toContainText('SRT · VTT 형식인지 확인하세요.');
    // An error waits for its ×.
    await expect(failed.getByTestId('toast-close')).toBeVisible();
    await expect(menuButton(page)).toHaveText('자막 없음');
    await failed.getByTestId('toast-close').click();
    await expect(failed).toHaveCount(0);

    await addFromMenu(page, app, [KO]);
    await expect(page.getByTestId('subtitle-attached')).toContainText('자막 1개를 붙였습니다');
    await addFromMenu(page, app, [KO]);
    await expect(page.getByTestId('subtitle-already')).toContainText('이미 붙어 있는 자막입니다');
  } finally {
    await app.close();
  }
});

test('on the stage the subtitle stands above the bar while it shows and comes back to 6 % when it hides', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko } = await withTracks(page, app);
    await page.getByTestId('video-fullscreen').click();
    await expect.poll(async () => (await stageState(app)).stage).toBe(true);
    await seek(page, 1000);
    await expect.poll(async () => (await state(page)).cueText).toBe(ko[0]!.text);
    // The stage here is 16:10, so the picture's black bars already lift the subtitle clear of the bar: a taller bar proves the rule is read.
    await page.locator('.video-reader').evaluate((el) => el.style.setProperty('--video-bar-h', '300px'));
    const lift = async () => {
      const stage = (await page.getByTestId('video-stage').boundingBox())!;
      const text = await page.getByTestId('subtitle-overlay').boundingBox();
      return text ? stage.y + stage.height - (text.y + text.height) : null;
    };
    // 300 + 16 above the stage's bottom while the bar shows.
    await expect.poll(lift).toBeGreaterThanOrEqual(316 - 1);
    const shownBox = (await page.getByTestId('video').boundingBox())!;

    // Playing with a still pointer hides the bar: the subtitle comes down to 6 % of the picture, the picture does not move.
    await page.keyboard.press('k');
    await page.mouse.move(300, 300);
    await expect(page.locator('.video-reader')).toHaveAttribute('data-idle', '', { timeout: 8_000 });
    await expect.poll(async () => ((await lift()) ?? Number.POSITIVE_INFINITY) < 300, { message: 'the subtitle is down while the bar is hidden (a cue in the gap between two cues is polled again)' }).toBe(true);
    expect(await page.getByTestId('video').boundingBox()).toEqual(shownBox);
  } finally {
    await app.close();
  }
});
