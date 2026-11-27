// @m8a — M8a's screens in light and dark on macOS, for the design critique's light and dark frames (M8a spec 13 ①–⑦, 15): a window shot
// of each (screencapture: the traffic lights, the sidebar's vibrancy, the window as a Mac shows it). Linux runs the file too and takes
// the page instead. The states are staged as the tour's M8a scenes stage them (tests/e2e/visual/tour.spec.ts), without its baselines:
// the video is the real one and the clock is the real one.
//
// The pictures are taken in the window the display gives, as the other evidence specs take theirs: 1024 × 684 on the macOS runner.
// Each description gives the window and what of the state the window cannot hold in view. The narrow windows come last in their
// group, sized within the display. A group shares a launch, and a group that fails leaves the others' pictures. A picture waits for a
// settled frame: no caret, the pointer parked where nothing hovers, no tooltip, no toast from a step before, the fonts loaded and every
// animation that ends ended.
//
// Beside the pictures: the `DataTransferItem.type` the platform gives each kind of file during a drag (spec 18: Linux said `.vtt` was
// text/vtt and `.srt` application/x-subrip; macOS is read here), in m8a-drop-types.json; and one window shot of the video reader whose
// transcript sidebar carries `will-change: transform` and a −12 px bottom margin, to see whether its vibrancy survives on a Mac.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  FIXTURES, closeReaderTab, displayRoom, drag, dropSource, importPaths, launch, mainWindow, openItem, rowByTitle, selectRows, showItemPanel, stageState, stubOpenDialog, videoReady, videoState, type Session,
} from '../e2e/helpers';
import { IS_MAC, focusApp, movePointer, nativeWindowShot, pageShot, record, writeJson } from './capture';

const TAG = { tag: '@m8a' };
const LECTURE = path.join(FIXTURES, 'lecture-60s.mp4');
const KO = path.join(FIXTURES, 'lecture-60s.ko.srt');
const EN = path.join(FIXTURES, 'lecture-60s.en.vtt');
const UNPAIRED = path.join(FIXTURES, 'notes.ko.srt');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
type Theme = 'light' | 'dark';
const THEMES: readonly Theme[] = ['light', 'dark'];
/** The narrowed windows of spec 13 ⑥ (the volume bar folds under 960's reader). */
const NARROW_WIDTHS = [1024, 960] as const;
/** While a picture is taken: screencapture draws the caret wherever its blink is (a page shot hides it itself). */
const NO_CARET = '*, *::before, *::after { caret-color: transparent !important; }';
/** Two sentences of the Korean track that overlap (4–8 s and 7–10.5 s), so a time inside both has a two-line cue and two current rows. */
const OVERLAP_MS = 7500;

interface M8aSession extends Session {
  dir: string;
}

/** A window in the size the display gives it, the page following the theme pref through nativeTheme (no emulation), as on a user's Mac. */
async function launchM8a(): Promise<M8aSession> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m8a-shots-'));
  let s: Session;
  try {
    s = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { env: { LEARN_E2E_SETTINGS: '', TZ: 'Asia/Seoul' }, colorScheme: null });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const t: M8aSession = Object.assign(s, { dir });
  if (IS_MAC) {
    await focusApp(t.app);
    // The real pointer on the spot the other suites park it on, so a later activation of the window hovers nothing it left.
    await movePointer(512, 620);
  }
  return t;
}

async function closeM8a(s: M8aSession): Promise<void> {
  await s.app.close().catch(() => {});
  fs.rmSync(s.dir, { recursive: true, force: true });
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
}

const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const seek = (page: Page, ms: number) => page.evaluate((m) => void (document.querySelector<HTMLVideoElement>('[data-testid="video"]')!.currentTime = m / 1000), ms);
const menuButton = (page: Page) => page.getByTestId('subtitles-menu');
const searchField = (page: Page) => page.getByTestId('transcript-search').getByRole('searchbox');
const noMenu = (page: Page) => expect(page.getByRole('menu')).toHaveCount(0);

/** The video's time near `ms` (a seek lands on a frame). */
const atTime = (page: Page, ms: number) => expect.poll(async () => Math.abs(((await videoState(page))?.timeMs ?? -1e9) - ms), { message: `the video at ${ms} ms` }).toBeLessThan(300);

/** The pointer (Playwright's, which is the page's hover) in the window's bottom-right corner, over nothing that hovers. */
async function park(page: Page): Promise<void> {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(w - 1, h - 1);
}

/** macOS: the app in front, so the traffic lights are in their active colours. Before the pointer is parked: a window made active may get a mouse-moved event. */
async function front(s: Session): Promise<void> {
  if (IS_MAC) await focusApp(s.app);
}

/** The fonts loaded, every running animation that ends ended (a toast's rise), then two frames painted. An animation not ended after 3 s is not waited for longer. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const ending = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)));
    await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 3000))]);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

/** What a state is about, by name: each must be wholly in view (inside the window and every box that clips it), or the description says so. */
type Subject = readonly [string, Locator];

/** Whether every element `loc` matches is inside the window and inside each ancestor that clips it (a scrolled column cuts it). */
const inView = (loc: Locator): Promise<boolean> =>
  loc.evaluateAll((els) =>
    els.length > 0 &&
    els.every((el) => {
      const r = el.getBoundingClientRect();
      let box = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
      for (let a = el.parentElement; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const b = a.getBoundingClientRect();
        box = { top: Math.max(box.top, b.top), left: Math.max(box.left, b.left), bottom: Math.min(box.bottom, b.bottom), right: Math.min(box.right, b.right) };
      }
      return r.top >= box.top - 1 && r.left >= box.left - 1 && r.bottom <= box.bottom + 1 && r.right <= box.right + 1;
    }),
  );

/** The window as the picture has it, and the subjects the window cannot hold in view. */
async function where(page: Page, subjects: readonly Subject[]): Promise<string> {
  const size = await page.evaluate(() => `window ${innerWidth}×${innerHeight}`);
  const cut: string[] = [];
  for (const [name, loc] of subjects) if (!(await inView(loc))) cut.push(name);
  return cut.length > 0 ? `${size}; not wholly in view at this window: ${cut.join(', ')}` : size;
}

interface Shot {
  /** m8a-<name>-<theme>. */
  name: string;
  what: string;
  subjects: readonly Subject[];
  /** false: the caller brought the app to the front before staging (a toast's 5 s). */
  front?: boolean;
  /** false: the caller put the pointer where the state needs it (a hover's bubble). */
  park?: boolean;
  /** The state is a toast. */
  toast?: boolean;
}

/**
 * The state on screen, settled, in pictures: on macOS the window (screencapture; a failed one is a soft failure) and then the page, as
 * the other suites take both; elsewhere the page. The state itself is the caller's to have checked.
 */
async function shoot(s: Session, theme: Theme, shot: Shot): Promise<void> {
  const { app, page } = s;
  if (shot.toast !== true) await expect(page.locator('[data-pane="toasts"] .toast'), 'no toast left from a step before').toHaveCount(0, { timeout: 12_000 });
  if (shot.front !== false) await front(s);
  if (shot.park !== false) await park(page);
  if (shot.park !== false) await expect(page.getByRole('tooltip'), 'no tooltip in the picture').toHaveCount(0);
  const name = `m8a-${shot.name}-${theme}`;
  const style = await page.addStyleTag({ content: NO_CARET });
  try {
    await settle(page);
    const description = `M8a ${shot.what} — ${theme}; ${await where(page, shot.subjects)}`;
    if (IS_MAC) {
      const entry = await nativeWindowShot(app, name, description, { focus: false });
      expect.soft(entry.file, `${name}: the window shot (${entry.error ?? 'no error'})`).not.toBeNull();
    }
    await pageShot(page, name, description);
  } finally {
    await style.evaluate((el) => (el as Element).remove());
  }
}

/** A subtitle file picked in the reader's 자막 ▾ (the open panel answers with `files`). */
async function addSubtitles(s: Session, files: string[]): Promise<void> {
  await noMenu(s.page);
  await stubOpenDialog(s.app, files);
  await menuButton(s.page).click();
  await s.page.getByTestId('subtitle-add').click();
}

/** The shown video's subtitle tracks removed through the page's own API (a state to stage again for the other theme). */
async function removeTracks(page: Page, itemId: string): Promise<void> {
  const tracks = await page.evaluate((id) => window.learn.subtitles.list({ itemId: id }), itemId);
  if (!tracks.ok) throw new Error(`subtitles.list failed: ${tracks.code}`);
  for (const t of tracks.data.tracks) {
    const r = await page.evaluate((input) => window.learn.subtitles.remove(input), { itemId, assetId: t.assetId });
    if (!r.ok) throw new Error(`subtitles.remove failed: ${r.code}`);
  }
  await expect.poll(() => page.evaluate((id) => window.learn.subtitles.list({ itemId: id }).then((r) => (r.ok ? r.data.tracks.length : -1)), itemId)).toBe(0);
}

/** The window's content size, within what the display holds. */
async function resize(s: Session, width: number, height: number): Promise<void> {
  const win = await mainWindow(s.app);
  await win.evaluate((w, [cw, ch]) => w.setContentSize(cw!, ch!), [width, height] as const);
  await expect.poll(() => s.page.evaluate(() => innerWidth)).toBe(width);
}

/** The lecture imported and open, ready to play. */
async function openLecture(s: Session): Promise<string> {
  const [item] = await importPaths(s.page, [LECTURE]);
  await openItem(s.page, 'lecture-60s');
  await videoReady(s.page);
  return item!.id;
}

test('M8a ①–③: the video reader — no subtitles, the 자막 ▾ menus, the overlay, playing, speed and sound, the transcript, the sidebar\'s vibrancy', TAG, async () => {
  const s = await launchM8a();
  const { page } = s;
  try {
    const itemId = await openLecture(s);
    const longFile = path.join(s.dir, 'long.ko.srt');
    fs.writeFileSync(longFile, '1\n00:00:00,000 --> 00:00:09,000\n세포막은 인지질 이중층으로 이루어져 있고, 그 사이에 박혀 있는 단백질이 물질의 출입을 조절하며 신호를 받아들이는 일도 맡습니다\n그래서 막의 성질을 알면 세포가 어떻게 살아가는지 많은 것을 설명할 수 있습니다\n둘째 줄과 셋째 줄까지 길게 이어지는 문장도 영상 아래쪽에 가려지지 않아야 합니다\n');
    const stage = page.getByTestId('video-stage');
    const row = (i: number) => page.locator(`[data-testid="cue-row"][data-index="${i}"]`);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      if (theme === 'dark') {
        await removeTracks(page, itemId);
        await seek(page, 0);
      }
      // No subtitles: the transcript's empty state and the menu with nothing but 자막 파일 추가….
      await shoot(s, theme, { name: 'nosubs', what: '3 no subtitles: the transcript\'s empty state with its button', subjects: [['the empty state', page.getByTestId('transcript-empty')]] });
      await menuButton(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shoot(s, theme, { name: 'menu-none', what: '2 the 자막 ▾ menu of a video with no subtitles', subjects: [['the menu', page.getByRole('menu')]] });
      await page.keyboard.press('Escape');
      await noMenu(page);

      // Two files attached: the toast, then the overlay on a one-line and a two-line sentence.
      await front(s);
      await addSubtitles(s, [KO, EN]);
      await expect(page.getByTestId('subtitle-attached')).toBeVisible();
      await shoot(s, theme, { name: 'toast-attached', what: '4 the toast after two subtitle files were attached', subjects: [['the toast', page.getByTestId('subtitle-attached')]], front: false, toast: true });
      await expect(page.getByTestId('subtitle-attached')).toHaveCount(0, { timeout: 12_000 });
      await seek(page, 1000);
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('세포막');
      await shoot(s, theme, { name: 'overlay-one', what: '1 a one-line sentence on the picture, the transcript beside it with its current row', subjects: [['the sentence', page.getByTestId('subtitle-overlay')], ['the transcript', page.getByTestId('transcript')]] });
      await seek(page, OVERLAP_MS);
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('\n');
      await expect(page.locator('[data-testid="cue-row"][data-current]')).toHaveCount(2);
      await shoot(s, theme, { name: 'overlay-two', what: '1 a two-line sentence; two overlapping sentences are both the current rows', subjects: [['the sentence', page.getByTestId('subtitle-overlay')]] });

      // The menu with two tracks, then the English track on the picture.
      await menuButton(page).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await shoot(s, theme, { name: 'menu-two', what: '2 the 자막 ▾ menu with two tracks, 자막 끄기, 자막 파일 추가… and 이 자막 제거', subjects: [['the menu', page.getByRole('menu')]] });
      await page.getByRole('menuitemradio', { name: '영어' }).click();
      await expect(menuButton(page)).toHaveText('영어');
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('\n');
      await shoot(s, theme, { name: 'overlay-en', what: '1 the English track chosen, its sentence on the picture', subjects: [['the sentence', page.getByTestId('subtitle-overlay')]] });
      await menuButton(page).click();
      await page.getByRole('menuitemradio', { name: '한국어' }).click();
      await expect(menuButton(page)).toHaveText('한국어');

      // Playing: a one-line sentence while the picture moves, then the speed menu and 1.25×, the sound off.
      await seek(page, 1000);
      await atTime(page, 1000);
      await stage.focus();
      await page.keyboard.press('k');
      await expect.poll(async () => (await videoState(page))?.paused).toBe(false);
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('세포막');
      await shoot(s, theme, { name: 'playing', what: '1 playing, a one-line sentence, the pause button, the scrubber moving', subjects: [['the controls', page.getByTestId('video-controls')]] });
      await page.keyboard.press('k');
      await expect.poll(async () => (await videoState(page))?.paused).toBe(true);
      await page.getByTestId('video-speed').click();
      await expect(page.getByRole('menu', { name: '재생 속도' })).toBeVisible();
      await shoot(s, theme, { name: 'speed-menu', what: '1 the speed menu over the controls', subjects: [['the menu', page.getByRole('menu', { name: '재생 속도' })]] });
      await page.getByTestId('video-speed-1.25').click();
      await expect.poll(async () => (await videoState(page))?.rate).toBe(1.25);
      await page.getByTestId('video-mute').click();
      await expect.poll(async () => (await videoState(page))?.muted).toBe(true);
      await shoot(s, theme, { name: 'speed-muted', what: '1 speed 1.25× and the sound off', subjects: [['the controls', page.getByTestId('video-controls')]] });
      await page.getByTestId('video-mute').click();
      await expect.poll(async () => (await videoState(page))?.muted).toBe(false);
      await page.getByTestId('video-speed').click();
      await page.getByTestId('video-speed-1').click();
      await expect.poll(async () => (await videoState(page))?.rate).toBe(1);

      // The scrubber under the pointer: the time bubble.
      await seek(page, 22_000);
      await atTime(page, 22_000);
      await front(s);
      const bar = (await page.getByTestId('video-scrubber').boundingBox())!;
      await page.mouse.move(bar.x + bar.width * 0.62, bar.y + bar.height / 2);
      await expect(page.getByTestId('video-hover-time')).toBeVisible();
      await shoot(s, theme, { name: 'scrubber-hover', what: '1 the pointer on the scrubber: the time bubble', subjects: [['the bubble', page.getByTestId('video-hover-time')]], front: false, park: false });

      // The transcript: a search with a match, the wrap note, no results, follow off, the keyboard's row.
      await seek(page, 1000);
      await searchField(page).fill('칼슘 펌프');
      await expect(page.getByTestId('transcript-count')).toHaveText('2개');
      await shoot(s, theme, { name: 'transcript-match', what: '3 the transcript search with its matches marked, the count 2개', subjects: [['the count', page.getByTestId('transcript-count')]] });
      await searchField(page).fill('없는말');
      await expect(page.getByTestId('transcript-empty')).toBeVisible();
      await shoot(s, theme, { name: 'transcript-nomatch', what: '3 the transcript search with no result', subjects: [['the note', page.getByTestId('transcript-empty')]] });
      await searchField(page).press('Escape');
      await expect(page.getByTestId('transcript-empty')).toHaveCount(0);
      await seek(page, 12_000);
      await atTime(page, 12_000);
      await row(3).focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('[data-testid="cue-row"]:focus')).toHaveCount(1);
      await shoot(s, theme, { name: 'transcript-cursor', what: '3 the keyboard\'s row in the transcript, below the current one', subjects: [['the focused row', page.locator('[data-testid="cue-row"]:focus')]], park: false });
      await stage.focus();
      await page.getByTestId('transcript').hover();
      await page.mouse.wheel(0, 240);
      await expect(page.getByTestId('transcript-follow')).not.toHaveAttribute('data-selected');
      await blur(page);
      await shoot(s, theme, { name: 'transcript-follow-off', what: '3 the transcript scrolled by hand: 따라가기 off', subjects: [['the switch', page.getByTestId('transcript-follow')]] });
      await page.getByTestId('transcript-follow').click();
      await expect(page.getByTestId('transcript-follow')).toHaveAttribute('data-selected');
      await blur(page);

      // ③ a long sentence (three lines) as a third track, on the picture and in the transcript; then back to the first Korean track.
      const attachedLong = await page.evaluate((input) => window.learn.subtitles.attach(input), { itemId, paths: [longFile] });
      if (!attachedLong.ok) throw new Error(`subtitles.attach failed: ${attachedLong.code}`);
      await noMenu(page);
      await menuButton(page).click();
      await page.getByRole('menuitemradio', { name: '한국어 2' }).click();
      await expect(menuButton(page)).toHaveText('한국어 2');
      await seek(page, 2000);
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('둘째 줄');
      await shoot(s, theme, { name: 'overlay-long', what: '3 a three-line sentence on the picture and its row in the transcript', subjects: [['the sentence', page.getByTestId('subtitle-overlay')]] });
      await noMenu(page);
      await menuButton(page).click();
      await page.getByRole('menuitemradio', { name: '한국어', exact: true }).click();
      await expect(menuButton(page)).toHaveText('한국어');

      // ④ 이 자막 제거: the toast with 되돌리기, then the undo.
      await front(s);
      await noMenu(page);
      await menuButton(page).click();
      await page.getByRole('menuitem', { name: '이 자막 제거' }).click();
      await expect(page.getByTestId('subtitle-removed')).toBeVisible();
      await shoot(s, theme, { name: 'toast-removed', what: '4 the toast after 이 자막 제거, with its undo', subjects: [['the toast', page.getByTestId('subtitle-removed')]], front: false, toast: true });
      await page.getByTestId('subtitle-removed').getByTestId('undo-action').click();
      await expect(menuButton(page)).toHaveText('한국어');
      await expect(page.getByTestId('subtitle-removed')).toHaveCount(0, { timeout: 12_000 });
    }

    // The sidebar's vibrancy: the window of the reader as a Mac shows it, the transcript on the sidebar's material (the Mac midpoint could
    // not tell whether the compositing hints keep it). The Linux page has no material to see; the description says what to look at.
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await seek(page, 12_000);
      await atTime(page, 12_000);
      await shoot(s, theme, {
        name: 'sidebar-vibrancy',
        what: '3 the reader with the transcript sidebar (will-change: transform, −12 px bottom margin): does the sidebar keep the window\'s vibrancy — look at its material against the library sidebar of m8a-library',
        subjects: [['the transcript', page.getByTestId('transcript')]],
      });
    }

    // ⑥ the narrowed windows within the display (the macOS runner's display is 1024 wide, so only that one fits there at 1024).
    const room = await displayRoom(s.app);
    const height = await (await mainWindow(s.app)).evaluate((w) => w.getContentSize()[1]!);
    for (const width of NARROW_WIDTHS) {
      if (width > room.width) {
        for (const theme of THEMES) record({ file: null, kind: IS_MAC ? 'window' : 'page', description: `M8a 6 the video reader at ${width} — ${theme}`, skipped: `the display leaves the window ${room.width} px, under ${width}` });
        continue;
      }
      await resize(s, width, height);
      await searchField(page).fill('세포');
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await shoot(s, theme, { name: `w${width}`, what: `6 the video reader in a ${width} wide window with the transcript search holding 세포`, subjects: [['the controls', page.getByTestId('video-controls')], ['the transcript', page.getByTestId('transcript')]] });
      }
      await searchField(page).fill('');
    }
  } finally {
    await closeM8a(s);
  }
});

test('M8a ⑤: the stage mode — the controls shown on the dark bar, a sentence with the bar hidden, the speed menu over the stage', TAG, async () => {
  const s = await launchM8a();
  const { app, page } = s;
  try {
    const itemId = await openLecture(s);
    const attached = await page.evaluate((input) => window.learn.subtitles.attach(input), { itemId, paths: [KO] });
    if (!attached.ok) throw new Error(`subtitles.attach failed: ${attached.code}`);
    await expect(menuButton(page)).toHaveText('한국어');
    const stage = page.getByTestId('video-stage');
    const reader = page.locator('.video-reader');
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await seek(page, 4000);
      await atTime(page, 4000);
      await front(s);
      await page.getByTestId('video-fullscreen').click();
      await expect.poll(() => stageState(app)).toMatchObject({ stage: true, fullScreen: true, pending: false });
      await page.mouse.move(700, 300);
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('인지질');
      await shoot(s, theme, { name: 'stage-bar', what: '5 the stage: the controls shown on the dark bar, a sentence on the picture', subjects: [['the controls', page.getByTestId('video-controls')]], front: false, park: false });

      await stage.focus();
      await page.keyboard.press('k');
      await expect.poll(async () => (await videoState(page))?.paused).toBe(false);
      await page.mouse.move(720, 320);
      await expect(reader).toHaveAttribute('data-idle', '', { timeout: 8000 });
      await expect.poll(async () => (await videoState(page))?.cueText ?? '').toContain('단백질');
      await shoot(s, theme, { name: 'stage-idle', what: '5 the stage playing with the controls hidden after the idle wait, the sentence kept', subjects: [['the sentence', page.getByTestId('subtitle-overlay')]], front: false, park: false });
      await page.keyboard.press('k');
      await expect.poll(async () => (await videoState(page))?.paused).toBe(true);

      await page.mouse.move(720, 330);
      await expect(reader).not.toHaveAttribute('data-idle');
      await page.getByTestId('video-speed').click();
      await expect(page.getByRole('menu', { name: '재생 속도' })).toBeVisible();
      await shoot(s, theme, { name: 'stage-speed-menu', what: '5 the speed menu over the stage', subjects: [['the menu', page.getByRole('menu', { name: '재생 속도' })]], front: false, park: false });
      await page.keyboard.press('Escape');
      await stage.focus();
      await page.keyboard.press('Escape');
      await expect.poll(() => stageState(app)).toMatchObject({ stage: false, fullScreen: false, pending: false });
      await page.mouse.move(5, 5);
    }
  } finally {
    await closeM8a(s);
  }
});

test('M8a ⑥: a video that cannot be played — the notice in the window and in a stage of 440, and the reader while it opens', TAG, async () => {
  const s = await launchM8a();
  const { page } = s;
  try {
    await importPaths(page, [MPEG4, LECTURE]);
    await openItem(page, 'sample-mpeg4part2');
    await expect(page.getByTestId('video-error')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shoot(s, theme, { name: 'unplayable', what: '6 the notice for a video the player cannot decode, the transcript\'s placeholder beside it', subjects: [['the notice', page.getByTestId('video-error')]] });
    }
    // A stage of 440 px (the notice's narrowest case): the reader's width forced, as the fold guard's own measure is.
    await page.evaluate(() => void (document.querySelector<HTMLElement>('.video-reader')!.style.width = '440px'));
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shoot(s, theme, { name: 'unplayable-440', what: '6 the same notice with the reader forced to 440 px wide (the page, not a window size)', subjects: [['the notice', page.getByTestId('video-error')]] });
    }
    await closeReaderTab(page);

    // Opening: the first frame held back (the window's capture phase stops the media events), so the controls stay disabled with the spinner.
    await page.evaluate(() => {
      const stop = (e: Event) => e.stopImmediatePropagation();
      (window as unknown as { __m8aHold: (e: Event) => void }).__m8aHold = stop;
      for (const t of ['loadeddata', 'loadedmetadata', 'canplay']) window.addEventListener(t, stop, true);
    });
    await openItem(page, 'lecture-60s');
    await expect(page.getByTestId('video-controls')).toHaveClass(/is-disabled/);
    await expect(page.getByTestId('transcript-placeholder')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shoot(s, theme, { name: 'opening', what: '6 the reader while the video opens: the controls disabled, the transcript\'s placeholder', subjects: [['the controls', page.getByTestId('video-controls')]] });
    }
    await page.evaluate(() => {
      const hold = (window as unknown as { __m8aHold: (e: Event) => void }).__m8aHold;
      for (const t of ['loadeddata', 'loadedmetadata', 'canplay']) window.removeEventListener(t, hold, true);
    });
  } finally {
    await closeM8a(s);
  }
});

/** What the page's `dragenter` saw of each item of a drag of `file`: the platform's own `kind` and `type`. */
async function dragTypes(page: Page, file: string): Promise<Array<{ kind: string; type: string }>> {
  await dropSource(page, [file]);
  await page.evaluate(() => {
    const g = window as unknown as { __m8aTypes?: Array<{ kind: string; type: string }> };
    g.__m8aTypes = [];
    window.addEventListener('dragenter', (e) => void (g.__m8aTypes = Array.from(e.dataTransfer!.items, (i) => ({ kind: i.kind, type: i.type }))), { capture: true, once: true });
  });
  await drag(page, 'dragenter', 'source', { repeat: false });
  const seen = await page.evaluate(() => (window as unknown as { __m8aTypes: Array<{ kind: string; type: string }> }).__m8aTypes);
  await drag(page, 'dragleave', 'source', { repeat: false });
  return seen;
}

test('M8a ④: dropping on a video tab — the overlay, the mixed drag that is refused, the attached and failure toasts; the types the platform gives a drag', TAG, async () => {
  const s = await launchM8a();
  const { page } = s;
  try {
    const itemId = await openLecture(s);
    await expect(page.getByTestId('subtitle-drop-overlay')).toHaveCount(0);

    // Spec 18: the type string a real DataTransferItem carries for each kind of file here, read by the page as the drop gate reads it.
    const text = path.join(s.dir, 'notes.txt');
    fs.writeFileSync(text, 'not a subtitle');
    const seen: Array<{ file: string; items: Array<{ kind: string; type: string }> }> = [];
    for (const file of [LECTURE, KO, EN, path.join(FIXTURES, 'sample.pdf'), text]) seen.push({ file: path.basename(file), items: await dragTypes(page, file) });
    writeJson('m8a-drop-types.json', { platform: `${process.platform}-${process.arch}`, files: seen }, 'M8a spec 18: the DataTransferItem.type a drag of each kind of file gives on this platform (.srt, .vtt, .mp4, .pdf, .txt)');
    expect(seen.every((f) => f.items.length === 1), 'one item per file, so the types are the platform\'s').toBe(true);

    for (const theme of THEMES) {
      await setTheme(page, theme);
      await removeTracks(page, itemId); // the other theme's pass drops the same subtitle again, as a new one
      await seek(page, 12_000);
      await atTime(page, 12_000);
      // A PDF with a subtitle: the tab takes nothing, so no overlay is drawn.
      await dropSource(page, [path.join(FIXTURES, 'sample.pdf'), UNPAIRED]);
      await drag(page, 'dragenter', 'source');
      expect(await drag(page, 'dragover', 'source')).toBe('none');
      await shoot(s, theme, { name: 'drop-refused', what: '4 a PDF and a subtitle dragged over a video tab: the tab refuses, no overlay', subjects: [['the reader', page.locator('.video-reader')]], park: false });
      await drag(page, 'dragleave', 'source');
      // A subtitle alone: the overlay.
      await dropSource(page, [EN]);
      await drag(page, 'dragenter', 'source');
      await expect(page.getByTestId('subtitle-drop-overlay')).toBeVisible();
      await shoot(s, theme, { name: 'drop-overlay', what: '4 a subtitle file dragged over the video tab: the overlay', subjects: [['the overlay', page.getByTestId('subtitle-drop-overlay')]], park: false });
      await front(s);
      await drag(page, 'drop', 'source');
      await expect(page.getByTestId('subtitle-attached')).toBeVisible();
      await shoot(s, theme, { name: 'drop-attached', what: '4 the toast after the drop attached the subtitle', subjects: [['the toast', page.getByTestId('subtitle-attached')]], front: false, toast: true });
      await expect(page.getByTestId('subtitle-attached')).toHaveCount(0, { timeout: 12_000 });
      // A file that is no subtitle: the failure toast with its reason.
      await dropSource(page, [text]);
      await drag(page, 'dragenter', 'source');
      await front(s);
      await drag(page, 'drop', 'source');
      await expect(page.getByTestId('subtitle-failed')).toBeVisible();
      await shoot(s, theme, { name: 'drop-failed', what: '4 the failure toast for a dropped file that is no subtitle', subjects: [['the toast', page.getByTestId('subtitle-failed')]], front: false, toast: true });
      // A failure stays until it is closed.
      await page.getByTestId('subtitle-failed').getByTestId('toast-close').click();
      await expect(page.getByTestId('subtitle-failed')).toHaveCount(0);
    }
  } finally {
    await closeM8a(s);
  }
});

test('M8a ⑦: the library — the drop summary for a video and two subtitles, the ⌥ card, the import toasts, the item panel\'s 자막 line and its time rows, the scope menu', TAG, async () => {
  const s = await launchM8a();
  const { app, page } = s;
  const field = page.getByTestId('search-field').locator('input');
  const scopeButton = page.getByTestId('search-scope');
  const matches = page.getByTestId('matches-section');
  /** A fresh pair of the lecture and its Korean subtitle under one name (an import of the same file again would ask about a duplicate). */
  const pair = (name: string): string[] => {
    const mp4 = path.join(s.dir, `${name}.mp4`);
    const srt = path.join(s.dir, `${name}.ko.srt`);
    fs.writeFileSync(mp4, Buffer.concat([fs.readFileSync(LECTURE), Buffer.from(name)])); // other bytes, or the import asks about a duplicate
    fs.copyFileSync(KO, srt);
    return [mp4, srt];
  };
  try {
    const three: Array<[string, string]> = [['lecture-60s.mp4', 'video/mp4'], ['lecture-60s.ko.srt', 'application/x-subrip'], ['lecture-60s.en.vtt', 'text/vtt']];
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await drag(page, 'dragenter', three);
      await expect(page.getByTestId('drop-overlay')).toBeVisible();
      await shoot(s, theme, { name: 'library-drop', what: '7 a video and two subtitles dragged over the library: 파일 3개 (동영상 1 · 자막 2)', subjects: [['the overlay', page.getByTestId('drop-overlay')]], park: false });
      await drag(page, 'dragover', three, { altKey: true });
      await expect(page.getByTestId('drop-overlay')).toHaveAttribute('data-mode', 'link');
      await shoot(s, theme, { name: 'library-drop-link', what: '7 the same drag with ⌥ held: the link card, its rows aligned with its third line', subjects: [['the overlay', page.getByTestId('drop-overlay')]], park: false });
      await drag(page, 'dragleave', three);
      await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    }

    // Imports by drop: the video with its Korean subtitle (the toast counts the subtitle), and a subtitle with no video (the failure row).
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await front(s);
      await dropSource(page, pair(`강의-${theme}`));
      for (const type of ['dragenter', 'dragover', 'drop'] as const) await drag(page, type, 'source');
      await expect(page.getByTestId('import-done')).toBeVisible();
      await shoot(s, theme, { name: 'import-done', what: '7 the import toast for a video dropped with its subtitle: the count names the subtitle', subjects: [['the toast', page.getByTestId('import-done')]], front: false, toast: true });
      await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 12_000 });
      await front(s);
      await dropSource(page, [UNPAIRED]);
      for (const type of ['dragenter', 'dragover', 'drop'] as const) await drag(page, type, 'source');
      await expect(page.getByTestId('import-failures')).toBeVisible();
      await shoot(s, theme, { name: 'import-unpaired', what: '7 the failure toast for a subtitle whose video is not among the files', subjects: [['the toast', page.getByTestId('import-failures')]], front: false, toast: true });
      await page.getByTestId('import-failures').getByTestId('toast-close').click();
      await expect(page.getByTestId('import-failures')).toHaveCount(0);
    }

    // The item panel of the video: its 자막 line, then the time rows of 본문 일치 (one track, then two), the scope menu, nothing found.
    const dir = path.join(s.dir, 'two');
    fs.mkdirSync(dir);
    const twoVideo = path.join(dir, '강의-두 자막.mp4');
    fs.writeFileSync(twoVideo, Buffer.concat([fs.readFileSync(LECTURE), Buffer.from('two')]));
    const cue = (text: string) => `1\n01:05:12,000 --> 01:05:15,000\n${text}\n`;
    const ko2 = path.join(dir, 'a.ko.srt');
    const pt2 = path.join(dir, 'a.pt-BR.srt');
    fs.writeFileSync(ko2, cue('ATP 없이는 칼슘 펌프가 칼슘 이온을 세포 밖으로 내보내지 못합니다.'));
    fs.writeFileSync(pt2, cue('ATP: a bomba de cálcio leva os íons de cálcio para fora da célula.'));
    const [withTwo] = await importPaths(page, [twoVideo]);
    for (const file of [ko2, pt2]) {
      const r = await page.evaluate((input) => window.learn.subtitles.attach(input), { itemId: withTwo!.id, paths: [file] });
      if (!r.ok) throw new Error(`subtitles.attach failed: ${r.code}`);
    }
    await showItemPanel(app, page);
    const subtitlesLine = page.locator('[data-testid="file-row"][data-field="subtitles"]');
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await field.fill('');
      await selectRows(page, [`강의-${theme}`]);
      await expect(subtitlesLine).toBeVisible();
      await shoot(s, theme, { name: 'panel-subtitles', what: '7 the item panel of a video with one subtitle: the 자막 line in the file section', subjects: [['the 자막 line', subtitlesLine]], park: false });
    }
    await scopeButton.click();
    await expect(page.getByRole('menu', { name: '검색 범위' })).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shoot(s, theme, { name: 'scope-menu', what: '7 the search scope menu: 정보와 본문 says "PDF 본문·자막 포함"', subjects: [['the menu', page.getByRole('menu', { name: '검색 범위' })]], park: false });
    }
    await page.getByRole('menu', { name: '검색 범위' }).getByRole('menuitemradio', { name: '정보와 본문', exact: true }).click();
    await expect(page.getByRole('menu', { name: '검색 범위' })).toHaveCount(0);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await field.fill('칼슘 펌프');
      await selectRows(page, [`강의-${theme}`]);
      await expect(matches.getByTestId('matches-count')).toHaveText('문장 2개');
      await shoot(s, theme, { name: 'time-rows-one', what: '7 본문 일치 of a video with one subtitle: a time row per sentence, the clock and the snippet', subjects: [['the rows', matches]], park: false });
      await field.fill('ATP');
      await expect(rowByTitle(page, withTwo!.title)).toBeVisible();
      await selectRows(page, [withTwo!.title]);
      await expect(matches.getByTestId('matches-count')).toHaveText('문장 2개');
      await shoot(s, theme, { name: 'time-rows-two', what: '7 본문 일치 of a video with two subtitles: the clock and the track\'s name on each row', subjects: [['the rows', matches]], park: false });
      await field.fill('없는낱말입니다');
      await expect(page.getByTestId('search-empty')).toBeVisible();
      await shoot(s, theme, { name: 'no-results', what: '7 a search of 정보와 본문 that found nothing: the note names 자막', subjects: [['the note', page.getByTestId('search-empty')]] });
    }
  } finally {
    await closeM8a(s);
  }
});
