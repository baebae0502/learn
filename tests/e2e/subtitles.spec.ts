// Subtitles on screen (M8a spec 5.1, 5.4, 5.5, 6.4, 6.5, 6.8): the file picker of 자막 ▾, the overlay over the drawn picture, the menu's tracks and
// off, C, remove with its undo, the choice remembered per video, the toasts at the stage's top right, and the item panel's 자막 line; and the
// transcript pane of the sidebar (spec 7): the list that seeks, follows the current sentence, searches the track, and its end states.
// lecture-60s.mp4 is 60 s; its ko/en cue files are fixtures (pnpm fixtures).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { Cue, SubtitleTrack } from '../../packages/domain/src/subtitles';
import { FIXTURES, importPaths, launch, libraryTab, menuItemEnabled, openItem, rowByTitle, runMenuCommand, stageState, stubOpenDialog, videoReady, videoState } from './helpers';

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

    // Back to the Korean track, whose cues are cached by now, then English again: each switch shows that track's sentence, never an old one's index.
    for (const [name, cues] of [['한국어', ko], ['영어', en], ['한국어', ko]] as const) {
      await openMenu(page);
      await page.getByRole('menuitemradio', { name }).click();
      await expect(menuButton(page)).toHaveText(name);
      await expect.poll(async () => (await state(page)).cueText).toBe(cues[0]!.text);
      await expect(overlay).toHaveText(cues[0]!.text);
    }
    await openMenu(page);
    await page.getByRole('menuitemradio', { name: '영어' }).click();
    await expect(menuButton(page)).toHaveText('영어');
    await expect.poll(async () => (await state(page)).cueText).toBe(en[0]!.text);

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

    // Off before the undo (the positive control: the undo is what turns a track on).
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('c');
    await expect.poll(async () => (await state(page)).captionsOn).toBe(false);
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

test('a long cue wraps within 78 % of the picture, not half of it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const long = testInfo.outputPath('long.ko.srt');
    const line = '세포막은 인지질 이중층으로 이루어져 있고 그 사이에 박혀 있는 단백질이 물질의 출입을 조절하며 신호를 받아들이는 일도 맡습니다 그래서 막의 성질을 알면 세포가 살아가는 방식을 많이 설명할 수 있습니다';
    fs.writeFileSync(long, `1\n00:00:00,000 --> 00:00:09,000\n${line}\n`);
    await addFromMenu(page, app, [long]);
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await seek(page, 2000);
    const overlay = page.getByTestId('subtitle-overlay');
    await expect(overlay).toBeVisible();
    const box = (await page.getByTestId('subtitle-box').boundingBox())!;
    const text = (await overlay.boundingBox())!;
    // One line of this length is wider than the picture: it fills the 78 %, within a pixel.
    expect(text.width / box.width).toBeGreaterThan(0.5);
    expect(text.width / box.width).toBeLessThanOrEqual(0.78 + 1 / box.width);
    expect(Math.abs(text.x + text.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
});


// ---- the transcript pane (spec 7) -------------------------------------------------------------------------------------------

const row = (page: Page, i: number): Locator => page.locator(`[data-testid="cue-row"][data-index="${i}"]`);
const list = (page: Page): Locator => page.getByTestId('transcript');
const searchInput = (page: Page): Locator => page.getByTestId('transcript-search').getByRole('searchbox');
const countText = (page: Page): Locator => page.getByTestId('transcript-count');
const follow = (page: Page): Locator => page.getByTestId('transcript-follow');
const heldRow = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset['index'] ?? null);
/** The rows that are on at the playhead, by index. */
const currentRows = (page: Page): Promise<number[]> => page.locator('[data-testid="cue-row"][data-current]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset['index'])));
/** Whether row `i` is drawn inside the list's box (a row the list has not drawn is not in it). */
async function rowInView(page: Page, i: number): Promise<boolean> {
  const box = await list(page).boundingBox();
  const r = (await row(page, i).count()) > 0 ? await row(page, i).boundingBox() : null;
  return !!box && !!r && r.y >= box.y - 1 && r.y + r.height <= box.y + box.height + 1;
}

test('the transcript lists the track\'s sentences with their times; a press seeks and keeps a paused video paused; ↩ on a row keeps a playing one playing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko } = await withTracks(page, app);
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId('transcript-empty')).toHaveCount(0);
    // Time over the sentence, as text nodes: the cue's own text, no markup.
    await expect(row(page, 4)).toContainText(ko[4]!.text);
    await expect(row(page, 4).locator('.ts')).toHaveText('0:15');
    expect(await row(page, 4).evaluate((el) => [...el.querySelectorAll('*')].map((c) => c.className))).toEqual(['ts num', 'tx']);
    // The head, the field with its placeholder, and the switch (on when a tab opens) under the list.
    await expect(page.locator('.nav-title')).toHaveText('대본');
    await expect(searchInput(page)).toHaveAttribute('placeholder', '대본에서 찾기');
    await expect(follow(page)).toHaveAttribute('data-selected');
    await expect(follow(page)).toHaveText('현재 위치 따라가기');

    // A press on the fifth sentence: the video goes to its start and stays paused.
    expect((await state(page)).paused).toBe(true);
    await row(page, 4).click();
    await expect.poll(async () => Math.abs((await state(page)).timeMs - ko[4]!.startMs)).toBeLessThanOrEqual(80);
    expect((await state(page)).paused).toBe(true);
    await expect(row(page, 4)).toHaveAttribute('data-current', 'true');
    await expect(row(page, 3)).toHaveClass(/is-past/);
    await expect(row(page, 5)).not.toHaveClass(/is-past|is-current/);

    // Two cues overlap at 7.5 s (4–8 and 7–10.5): both rows are current.
    await seek(page, 7500);
    await expect.poll(() => currentRows(page)).toEqual([1, 2]);

    // Playing: ↩ on a row goes there and the video goes on playing, and a video key still works with the row focused.
    await seek(page, 1000);
    await page.getByTestId('video-stage').focus();
    await page.keyboard.press('k');
    await expect.poll(async () => (await state(page)).paused).toBe(false);
    await row(page, 6).focus();
    await expect(row(page, 6)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).timeMs).toBeGreaterThanOrEqual(ko[6]!.startMs - 80);
    expect((await state(page)).timeMs).toBeLessThan(ko[6]!.startMs + 4000);
    expect((await state(page)).paused).toBe(false);
    // While it plays, the row that is on is drawn inside the list (a gap between two sentences has none, so it is polled).
    await expect.poll(async () => {
      const on = await currentRows(page);
      return on.length > 0 && (await rowInView(page, on[0]!));
    }).toBe(true);
    await page.keyboard.press('k');
    await expect.poll(async () => (await state(page)).paused).toBe(true);
    await expect(row(page, 6)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the list is a list box: ↑↓ Home End PageUp PageDown move the cursor row, which keeps the focus, and ←/→ still seek', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko } = await withTracks(page, app);
    await expect(list(page)).toHaveAttribute('role', 'listbox');
    await expect(row(page, 0)).toHaveAttribute('role', 'option');
    await row(page, 2).focus();
    await expect(row(page, 2)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => heldRow(page)).toBe('3');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => heldRow(page)).toBe('1');
    // A move between rows that are in view is no scroll: the switch stays on. End has to scroll the list, and turns it off.
    await expect(follow(page)).toHaveAttribute('data-selected');
    await page.keyboard.press('End');
    await expect.poll(() => heldRow(page)).toBe(String(ko.length - 1));
    await expect.poll(() => rowInView(page, ko.length - 1)).toBe(true);
    await expect(follow(page)).not.toHaveAttribute('data-selected');
    await page.keyboard.press('Home');
    await expect.poll(() => heldRow(page)).toBe('0');
    await page.keyboard.press('PageDown');
    await expect.poll(async () => Number(await heldRow(page))).toBeGreaterThan(1);
    // The arrows moved the cursor, not the video; ←/→ are the video's and go on seeking from the list.
    expect((await state(page)).timeMs).toBe(0);
    await seek(page, 20_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(20_000);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await state(page)).timeMs).toBe(25_000);
    await expect(page.locator('[data-testid="cue-row"]:focus')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('searching the track: the count, ↩ and ⇧↩ go to the next and previous sentence (and seek there), the end wraps with a note, marks are text', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko } = await withTracks(page, app);
    const first = ko.findIndex((c) => c.text.includes('칼슘 펌프'));
    const second = ko.findIndex((c, i) => i > first && c.text.includes('칼슘 펌프'));
    await searchInput(page).fill('칼슘 펌프');
    await expect(countText(page)).toHaveText('2개');
    // Marks in the matching sentences only, each a text node; the nearest one before any ↩ is not yet current.
    await expect(list(page).locator('mark')).toHaveCount(2);
    await expect(list(page).locator('mark').first()).toHaveText('칼슘 펌프');
    expect(await list(page).locator('mark').first().evaluate((m) => m.children.length)).toBe(0);

    await searchInput(page).press('Enter');
    await expect.poll(async () => Math.abs((await state(page)).timeMs - ko[first]!.startMs)).toBeLessThanOrEqual(80);
    await expect(row(page, first).locator('mark')).toHaveClass('is-current');
    await searchInput(page).press('Enter');
    await expect.poll(async () => Math.abs((await state(page)).timeMs - ko[second]!.startMs)).toBeLessThanOrEqual(80);
    await expect(countText(page)).toHaveText('2개');
    await searchInput(page).press('Enter');
    // Round again: the note stands for two seconds, then the count is the count.
    await expect(countText(page)).toHaveText(/^처음부터\s· 1 \/ 2$/);
    await expect(countText(page)).toHaveAttribute('data-wrapped');
    await expect.poll(async () => Math.abs((await state(page)).timeMs - ko[first]!.startMs)).toBeLessThanOrEqual(80);
    await expect(countText(page)).toHaveText('2개', { timeout: 6_000 });
    await expect(countText(page)).not.toHaveAttribute('data-wrapped');

    // Backwards from the first goes round to the last.
    await searchInput(page).press('Shift+Enter');
    await expect(countText(page)).toHaveText(/^처음부터\s· 2 \/ 2$/);
    await expect.poll(async () => Math.abs((await state(page)).timeMs - ko[second]!.startMs)).toBeLessThanOrEqual(80);
    // The field keeps the focus, and the matches ignore case and accents (Latin) in the query.
    await expect(searchInput(page)).toBeFocused();
    await searchInput(page).fill('ATP');
    await expect(countText(page)).toHaveText('1개');
    await searchInput(page).fill('atp');
    await expect(countText(page)).toHaveText('1개');
  } finally {
    await app.close();
  }
});

test('↩ starts from the playhead: the first match on or after it, ⇧↩ the last before it; the match on the playhead is marked before any ↩', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const { ko } = await withTracks(page, app);
    const first = ko.findIndex((c) => c.text.includes('칼슘 펌프'));
    const second = ko.findIndex((c, i) => i > first && c.text.includes('칼슘 펌프'));
    const at = async (i: number) => expect.poll(async () => Math.abs((await state(page)).timeMs - ko[i]!.startMs)).toBeLessThanOrEqual(80);
    // Between the two matches (the first ends at 22.5 s, the second starts at 34.5 s): the second is the one ahead, and is marked.
    await seek(page, 25_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(25_000);
    await searchInput(page).fill('칼슘 펌프');
    await expect(countText(page)).toHaveText('2개');
    await expect(row(page, second).locator('mark')).toHaveClass('is-current');
    await expect(row(page, first).locator('mark')).not.toHaveClass('is-current');
    await searchInput(page).press('Enter');
    await at(second);
    // From there the list's own order goes on: the end wraps to the first.
    await searchInput(page).press('Enter');
    await expect(countText(page)).toHaveText(/^처음부터\s· 1 \/ 2$/);
    await at(first);

    // ⇧↩ from between the two: the last one behind the playhead is the first match, with no wrap.
    await searchInput(page).fill('');
    await seek(page, 25_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(25_000);
    await searchInput(page).fill('칼슘 펌프');
    await expect(countText(page)).toHaveText('2개');
    await searchInput(page).press('Shift+Enter');
    await at(first);
    await expect(countText(page)).toHaveText('2개');

    // Past the last match, ↩ comes round to the first (with the note); inside the first match's own sentence it is the one at the playhead.
    await searchInput(page).fill('');
    await seek(page, 40_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(40_000);
    await searchInput(page).fill('칼슘 펌프');
    await expect(countText(page)).toHaveText('2개');
    await searchInput(page).press('Enter');
    await expect(countText(page)).toHaveText(/^처음부터\s· 1 \/ 2$/);
    await at(first);
    await searchInput(page).fill('');
    await seek(page, 20_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(20_000);
    await searchInput(page).fill('칼슘 펌프');
    await expect(countText(page)).toHaveText('2개');
    await searchInput(page).press('Enter');
    await at(first);
    await expect(countText(page)).toHaveText('2개');
  } finally {
    await app.close();
  }
});

test('a word that is nowhere says so in the list\'s place; esc empties the field and goes to the list', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await withTracks(page, app);
    await searchInput(page).fill('없는말');
    const empty = page.getByTestId('transcript-empty');
    await expect(empty).toContainText('‘없는말’');
    await expect(empty).toContainText('이 나오는 문장이 없습니다');
    await expect(empty).toContainText('자막 파일의 글자에서만 찾습니다. 다른 낱말로 찾아보세요.');
    await expect(countText(page)).toHaveText('0개');
    await expect(list(page)).toHaveCount(0);
    // Nothing is listed, so nothing is followed: no bar, and its value is kept for the list's return.
    await expect(follow(page)).toHaveCount(0);
    // The positive control: the list is the same list once the query is gone.
    await searchInput(page).press('Escape');
    await expect(searchInput(page)).toHaveValue('');
    await expect(empty).toHaveCount(0);
    await expect(list(page)).toBeVisible();
    await expect(follow(page)).toHaveAttribute('data-selected');
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role') ?? null)).toBe('option');
  } finally {
    await app.close();
  }
});

test('with 2,000 sentences: End goes to the last one; the current sentence is followed until a wheel turns the switch off, and turning it on goes back to it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    await addFromMenu(page, app, [fixture('long-2000.srt')]);
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await expect(list(page)).toHaveAttribute('data-count', '2000');
    // Far fewer rows than sentences are drawn.
    expect(await page.getByTestId('cue-row').count()).toBeLessThan(100);

    // The current sentence (the one that started at 30 s) is in the upper third of the list.
    await seek(page, 30_000);
    await expect.poll(() => currentRows(page)).toEqual([20]);
    await expect.poll(async () => {
      const box = (await list(page).boundingBox())!;
      const r = await row(page, 20).boundingBox();
      return r ? Math.abs(r.y - (box.y + box.height / 3)) : Number.POSITIVE_INFINITY;
    }).toBeLessThanOrEqual(24);

    // A wheel on the list is the user's scroll: the switch goes off and the list stays where it is while the video goes on elsewhere.
    await list(page).hover();
    await page.mouse.wheel(0, 300);
    await expect(follow(page)).not.toHaveAttribute('data-selected');
    await seek(page, 54_000);
    await expect.poll(async () => (await state(page)).timeMs).toBe(54_000);
    await expect.poll(async () => (await state(page)).cueText).not.toBeNull();
    expect(await rowInView(page, 36)).toBe(false);
    // On again: back to the current sentence.
    await follow(page).click();
    await expect(follow(page)).toHaveAttribute('data-selected');
    await expect.poll(() => rowInView(page, 36)).toBe(true);
    await expect.poll(() => currentRows(page)).toEqual([36]);

    // A press on a row does not turn it off.
    await row(page, 38).click();
    await expect(follow(page)).toHaveAttribute('data-selected');

    // End, from a row, goes to the last sentence of the 2,000.
    await row(page, 38).focus();
    await page.keyboard.press('End');
    await expect.poll(() => heldRow(page)).toBe('1999');
    await expect.poll(() => rowInView(page, 1999)).toBe(true);
    await expect(row(page, 1999)).toContainText('2000번째 문장');
    // That was a key scroll of the list: the switch is off.
    await expect(follow(page)).not.toHaveAttribute('data-selected');
  } finally {
    await app.close();
  }
});

test('⌘F takes the focus to the transcript search, unfolding the sidebar when it is folded; a video with no track has no find', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    // No track yet: nothing to search, so ⌘F is off in the menu.
    // (The menu item reports its state after the reader's first context.)
    await expect.poll(() => menuItemEnabled(app, 'library.find')).toBe(false);
    await addFromMenu(page, app, [KO]);
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await expect(list(page)).toBeVisible();

    await runMenuCommand(app, 'library.find');
    await expect(searchInput(page)).toBeFocused();
    await searchInput(page).fill('칼슘');
    await page.getByTestId('video-stage').focus();
    await runMenuCommand(app, 'library.find');
    await expect(searchInput(page)).toBeFocused();
    // The text is selected: the next key replaces it.
    expect(await searchInput(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 2]);

    // Folded sidebar: it opens, and the field has the focus.
    await page.getByTestId('video-stage').focus();
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(searchInput(page)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a video with no subtitles: the sidebar says so with the button that attaches them, and the list comes when they are on', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await openLecture(page);
    const empty = page.getByTestId('transcript-empty');
    await expect(empty).toContainText('자막이 없습니다');
    await expect(empty).toContainText('SRT나 VTT 자막 파일을 추가하면 대본이 여기에 표시되고, 문장을 눌러 그 시간으로 이동할 수 있습니다.');
    await expect(page.locator('.nav-title')).toHaveText('대본');
    await expect(list(page)).toHaveCount(0);
    await stubOpenDialog(app, [KO]);
    await page.getByTestId('transcript-add').click();
    await expect(page.getByTestId('subtitle-attached')).toBeVisible();
    await expect(list(page)).toBeVisible();
    await expect(empty).toHaveCount(0);
  } finally {
    await app.close();
  }
});
