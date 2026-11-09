// M7c images: the five raster formats import by their first bytes (a wrong extension does not matter) and the pixel size
// is stored with the asset; the image reader fits, zooms, moves, turns and remembers the picture (spec 4.1–4.4).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { commandById, commandLabel } from '../../packages/domain/src/commands';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, backFromReader, closeReaderTab, drag, dropSource, expectDisabledReason, hardKill, imageState, importPaths, launch, libraryTab, mainWindow, menuItemEnabled, openItem, quiet, readerTab, rowByTitle, runMenuCommand, selectRows, settled, specialRow, trashItems,
  type ImageReaderState,
} from './helpers';

const PHOTO = path.join(FIXTURES, 'photo-4032.jpg'); // 4032 × 3024
const GIF = path.join(FIXTURES, 'two-frames.gif'); // 24 × 16
const ORIENT6 = path.join(FIXTURES, 'orient6.jpg'); // stored 60 × 40, EXIF orientation 6
const BROKEN = path.join(FIXTURES, 'broken.png'); // a PNG head and nothing after it

test.beforeAll(() => {
  for (const f of [PHOTO, GIF, ORIENT6, BROKEN]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const stage = (page: Page) => page.getByTestId('image-stage');
const zoomField = (page: Page) => page.getByTestId('image-zoom-field');
const zoomMenu = (page: Page) => page.getByTestId('image-zoom-menu');
const viewMenu = (page: Page) => page.getByTestId('image-view-menu');

/** Until the shown tab's picture is drawn (item `itemId` when given); its state then. */
async function drawn(page: Page, itemId?: string): Promise<ImageReaderState> {
  await expect.poll(async () => {
    const s = await imageState(page);
    return s && (itemId === undefined || s.itemId === itemId) ? s.status : null;
  }, { message: 'the picture is drawn' }).toBe('shown');
  return (await imageState(page))!;
}

const scaleOf = async (page: Page) => (await imageState(page))?.scale;

/**
 * The point of the upright picture (0–1) under a stage point (stage px from its top left; the stage's centre when absent), read from
 * where the picture is on screen — not from the reader's own arithmetic. The turned picture's box on screen is the img's bounding box.
 */
async function pictureAt(page: Page, at?: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const rotation = (await imageState(page))!.rotation;
  return page.evaluate(({ at, rotation }) => {
    const el = document.querySelector<HTMLElement>('[data-testid="tab-panel"][data-active="true"] [data-testid="image-stage"]')!;
    const s = el.getBoundingClientRect();
    const r = el.querySelector('img')!.getBoundingClientRect();
    const u = (s.left + (at ? at.x : el.clientWidth / 2) - r.left) / r.width;
    const v = (s.top + (at ? at.y : el.clientHeight / 2) - r.top) / r.height;
    if (rotation === 90) return { x: v, y: 1 - u };
    if (rotation === 180) return { x: 1 - u, y: 1 - v };
    if (rotation === 270) return { x: 1 - v, y: u };
    return { x: u, y: v };
  }, { at: at ?? null, rotation });
}

const expectNear = (got: { x: number; y: number }, want: { x: number; y: number }, what: string) => {
  expect(Math.abs(got.x - want.x), `${what}: x ${got.x} vs ${want.x}`).toBeLessThanOrEqual(0.01);
  expect(Math.abs(got.y - want.y), `${what}: y ${got.y} vs ${want.y}`).toBeLessThanOrEqual(0.01);
};

/** The stage's scroll box and the picture's place in it (stage px). */
const stageBox = (page: Page) =>
  stage(page).evaluate((el) => {
    const s = el.getBoundingClientRect();
    const r = el.querySelector('img')!.getBoundingClientRect();
    return {
      clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
      left: r.left - s.left, top: r.top - s.top, right: s.left + el.clientWidth - r.right, bottom: s.top + el.clientHeight - r.bottom, width: r.width, height: r.height,
    };
  });

/** Scrolls the stage as a user would and waits for the reader to take the new centre. */
async function scrollStageTo(page: Page, left: number, top: number): Promise<{ x: number; y: number }> {
  await stage(page).evaluate((el, [l, t]) => {
    el.scrollLeft = l!;
    el.scrollTop = t!;
  }, [left, top]);
  const want = await pictureAt(page);
  await expect.poll(async () => {
    const s = (await imageState(page))!;
    return Math.abs(s.cx - want.x) <= 0.002 && Math.abs(s.cy - want.y) <= 0.002;
  }, { message: 'the reader took the scrolled centre' }).toBe(true);
  return want;
}

const stored = async (page: Page, itemId: string) => {
  const r = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), itemId);
  if (!r.ok) throw new Error(`reader.getPosition failed: ${r.code}`);
  return r.data;
};

const menuLabel = (app: ElectronApplication, id: string) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.label ?? null, id);

test('five raster formats import by their header — a PNG named .jpg too — with their pixel size', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const names = ['transparent.png', 'orient6.jpg', 'alpha.webp', 'two-frames.gif', 'still.avif', 'png-named.jpg'];
    // png-named.jpg has the bytes of transparent.png: it comes in as a second item on purpose.
    const items = await importPaths(page, names.map((n) => path.join(FIXTURES, n)), { allowDuplicate: true });
    // The same bytes share one asset (and its original name), so the items are told apart by their titles.
    const byName = new Map(items.map((i) => [i.title, i]));
    const expected = [
      ['transparent', 'image/png', { width: 64, height: 48 }],
      ['orient6', 'image/jpeg', { width: 40, height: 60 }], // EXIF orientation 6 swaps the stored 60×40
      ['alpha', 'image/webp', { width: 48, height: 32 }],
      ['two-frames', 'image/gif', { width: 24, height: 16 }],
      ['still', 'image/avif', { width: 40, height: 30 }],
      ['png-named', 'image/png', { width: 64, height: 48 }],
    ] as const;
    for (const [name, mime, imageSize] of expected) expect(byName.get(name), name).toMatchObject({ type: 'image', mime, imageSize });
  } finally {
    await app.close();
  }
});

test('a picture opens fitted to the window — a large photo below 100 % with 24 round it, centred; a small one at 100 %, never enlarged', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [photo, gif] = await importPaths(page, [PHOTO, GIF]);
    await openItem(page, 'photo-4032');
    const s = await drawn(page, photo!.id);
    expect(s).toMatchObject({ zoom: 'fit', rotation: 0, natural: { width: 4032, height: 3024 } });
    expect(s.scale).toBeLessThan(1);
    const b = await stageBox(page);
    // 24 on the tighter side, the same on both sides of each axis, and nothing to scroll.
    expect(Math.min(b.left, b.top)).toBeCloseTo(24, 0);
    expect(Math.abs(b.left - b.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.top - b.bottom)).toBeLessThanOrEqual(1);
    expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth);
    expect(b.scrollHeight).toBeLessThanOrEqual(b.clientHeight);
    await expect(zoomField(page)).toHaveValue(`${Math.round(s.scale * 100)}%`);
    await expect(page.getByRole('toolbar', { name: '이미지 도구' })).toBeVisible();
    await expect(page.getByRole('region', { name: '이미지', exact: true })).toBeVisible();
    await expect(stage(page).locator('img')).toHaveAttribute('alt', 'photo-4032');
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    // The menu bar names the fit for a picture, and the reader's PDF-only commands stay off.
    await expect.poll(() => menuLabel(app, 'reader.zoomPageFit')).toBe('창에 맞춤');
    await expect.poll(() => menuItemEnabled(app, 'reader.zoomPageFit')).toBe(true);
    expect(await menuItemEnabled(app, 'reader.zoomAuto')).toBe(false);
    expect(await menuItemEnabled(app, 'library.find')).toBe(false);
    await expectNoSeriousA11y(page, 'image reader, fitted');

    // A picture smaller than the stage is not enlarged.
    await libraryTab(page).click();
    await expect.poll(() => menuLabel(app, 'reader.zoomPageFit')).toBe('한 쪽 전체 보기');
    await openItem(page, 'two-frames');
    expect(await drawn(page, gif!.id)).toMatchObject({ zoom: 'fit', scale: 1, natural: { width: 24, height: 16 } });
    await expect(zoomField(page)).toHaveValue('100%');
  } finally {
    await app.close();
  }
});

test('while the picture opens: the stage’s ground only, the field "…" and the ▾ off with its reason, no zoom command; then the picture', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PHOTO]);
    // The decode is held in the page, so the opening state stays on screen until the test lets it go.
    await page.evaluate(() => {
      const own = HTMLImageElement.prototype.decode;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      (window as unknown as { __releaseDecode: () => void }).__releaseDecode = release;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        return gate.then(() => own.call(this));
      };
    });
    await openItem(page, 'photo-4032');
    await expect.poll(async () => (await imageState(page))?.status).toBe('loading');
    await expect(stage(page)).toHaveAttribute('aria-busy', 'true');
    await expect(stage(page).locator('img')).toBeHidden();
    await expect(zoomField(page)).toBeDisabled();
    await expect(zoomField(page)).toHaveValue('');
    await expect(zoomField(page)).toHaveAttribute('placeholder', '…');
    await expect(zoomField(page)).toHaveCSS('opacity', '0.45'); // drawn as a disabled control, its box with it
    await expectDisabledReason(zoomMenu(page), '이미지를 여는 중입니다');
    await expectDisabledReason(viewMenu(page), '이미지를 여는 중입니다');
    await expect.poll(() => menuItemEnabled(app, 'reader.imageBackgroundDark')).toBe(false);
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(false);
    await expectNoSeriousA11y(page, 'image reader, opening');
    await page.evaluate(() => (window as unknown as { __releaseDecode: () => void }).__releaseDecode());
    const s = await drawn(page);
    await expect(stage(page).locator('img')).toBeVisible();
    await expect(stage(page)).not.toHaveAttribute('aria-busy', /.*/);
    await expectDisabledReason(zoomMenu(page), null);
    await expectDisabledReason(viewMenu(page), null);
    await expect.poll(() => menuItemEnabled(app, 'reader.imageBackgroundDark')).toBe(true);
    await expect(zoomField(page)).toHaveValue(`${Math.round(s.scale * 100)}%`);
    await expect(zoomField(page)).toHaveCSS('opacity', '1');
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(true);
  } finally {
    await app.close();
  }
});

test('⌘+ ⌘− ⌘0 walk the steps and keep the picture point at the stage centre; the field takes a percent, 5–800 %', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    const fit = (await drawn(page)).scale;
    // From the fit a step is the next step up, and the zoom becomes a number.
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(() => scaleOf(page)).toBe([0.05, 0.1, 0.17, 0.25, 0.33, 0.5].find((x) => x > fit + 0.005));
    expect(typeof (await imageState(page))!.zoom).toBe('number');
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => scaleOf(page)).toBe(1);
    await expect(zoomField(page)).toHaveValue('100%');
    const p = await scrollStageTo(page, 1100, 700);
    expect(p.x).toBeGreaterThan(0.3);
    for (const [id, scale] of [['view.textBigger', 1.25], ['view.textBigger', 1.5], ['view.textSmaller', 1.25], ['view.textSmaller', 1], ['view.textSmaller', 0.75]] as const) {
      await runMenuCommand(app, id);
      await expect.poll(() => scaleOf(page)).toBe(scale);
      expectNear(await pictureAt(page), p, `${id} → ${scale}`);
      const s = (await imageState(page))!;
      expectNear({ x: s.cx, y: s.cy }, p, `the reader's centre at ${scale}`);
    }
    // The field: a percent, ↩ zooms there about the centre; beyond the ends it is held at 800 % and 5 %.
    await zoomField(page).fill('300');
    await zoomField(page).press('Enter');
    await expect.poll(() => scaleOf(page)).toBe(3);
    expectNear(await pictureAt(page), p, 'typed 300');
    await expect(zoomField(page)).toHaveValue('300%');
    await zoomField(page).fill('1000%');
    await zoomField(page).press('Enter');
    await expect.poll(() => scaleOf(page)).toBe(8);
    await runMenuCommand(app, 'view.textBigger');
    await settled(page);
    expect(await scaleOf(page)).toBe(8); // the top step stays
    await zoomField(page).fill('2');
    await zoomField(page).press('Enter');
    await expect.poll(() => scaleOf(page)).toBe(0.05);
    // esc gives the value back and the focus to the stage.
    await zoomField(page).fill('abc');
    await zoomField(page).press('Escape');
    await expect(zoomField(page)).toHaveValue('5%');
    await expect(stage(page)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the zoom menu — 창에 맞춤 · 너비에 맞춤 · 실제 크기 · 확대 · 축소, the mode checked; 너비에 맞춤 fills the width and a tall picture scrolls down', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    // A quarter turn makes the photo tall, whatever the window's shape.
    await runMenuCommand(app, 'reader.rotateCw');
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);
    await zoomMenu(page).click();
    const menu = page.getByRole('menu', { name: '확대 메뉴' });
    await expect(menu.locator('.mi-label')).toHaveText(['창에 맞춤', '너비에 맞춤', '실제 크기', '확대', '축소']);
    await expect(menu.locator('[aria-checked="true"] .mi-label')).toHaveText(['창에 맞춤']);
    await expectNoSeriousA11y(page, 'image zoom menu');
    await menu.getByRole('menuitemradio', { name: '너비에 맞춤' }).click();
    await expect.poll(async () => (await imageState(page))?.zoom).toBe('width');
    const b = await stageBox(page);
    expect((await imageState(page))!.scale).toBeCloseTo((b.clientWidth - 48) / 3024, 3);
    expect(b.scrollHeight).toBeGreaterThan(b.clientHeight);
    expect(b.scrollWidth).toBeLessThanOrEqual(b.clientWidth);
    await zoomMenu(page).click();
    await expect(menu.locator('[aria-checked="true"] .mi-label')).toHaveText(['너비에 맞춤']);
    await menu.getByRole('menuitem', { name: '실제 크기' }).click();
    await expect.poll(() => scaleOf(page)).toBe(1);
    await zoomMenu(page).click();
    await expect(menu.locator('.mi-label')).toHaveText(['창에 맞춤', '너비에 맞춤', '실제 크기', '확대', '축소']);
    await expect(menu.locator('[aria-checked="true"]')).toHaveCount(0); // a number is no mode
    await menu.getByRole('menuitemradio', { name: '창에 맞춤' }).click();
    await expect.poll(async () => (await imageState(page))?.zoom).toBe('fit');
    const fitted = await stageBox(page);
    expect(fitted.scrollHeight).toBeLessThanOrEqual(fitted.clientHeight);
    expect(Math.min(fitted.left, fitted.top)).toBeCloseTo(24, 0);
  } finally {
    await app.close();
  }
});

test('a pinch zooms about the point under the pointer; the picture is dragged only while it is larger than the stage; an arrow key scrolls 40', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => scaleOf(page)).toBe(1);
    await scrollStageTo(page, 900, 600);
    const at = { x: 300, y: 200 };
    const under = await pictureAt(page, at);
    const cancelled = await stage(page).evaluate((el, at) => {
      const r = el.getBoundingClientRect();
      return !el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: r.left + at.x, clientY: r.top + at.y, cancelable: true, bubbles: true }));
    }, at);
    expect(cancelled, 'the pinch is the reader’s, not the page zoom').toBe(true);
    await expect.poll(() => scaleOf(page)).toBeCloseTo(Math.E, 4);
    expectNear(await pictureAt(page, at), under, 'the point under the pointer');

    // Larger than the stage: a drag moves it, with the hand.
    await zoomField(page).fill('400');
    await zoomField(page).press('Enter');
    await expect.poll(() => scaleOf(page)).toBe(4);
    await expect(stage(page)).toHaveAttribute('data-pannable', '');
    await expect(stage(page)).toHaveCSS('cursor', 'grab');
    const before = await stageBox(page);
    const box = (await stage(page).boundingBox())!;
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y - 50, { steps: 4 });
    await page.mouse.move(x - 200, y - 100, { steps: 4 });
    await expect(stage(page)).toHaveAttribute('data-panning', '');
    await expect(stage(page)).toHaveCSS('cursor', 'grabbing');
    await page.mouse.up();
    await expect(stage(page)).not.toHaveAttribute('data-panning', /.*/);
    const after = await stageBox(page);
    expect(after.scrollLeft - before.scrollLeft).toBeCloseTo(200, 0);
    expect(after.scrollTop - before.scrollTop).toBeCloseTo(100, 0);
    await expect(stage(page)).toBeFocused(); // pressed, the stage takes the keys

    // The arrow keys scroll the stage as any scroll area: 40 a press. Each key waits for the stage to stop scrolling: Chromium drops a key
    // scroll that comes within a frame or two of the end of the scroll animation before it (12 of 25 ArrowRight presses right after an
    // ArrowDown's 40 was reached; none after a quiet stage).
    const stageSelector = '[data-testid="tab-panel"][data-active="true"] [data-testid="image-stage"]';
    await stage(page).evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    await expect.poll(() => stage(page).evaluate((el) => `${el.scrollLeft},${el.scrollTop}`)).toBe('0,0');
    await quiet(page, stageSelector);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => stage(page).evaluate((el) => el.scrollTop)).toBe(40);
    await quiet(page, stageSelector);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => stage(page).evaluate((el) => el.scrollLeft)).toBe(40);

    // Fitted, the whole picture is in view: no drag, no hand (after the same stage showed both above).
    await runMenuCommand(app, 'reader.zoomPageFit');
    await expect.poll(async () => (await imageState(page))?.zoom).toBe('fit');
    await expect(stage(page)).not.toHaveAttribute('data-pannable', /.*/);
    await expect(stage(page)).toHaveCSS('cursor', 'default'); // the app's own
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 100, y - 50, { steps: 4 });
    await page.mouse.move(x - 200, y - 100, { steps: 4 });
    // Held as above, where the drag showed at once: no drag starts on a picture that fits.
    await settled(page);
    expect(await stage(page).getAttribute('data-panning')).toBeNull();
    await page.mouse.up();
  } finally {
    await app.close();
  }
});

test('⌘R and ⌘L turn the picture a quarter at a time and keep the point at the stage centre; fitted, the turn fits again', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    const fit0 = (await drawn(page)).scale;
    await runMenuCommand(app, 'reader.rotateCw');
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);
    const b = await stageBox(page);
    expect(b.height).toBeGreaterThan(b.width); // the photo stands up
    expect((await imageState(page))!.scale).toBeLessThan(fit0); // and fits again, smaller
    expect((await imageState(page))!.natural).toEqual({ width: 4032, height: 3024 }); // the file is not turned
    await runMenuCommand(app, 'reader.rotateCcw');
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(0);
    await expect.poll(() => scaleOf(page)).toBeCloseTo(fit0, 6);

    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => scaleOf(page)).toBe(1);
    const p = await scrollStageTo(page, 1000, 650);
    for (const [id, rotation] of [['reader.rotateCw', 90], ['reader.rotateCw', 180], ['reader.rotateCcw', 90], ['reader.rotateCcw', 0], ['reader.rotateCcw', 270]] as const) {
      await runMenuCommand(app, id);
      await expect.poll(async () => (await imageState(page))?.rotation).toBe(rotation);
      expect(await scaleOf(page)).toBe(1);
      expectNear(await pictureAt(page), p, `${id} → ${rotation}°`);
    }
  } finally {
    await app.close();
  }
});

test('⌘− at a corner records the point the stage shows, and that point is at the centre after a resize and after a relaunch', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  let closed = false;
  try {
    const [photo] = await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => scaleOf(page)).toBe(1);
    const zoomedAbout = await scrollStageTo(page, 0, 0);
    await runMenuCommand(app, 'view.textSmaller');
    await expect.poll(() => scaleOf(page)).toBe(0.75);
    // The scroll is held at the top left, so the centre moved off the point zoomed about.
    const shows = await pictureAt(page);
    expect(shows.x - zoomedAbout.x).toBeGreaterThan(0.02);
    const s = (await imageState(page))!;
    expectNear({ x: s.cx, y: s.cy }, shows, 'the reader’s centre after ⌘− at the corner');
    await expect
      .poll(async () => {
        const l = (await stored(page, photo!.id))?.locator;
        return l?.kind === 'image' && l.zoom === 0.75 && Math.abs((l.cx ?? 0.5) - shows.x) <= 0.002 && Math.abs((l.cy ?? 0.5) - shows.y) <= 0.002;
      }, { message: 'the stored centre is the point the stage shows' })
      .toBe(true);

    // A smaller window: the scale stays and the same point is at the centre.
    const win = await mainWindow(app);
    const [w, h] = await win.evaluate((x) => x.getContentSize());
    const before = (await stageBox(page)).clientWidth;
    await win.evaluate((x, [cw, ch]) => x.setContentSize(cw!, ch!), [w! - 60, h! - 120]);
    await expect.poll(async () => (await stageBox(page)).clientWidth).toBeLessThan(before);
    await expect.poll(async () => {
      const p = await pictureAt(page);
      return Math.abs(p.x - shows.x) <= 0.01 && Math.abs(p.y - shows.y) <= 0.01;
    }, { message: 'the same point at the centre of the smaller stage' }).toBe(true);
    expect(await scaleOf(page)).toBe(0.75);

    await app.close();
    closed = true;
    ({ app, page } = await launch(lib, ud));
    closed = false;
    await drawn(page, photo!.id);
    expect(await scaleOf(page)).toBe(0.75);
    expectNear(await pictureAt(page), shows, 'after a relaunch');
  } finally {
    if (!closed) await app.close().catch(() => {});
  }
});

test('the zoom, the centre and the turn come back with the tab — closed and reopened (⇧⌘T), after a quit and after a SIGKILL', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  let killed = false;
  try {
    const [photo] = await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    await runMenuCommand(app, 'reader.rotateCw');
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);
    await zoomField(page).fill('200');
    await zoomField(page).press('Enter');
    await expect.poll(() => scaleOf(page)).toBe(2);
    const p = await scrollStageTo(page, 1500, 1100);
    // On disk before anything ends: the debounce is 300 ms.
    await expect
      .poll(async () => {
        const l = (await stored(page, photo!.id))?.locator;
        return l?.kind === 'image' && l.zoom === 2 && l.rotation === 90 && Math.abs((l.cx ?? 0.5) - p.x) <= 0.002 && Math.abs((l.cy ?? 0.5) - p.y) <= 0.002;
      }, { message: 'the place is stored' })
      .toBe(true);
    const back = async (how: string) => {
      const s = await drawn(page, photo!.id);
      expect(s.zoom, how).toBe(2);
      expect(s.rotation, how).toBe(90);
      expectNear({ x: s.cx, y: s.cy }, p, `${how}: the reader's centre`);
      expectNear(await pictureAt(page), p, `${how}: the picture at the centre`);
      await expect(zoomField(page)).toHaveValue('200%');
    };

    await closeReaderTab(page);
    await expect(readerTab(page, photo!.id)).toHaveCount(0);
    await runMenuCommand(app, 'tab.reopenClosed');
    await back('reopened');

    await app.close();
    ({ app, page } = await launch(lib, ud));
    await back('after a quit');

    await hardKill(app);
    killed = true;
    ({ app, page } = await launch(lib, ud));
    killed = false;
    await back('after a SIGKILL');
  } finally {
    if (!killed) await app.close().catch(() => {});
  }
});

for (const frames of ['let through', 'held'] as const) {
  test(`a graceful quit right after a change of view keeps the zoom, the centre and the turn (the frames after the change ${frames})`, async ({}, testInfo) => {
    test.setTimeout(90_000);
    const lib = testInfo.outputPath('library');
    const ud = testInfo.outputPath('userdata');
    let { app, page } = await launch(lib, ud);
    let closed = false;
    try {
      const [photo] = await importPaths(page, [PHOTO]);
      await openItem(page, 'photo-4032');
      await drawn(page);
      await runMenuCommand(app, 'reader.rotateCw');
      await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);
      await zoomField(page).fill('200');
      await zoomField(page).press('Enter');
      await expect.poll(() => scaleOf(page)).toBe(2);
      // The last change is a scroll the reader has taken (its scroll event comes with a frame) ...
      const p = await scrollStageTo(page, 1500, 1100);
      let scale = 2;
      if (frames === 'held') {
        // ... or, with no frame let through after it, a step of ⌘+: what the saver hears must not wait for a frame.
        await page.evaluate(() => {
          window.requestAnimationFrame = (() => 0) as typeof window.requestAnimationFrame;
        });
        await runMenuCommand(app, 'view.textBigger');
        await expect.poll(() => scaleOf(page)).toBe(3);
        scale = 3;
      }
      // Only the reader's state was waited for, never the disk.
      const s = (await imageState(page))!;
      expectNear({ x: s.cx, y: s.cy }, p, 'the reader’s centre before the quit');
      await app.close();
      closed = true;
      ({ app, page } = await launch(lib, ud));
      closed = false;
      const back = await drawn(page, photo!.id);
      expect(back.zoom).toBe(scale);
      expect(back.rotation).toBe(90);
      expectNear({ x: back.cx, y: back.cy }, p, 'after the quit: the reader’s centre');
      expectNear(await pictureAt(page), p, 'after the quit: the picture at the centre');
    } finally {
      if (!closed) await app.close().catch(() => {});
    }
  });
}

test('an image tab not shown while its picture comes — opened with ⌘↩, or hidden before its decode ends — is drawn at its stage’s fit and counted read only once shown', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const second = path.join(testInfo.outputPath('in'), 'photo-b.jpg');
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.copyFileSync(PHOTO, second);
    const [photo, gif, other] = await importPaths(page, [PHOTO, GIF, second], { allowDuplicate: true });
    const progress = async (id: string) => (await stored(page, id))?.progress ?? null;
    const fitted = async (what: string) => {
      const b = await stageBox(page);
      expect(Math.min(b.left, b.top), what).toBeCloseTo(24, 0);
      expect(Math.abs(b.left - b.right), what).toBeLessThanOrEqual(1);
      expect(Math.abs(b.top - b.bottom), what).toBeLessThanOrEqual(1);
    };

    // ⌘↩: a tab behind the library. The shown tab gives the positive: the GIF opened by hand is drawn and counted read.
    await rowByTitle(page, 'photo-4032').click();
    await runMenuCommand(app, 'item.openInBackground');
    await expect(readerTab(page, photo!.id)).toBeVisible();
    await openItem(page, 'two-frames');
    await drawn(page, gif!.id);
    await expect.poll(() => progress(gif!.id)).toBe(1);
    await settled(page);
    expect((await imageState(page, photo!.id))?.status ?? 'not mounted').not.toBe('shown');
    expect(await progress(photo!.id)).toBeNull();
    await readerTab(page, photo!.id).click();
    expect(await drawn(page, photo!.id)).toMatchObject({ zoom: 'fit' });
    await fitted('⌘↩ tab, shown');
    await expect.poll(() => progress(photo!.id)).toBe(1);

    // Hidden while its decode is held, then let go: decoded behind the library, placed and counted only when shown.
    await page.evaluate(() => {
      const own = HTMLImageElement.prototype.decode;
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      (window as unknown as { __releaseDecode: () => void }).__releaseDecode = release;
      HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
        return gate.then(() => own.call(this));
      };
    });
    await libraryTab(page).click();
    await openItem(page, 'photo-b');
    await expect.poll(async () => (await imageState(page))?.itemId).toBe(other!.id);
    expect((await imageState(page))!.status).toBe('loading');
    await libraryTab(page).click();
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${other!.id}"]`)).toHaveAttribute('data-active', 'false');
    await page.evaluate(() => (window as unknown as { __releaseDecode: () => void }).__releaseDecode());
    await expect.poll(async () => (await imageState(page, other!.id))?.natural, { message: 'decoded while hidden' }).toEqual({ width: 4032, height: 3024 });
    await settled(page);
    expect((await imageState(page, other!.id))!.status).toBe('loading');
    expect(await progress(other!.id)).toBeNull();
    await readerTab(page, other!.id).click();
    expect(await drawn(page, other!.id)).toMatchObject({ zoom: 'fit' });
    await fitted('hidden while decoded, shown');
    await expect.poll(() => progress(other!.id)).toBe(1);
  } finally {
    await app.close();
  }
});

test('the progress column says 완료 once the picture is drawn; one that cannot be drawn says so and is not counted read', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [photo, broken] = await importPaths(page, [PHOTO, BROKEN]);
    const cell = (title: string) => rowByTitle(page, title).locator('[data-col="progress"]');
    await expect(cell('photo-4032')).toHaveText('');
    await openItem(page, 'photo-4032');
    await drawn(page, photo!.id);
    await expect.poll(async () => (await stored(page, photo!.id))?.progress).toBe(1);
    await backFromReader(page);
    await expect(cell('photo-4032')).toHaveText('완료');
    await expect(cell('photo-4032').getByTestId('progress-done')).toBeVisible();

    await openItem(page, 'broken');
    const notice = page.getByTestId('image-error');
    await expect(notice.getByRole('heading')).toHaveText('이 이미지를 표시할 수 없습니다');
    await expect(notice).toContainText('파일 내용이 손상되었거나 그릴 수 없는 형식입니다.');
    await expect(notice).toContainText('broken.png');
    await expect(notice.getByTestId('image-reveal')).toHaveText(commandLabel(commandById('item.showInFolder'), process.platform));
    await expect(notice.getByTestId('image-open')).toHaveText(commandById('item.openExternally').label);
    expect(await imageState(page)).toMatchObject({ itemId: broken!.id, status: 'error' });
    await expect(page.getByTestId('image-toolbar')).toHaveCount(0); // a final state: the notice alone
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(false);
    await expectNoSeriousA11y(page, 'image that cannot be drawn');
    // Not read: the open is recorded, no progress (the photo above reached 1 by the same path).
    await settled(page);
    const p = await stored(page, broken!.id);
    expect(p?.openedAt).not.toBeNull();
    expect(p?.progress ?? null).toBeNull();
    await backFromReader(page);
    await expect(cell('broken')).toHaveText('');
  } finally {
    await app.close();
  }
});

test('an image tab whose copy is missing, or whose item went to the trash, shows that notice with the picture’s sidebar line', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [GIF]);
    const assets = path.join(lib, 'assets');
    for (const d of fs.readdirSync(assets)) fs.rmSync(path.join(assets, d), { recursive: true, force: true });
    await openItem(page, 'two-frames');
    await expect(page.getByTestId('missing-notice')).toContainText('라이브러리 안의 사본을 찾을 수 없습니다');
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    await closeReaderTab(page);

    const [photo] = await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page, photo!.id);
    await trashItems(page, [photo!.id]);
    await expect(page.getByTestId('reader-trashed')).toContainText('이 자료는 휴지통에 있습니다');
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(false);
  } finally {
    await app.close();
  }
});

test('a JPEG with EXIF orientation 6 is drawn upright: 40 × 60', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [ORIENT6]);
    await openItem(page, 'orient6');
    const s = await drawn(page);
    expect(s.natural).toEqual({ width: 40, height: 60 });
    const b = await stageBox(page);
    expect(b.height / b.width).toBeCloseTo(1.5, 1);
  } finally {
    await app.close();
  }
});

test('the keyboard: an image opened from the table has its stage focused; F6 goes round to the zoom field; ⇧⇥ reaches the tab strip', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const inPane = () => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
  try {
    const [photo] = await importPaths(page, [PHOTO]);
    await rowByTitle(page, 'photo-4032').click();
    await page.keyboard.press('Enter');
    await drawn(page, photo!.id);
    await expect(stage(page)).toBeFocused();
    await expectNoSeriousA11y(page, 'image reader, stage focused');
    await page.keyboard.press('F6');
    await expect.poll(inPane).toBe('sidebar');
    await page.keyboard.press('F6');
    await expect(zoomField(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(zoomMenu(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(viewMenu(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stage(page)).toBeFocused();
    for (const back of [viewMenu, zoomMenu, zoomField]) {
      await page.keyboard.press('Shift+Tab');
      await expect(back(page)).toBeFocused();
    }
    for (let i = 0; i < 6 && !(await readerTab(page, photo!.id).evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Shift+Tab');
    await expect(readerTab(page, photo!.id)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a hidden image tab does not fit to a window that changes size; shown again, it fits once to the stage it has now', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const win = await mainWindow(app);
  const [w, h] = await win.evaluate((x) => x.getContentSize());
  try {
    const second = path.join(testInfo.outputPath('in'), 'photo-b.jpg');
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.copyFileSync(PHOTO, second);
    const [a, b] = await importPaths(page, [PHOTO, second], { allowDuplicate: true });
    await openItem(page, 'photo-4032');
    const fitA = (await drawn(page, a!.id)).scale;
    await libraryTab(page).click();
    await openItem(page, 'photo-b');
    expect((await drawn(page, b!.id)).scale).toBeCloseTo(fitA, 6);
    // The shown tab fits to the smaller window ...
    await win.evaluate((x, [cw, ch]) => x.setContentSize(cw!, ch!), [w! - 60, h! - 120]);
    await expect.poll(() => scaleOf(page)).toBeLessThan(fitA - 0.001);
    const fitSmall = (await scaleOf(page))!;
    await settled(page);
    // ... the hidden one keeps the scale it had.
    expect((await imageState(page, a!.id))?.scale).toBeCloseTo(fitA, 6);
    // Shown, it fits once, to the stage it has now: each change of the shown tab's picture state is one placement (the first is the switch to it).
    await page.evaluate(() => {
      const w = window as unknown as { __scales: number[]; __learnReader: { subscribe(f: () => void): () => void; getState(): { image: { scale: number } | null } } };
      let last = w.__learnReader.getState().image;
      w.__scales = [];
      w.__learnReader.subscribe(() => {
        const image = w.__learnReader.getState().image;
        if (image === last) return;
        last = image;
        if (image) w.__scales.push(image.scale);
      });
    });
    await readerTab(page, a!.id).click();
    await expect.poll(async () => (await imageState(page))?.itemId).toBe(a!.id);
    await expect.poll(() => scaleOf(page)).toBeCloseTo(fitSmall, 6);
    await quiet(page, '[data-testid="tab-panel"][data-active="true"] [data-testid="image-stage"]');
    const scales = await page.evaluate(() => (window as unknown as { __scales: number[] }).__scales);
    expect(scales.map((x) => Number(x.toFixed(6)))).toEqual([Number(fitA.toFixed(6)), Number(fitSmall.toFixed(6))]);
    const box = await stageBox(page);
    expect(Math.min(box.left, box.top)).toBeCloseTo(24, 0);
  } finally {
    await win.evaluate((x, [cw, ch]) => x.setContentSize(cw!, ch!), [w, h]).catch(() => {});
    await app.close();
  }
});

/** The stage's `data-bg` and what it paints, with the colour each token resolves to (read from a probe, so the check holds in either theme). */
async function ground(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="image-stage"]')!;
    const css = getComputedStyle(el);
    const token = (name: string): string => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    };
    return {
      bg: el.dataset['bg'],
      color: css.backgroundColor,
      image: css.backgroundImage,
      attachment: css.backgroundAttachment,
      light: token('--image-bg-light'),
      dark: token('--image-bg-dark'),
      checkerA: token('--image-checker-a'),
      checkerB: token('--image-checker-b'),
      // The picture's own box and the picture: no border, outline or shadow of the app's round it, on any ground.
      box: ['.image-box', '.image-box img'].map((sel) => {
        const c = getComputedStyle(el.querySelector(sel)!);
        return [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth, c.borderLeftWidth, c.outlineStyle, c.boxShadow].join(' ');
      }),
    };
  });
}

test('the image 보기 menu — 배경 as a group (the one in use checked) then the two turns; each background sets data-bg and the ground, and comes back after a relaunch', async ({}, testInfo) => {
  test.setTimeout(90_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    // Nothing chosen: the light theme's ground.
    let g = await ground(page);
    expect(g.bg).toBe('light');
    expect(g.color).toBe(g.light);
    expect(g.image).toBe('none');
    expect(g.box, 'light: no border, outline or shadow on the picture').toEqual(Array(2).fill('0px 0px 0px 0px none none'));

    await viewMenu(page).click();
    const menu = page.getByRole('menu', { name: '보기' });
    await expect(menu.locator('.mhead')).toHaveText(['배경']);
    await expect(menu.locator('.mi-label')).toHaveText(['밝게', '어둡게', '체크무늬', '시계 방향으로 회전', '반시계 방향으로 회전']);
    await expect(menu.locator('[aria-checked="true"] .mi-label')).toHaveText(['밝게']);
    await expect(menu.getByRole('menuitem', { name: /^시계 방향으로 회전/ })).toContainText(process.platform === 'darwin' ? '⌘R' : 'Ctrl+R');
    await expectNoSeriousA11y(page, 'image view menu');

    await menu.getByRole('menuitemradio', { name: '체크무늬' }).click();
    await expect(stage(page)).toHaveAttribute('data-bg', 'checker');
    g = await ground(page);
    expect(g.image).toContain('conic-gradient');
    expect(g.image).toContain(g.checkerA);
    expect(g.image).toContain(g.checkerB);
    expect(g.attachment).toBe('local');
    expect(g.box, 'checker: no border, outline or shadow on the picture').toEqual(Array(2).fill('0px 0px 0px 0px none none'));
    await viewMenu(page).click();
    await expect(menu.locator('[aria-checked="true"] .mi-label')).toHaveText(['체크무늬']);
    await menu.getByRole('menuitemradio', { name: '어둡게' }).click();
    await expect(stage(page)).toHaveAttribute('data-bg', 'dark');
    g = await ground(page);
    expect(g.color).toBe(g.dark);
    expect(g.image).toBe('none');
    expect(g.box, 'dark: no border, outline or shadow on the picture').toEqual(Array(2).fill('0px 0px 0px 0px none none'));
    // A turn from the same menu.
    await viewMenu(page).click();
    await menu.getByRole('menuitem', { name: /^시계 방향으로 회전/ }).click();
    await expect.poll(async () => (await imageState(page))?.rotation).toBe(90);

    await app.close();
    ({ app, page } = await launch(lib, ud));
    await drawn(page);
    await expect(stage(page)).toHaveAttribute('data-bg', 'dark');
    // The menu bar's 배경 ▸ row is the same command (the native menu shows no mark).
    await runMenuCommand(app, 'reader.imageBackgroundLight');
    await expect(stage(page)).toHaveAttribute('data-bg', 'light');
    await runMenuCommand(app, 'reader.imageBackgroundDark');
    await expect(stage(page)).toHaveAttribute('data-bg', 'dark');
    await viewMenu(page).click();
    // A new window after the relaunch: the locator is made again.
    await expect(page.getByRole('menu', { name: '보기' }).locator('[aria-checked="true"] .mi-label')).toHaveText(['어둡게']);
  } finally {
    await app.close().catch(() => {});
  }
});

for (const [scheme, expected] of [['light', 'light'], ['dark', 'dark']] as const) {
  test(`with no background chosen the ground follows the ${scheme} theme (data-bg ${expected}), and a choice wins over it`, async ({}, testInfo) => {
    const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: scheme });
    try {
      await importPaths(page, [PHOTO]);
      await openItem(page, 'photo-4032');
      await drawn(page);
      await expect(stage(page)).toHaveAttribute('data-bg', expected);
      await viewMenu(page).click();
      await expect(page.getByRole('menu', { name: '보기' }).locator('[aria-checked="true"] .mi-label')).toHaveText([expected === 'dark' ? '어둡게' : '밝게']);
      await page.keyboard.press('Escape');
      const other = expected === 'dark' ? 'light' : 'dark';
      await runMenuCommand(app, expected === 'dark' ? 'reader.imageBackgroundLight' : 'reader.imageBackgroundDark');
      await expect(stage(page)).toHaveAttribute('data-bg', other);
      const g = await ground(page);
      expect(g.color).toBe(other === 'dark' ? g.dark : g.light); // the same ground in either theme
    } finally {
      await app.close();
    }
  });
}

test('the background commands run on a picture only: a PDF has none in its menu bar', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-view-menu')).toBeVisible();
    await expect.poll(() => menuItemEnabled(app, 'reader.pageColorSepia')).toBe(true); // the PDF's own group is on: the check can see an enabled item
    for (const id of ['reader.imageBackgroundLight', 'reader.imageBackgroundDark', 'reader.imageBackgroundChecker'] as const) {
      expect(await menuItemEnabled(app, id), id).toBe(false);
    }
  } finally {
    await app.close();
  }
});

/** The colour of the stage's focus ring (the frame's ::after) and the colour each ring token resolves to, read from a probe. */
async function ring(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-testid="image-stage"]')!.parentElement!;
    const shadow = getComputedStyle(frame, '::after').boxShadow;
    const token = (name: string): string => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = `var(${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    };
    return { shadow, light: token('--image-focus-light'), dark: token('--image-focus-dark'), checker: token('--image-focus-checker') };
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the stage's focus ring is drawn in the colour its background asks for, whatever the ${scheme} app theme (3:1 on every ground)`, async ({}, testInfo) => {
    const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: scheme });
    try {
      const [photo] = await importPaths(page, [PHOTO]);
      await rowByTitle(page, 'photo-4032').click();
      await page.keyboard.press('Enter');
      await drawn(page, photo!.id);
      await expect(stage(page)).toBeFocused(); // by the keyboard, so :focus-visible
      const expected = { light: 'light', dark: 'dark', checker: 'checker' } as const;
      let drawnRings = 0;
      for (const [id, bg] of [['reader.imageBackgroundLight', 'light'], ['reader.imageBackgroundDark', 'dark'], ['reader.imageBackgroundChecker', 'checker']] as const) {
        await runMenuCommand(app, id);
        await expect(stage(page)).toHaveAttribute('data-bg', bg);
        await stage(page).focus();
        await expect.poll(async () => (await ring(page)).shadow, { message: `${bg}: a ring is drawn` }).not.toBe('none');
        const r = await ring(page);
        expect(r.shadow, `${bg} in the ${scheme} theme`).toContain(r[expected[bg]]);
        drawnRings += 1;
      }
      expect(drawnRings).toBe(3);
      const r = await ring(page);
      expect(new Set([r.light, r.dark, r.checker]).size, 'three different rings').toBe(3);
    } finally {
      await app.close();
    }
  });
}

test('a live theme change while a picture is shown: an unset background follows it, a chosen one does not', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  const setTheme = (theme: 'light' | 'dark') => page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  const dark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  try {
    await importPaths(page, [PHOTO]);
    await openItem(page, 'photo-4032');
    await drawn(page);
    expect(await setTheme('light')).toMatchObject({ ok: true });
    await expect.poll(dark).toBe(false);
    await expect(stage(page)).toHaveAttribute('data-bg', 'light'); // nothing stored: the theme's
    expect(await setTheme('dark')).toMatchObject({ ok: true });
    await expect.poll(dark).toBe(true);
    await expect(stage(page)).toHaveAttribute('data-bg', 'dark');
    expect(await setTheme('light')).toMatchObject({ ok: true });
    await expect(stage(page)).toHaveAttribute('data-bg', 'light');
    // A choice is the reader's, not the theme's.
    await runMenuCommand(app, 'reader.imageBackgroundChecker');
    await expect(stage(page)).toHaveAttribute('data-bg', 'checker');
    expect(await setTheme('dark')).toMatchObject({ ok: true });
    await expect.poll(dark).toBe(true);
    await expect(stage(page)).toHaveAttribute('data-bg', 'checker');
    expect(await setTheme('light')).toMatchObject({ ok: true });
    await expect.poll(dark).toBe(false);
    await expect(stage(page)).toHaveAttribute('data-bg', 'checker');
  } finally {
    await app.close();
  }
});

// ---- M7c library: images where an item is listed, and the item panel's preview (spec 3.5, 4.6) --------------------------

/** A PNG of one grey (a few KB whatever its size), for a picture of known proportions. */
function greyPng(dir: string, name: string, width: number, height: number): string {
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits, grey
  const rows = Buffer.alloc((width + 1) * height, 0x70);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter 0
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows, { level: 1 })), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

/** A PNG header that claims `width × height` and stops there: the size is readable, the picture is not (and need not be). */
function headOnlyPng(dir: string, name: string, width: number, height: number): string {
  const full = fs.readFileSync(greyPng(dir, 'head-source.png', 8, 8));
  const ihdr = Buffer.from(full.subarray(8, 33)); // length, type, 13 data bytes, crc
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr.writeUInt32BE(zlib.crc32(ihdr.subarray(4, 21)), 21);
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.concat([full.subarray(0, 8), ihdr]));
  return file;
}

/** The item panel on show: a 1024 window folds it, and it is shown on demand (the menu command, as a person does). */
async function showPanel(app: ElectronApplication, page: Page): Promise<void> {
  if ((await page.getByTestId('shell').getAttribute('data-inspector')) !== 'shown') await runMenuCommand(app, 'view.toggleInspector');
  await expect(page.getByTestId('shell')).toHaveAttribute('data-inspector', 'shown');
}

const preview = (page: Page) => page.getByTestId('image-preview');
const kindLine = (page: Page) => page.getByTestId('inspector-kind');

test('images dropped on the window come in with their icon, the kind 이미지, and the panel’s picture, size line and reading line', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const src = testInfo.outputPath('src');
    fs.mkdirSync(src, { recursive: true });
    // A PNG named .jpg: the bytes decide. A trailing byte makes it a file of its own (a PNG reader stops at IEND).
    const wrong = path.join(src, 'wrong-ext.jpg');
    fs.writeFileSync(wrong, Buffer.concat([fs.readFileSync(path.join(FIXTURES, 'transparent.png')), Buffer.from([0])]));
    const names = ['transparent.png', 'orient6.jpg', 'alpha.webp', 'two-frames.gif', 'still.avif'].map((n) => path.join(FIXTURES, n));
    await dropSource(page, [...names, wrong]);
    for (const type of ['dragenter', 'dragover', 'drop'] as const) await drag(page, type, 'source');
    await expect(page.getByTestId('import-done').filter({ hasText: '자료 6개를 가져왔습니다' })).toBeVisible();
    for (const title of ['transparent', 'orient6', 'alpha', 'two-frames', 'still', 'wrong-ext']) {
      const row = rowByTitle(page, title);
      await expect(row.locator('[data-col="type"]')).toHaveText('이미지');
      await expect(row.locator('[data-col="title"] svg.lucide-image')).toBeVisible();
    }

    // One image selected: its picture leads the head. A 64 × 48 picture in a 286-wide panel is 160 high.
    await rowByTitle(page, 'transparent').click();
    await showPanel(app, page);
    await expect(kindLine(page)).toHaveText('이미지 · 64 × 48');
    await expect(preview(page)).toHaveAttribute('data-state', 'picture');
    const img = preview(page).locator('img');
    await expect(img).toHaveAttribute('alt', 'transparent');
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect(img).toHaveAttribute('decoding', 'async');
    await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const box = (await preview(page).boundingBox())!;
    const head = (await page.getByTestId('inspector-head').boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(160);
    expect(box.height).toBeGreaterThan(150);
    // The panel's content width: the head's padding on both sides.
    expect(Math.abs(box.width - (head.width - 32))).toBeLessThanOrEqual(1);
    expect(await preview(page).evaluate((e) => getComputedStyle(e).backgroundImage)).toBe('none'); // no checkerboard

    // Several selected: no preview (a positive check on the single selection above, the same panel).
    await selectRows(page, ['transparent', 'alpha']);
    await expect(page.getByText('자료 2개 선택')).toBeVisible();
    await expect(preview(page)).toHaveCount(0);

    // Never opened: no reading section. Opened and drawn: ✓ 완료 and the day it was viewed.
    await rowByTitle(page, 'still').click();
    await expect(kindLine(page)).toHaveText('이미지 · 40 × 30');
    // The section is cached as "never opened" before the open: the info section (rendered with the same detail) is there first.
    await expect(page.getByTestId('info-section')).toBeVisible();
    await expect(page.getByTestId('reading-section')).toHaveCount(0);
    await openItem(page, 'still');
    await drawn(page);
    await expect.poll(async () => (await stored(page, (await imageState(page))!.itemId))?.progress).toBe(1);
    await backFromReader(page);
    await rowByTitle(page, 'still').click();
    await expect(page.getByTestId('reading-done')).toHaveText('완료');
    await expect(page.getByTestId('reading-line')).toHaveText(/^열어\u00a0봄\u00a0· 오늘\u00a0/);
    await expect(page.getByTestId('reading-bar')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the panel’s preview keeps the picture’s proportions up to 160 high; no size, past fifty megapixels and a picture that cannot load show the icon box', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const src = testInfo.outputPath('src');
    fs.mkdirSync(src, { recursive: true });
    const wide = greyPng(src, 'wide.png', 4000, 1000);
    const huge = headOnlyPng(src, 'huge.png', 8000, 7000); // 56 MP: over the limit, so the file is never loaded
    const edge = headOnlyPng(src, 'edge.png', 10000, 5000); // exactly 50 MP: drawn (and fails here: there is no picture behind the header)
    // The head of an AVIF and no size box in it: the file is an image, its size is not known.
    const nosize = path.join(src, 'no-size.avif');
    fs.writeFileSync(nosize, fs.readFileSync(path.join(FIXTURES, 'still.avif')).subarray(0, 32));
    const items = await importPaths(page, [wide, huge, edge, nosize, BROKEN]);
    expect(items.map((i) => i.imageSize ?? null)).toEqual([{ width: 4000, height: 1000 }, { width: 8000, height: 7000 }, { width: 10000, height: 5000 }, null, expect.anything()]);

    await rowByTitle(page, 'wide').click();
    await showPanel(app, page);
    await expect(kindLine(page)).toHaveText('이미지 · 4000 × 1000');
    await expect(preview(page)).toHaveAttribute('data-state', 'picture');
    await expect.poll(() => preview(page).locator('img').evaluate((e) => (e as HTMLImageElement).naturalWidth)).toBe(4000);
    const box = (await preview(page).boundingBox())!;
    expect(Math.abs(box.height - box.width / 4)).toBeLessThanOrEqual(1); // 286 → 72: no 160-high box around a strip

    await rowByTitle(page, 'huge').click();
    await expect(kindLine(page)).toHaveText('이미지 · 8000 × 7000');
    await expect(preview(page)).toHaveAttribute('data-state', 'icon');
    await expect(preview(page).locator('svg.lucide-image')).toBeVisible();
    await expect(preview(page).locator('img')).toHaveCount(0);
    expect((await preview(page).boundingBox())!.height).toBe(160);

    await rowByTitle(page, 'no-size').click();
    await expect(kindLine(page)).toHaveText('이미지');
    await expect(preview(page)).toHaveAttribute('data-state', 'icon');
    await expect(preview(page).locator('img')).toHaveCount(0);

    // At the limit the picture is tried; one that fails to load gives the broken-picture icon, still 160 high.
    await rowByTitle(page, 'edge').click();
    await expect(preview(page)).toHaveAttribute('data-state', 'broken');
    await expect(preview(page).locator('svg.lucide-image-off')).toBeVisible();
    expect((await preview(page).boundingBox())!.height).toBe(160);
    await rowByTitle(page, 'broken').click();
    await expect(preview(page)).toHaveAttribute('data-state', 'broken');
  } finally {
    await app.close();
  }
});

test('the preview shows the whole picture — a 4:3 photo, a portrait and a strip — inside its box, in its own proportions, and the picture is not draggable', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const src = testInfo.outputPath('src');
    fs.mkdirSync(src, { recursive: true });
    await importPaths(page, [PHOTO, ORIENT6, greyPng(src, 'wide.png', 4000, 1000)]);
    for (const title of ['photo-4032', 'orient6', 'wide']) {
      await rowByTitle(page, title).click();
      await showPanel(app, page);
      await expect(preview(page)).toHaveAttribute('data-state', 'picture');
      const img = preview(page).locator('img');
      await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth), { message: `${title} loaded` }).toBeGreaterThan(0);
      const m = await preview(page).evaluate((box) => {
        const el = box.querySelector('img')!;
        const b = box.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return { box: { l: b.left, t: b.top, r: b.right, b: b.bottom }, img: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }, nw: el.naturalWidth, nh: el.naturalHeight, draggable: el.draggable };
      });
      expect(m.img.h, `${title}: at most 160 high`).toBeLessThanOrEqual(160.5);
      // The whole picture: its own proportions (a crop or a stretch changes them), and inside the box.
      expect(Math.abs(m.img.w - (m.img.h * m.nw) / m.nh), `${title}: proportions`).toBeLessThanOrEqual(1);
      expect(m.img.l, title).toBeGreaterThanOrEqual(m.box.l - 0.5);
      expect(m.img.r, title).toBeLessThanOrEqual(m.box.r + 0.5);
      expect(m.img.t, title).toBeGreaterThanOrEqual(m.box.t - 0.5);
      expect(m.img.b, title).toBeLessThanOrEqual(m.box.b + 0.5);
      expect(m.draggable, `${title}: not draggable`).toBe(false);
    }
  } finally {
    await app.close();
  }
});

test('no preview in the trash view or in the reader; a missing original shows the icon box', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const [photo, gif, still] = await importPaths(page, [PHOTO, GIF, path.join(FIXTURES, 'still.avif')]);
    // Positive: the panel shows the photo's preview.
    await rowByTitle(page, 'photo-4032').click();
    await showPanel(app, page);
    await expect(preview(page)).toHaveAttribute('data-state', 'picture');

    // The reader has no item panel: the picture is drawn there, and no preview box exists.
    await openItem(page, 'photo-4032');
    await drawn(page, photo!.id);
    await expect(preview(page)).toHaveCount(0);
    await backFromReader(page);

    // The trash view: the item's panel is up (its 복원 button), and has no preview.
    await trashItems(page, [still!.id]);
    await specialRow(page, 'trash').click();
    await rowByTitle(page, 'still').click();
    await expect(page.getByTestId('inspector-kind')).toHaveText('이미지 · 40 × 30');
    await expect(preview(page)).toHaveCount(0);
    await specialRow(page, 'all').click();

    // A missing original: the icon box, not a picture that cannot load.
    const assets = path.join(lib, 'assets');
    for (const d of fs.readdirSync(assets)) fs.rmSync(path.join(assets, d), { recursive: true, force: true });
    await page.evaluate((id) => window.learn.library.get({ itemId: id }), gif!.id);
    await expect(rowByTitle(page, 'two-frames').getByTestId('missing-flag')).toBeVisible();
    await rowByTitle(page, 'two-frames').click();
    await expect(page.getByTestId('inspector-kind')).toHaveText('이미지 · 24 × 16');
    await expect(preview(page)).toHaveAttribute('data-state', 'icon');
    await expect(preview(page).locator('img')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
