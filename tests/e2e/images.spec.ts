// M7c images: the five raster formats import by their first bytes (a wrong extension does not matter) and the pixel size
// is stored with the asset; the image reader fits, zooms, moves, turns and remembers the picture (spec 4.1–4.4).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { commandById, commandLabel } from '../../packages/domain/src/commands';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, backFromReader, closeReaderTab, expectDisabledReason, hardKill, imageState, importPaths, launch, libraryTab, mainWindow, menuItemEnabled, openItem, readerTab, rowByTitle, runMenuCommand, settled, trashItems,
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
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveText('이미지에는 쪽이 없습니다');
    expect(await menuItemEnabled(app, 'view.textBigger')).toBe(false);
    await expectNoSeriousA11y(page, 'image reader, opening');
    await page.evaluate(() => (window as unknown as { __releaseDecode: () => void }).__releaseDecode());
    const s = await drawn(page);
    await expect(stage(page).locator('img')).toBeVisible();
    await expect(stage(page)).not.toHaveAttribute('aria-busy', /.*/);
    await expectDisabledReason(zoomMenu(page), null);
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

    // The arrow keys scroll the stage as any scroll area: 40 a press.
    await stage(page).evaluate((el) => {
      el.scrollLeft = 0;
      el.scrollTop = 0;
    });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => stage(page).evaluate((el) => el.scrollTop)).toBe(40);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => stage(page).evaluate((el) => el.scrollLeft)).toBe(40);

    // Fitted, the whole picture is in view: no drag, no hand (after the same stage showed both above).
    await runMenuCommand(app, 'reader.zoomPageFit');
    await expect.poll(async () => (await imageState(page))?.zoom).toBe('fit');
    await expect(stage(page)).not.toHaveAttribute('data-pannable', /.*/);
    await expect(stage(page)).toHaveCSS('cursor', 'default'); // the app's own
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 200, y - 100, { steps: 4 });
    await page.mouse.up();
    await settled(page);
    expect(await stage(page).getAttribute('data-panning')).toBeNull();
    expect((await stageBox(page)).scrollLeft).toBe(0);
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
    expect(await menuItemEnabled(app, 'view.textBigger')).toBe(false);
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
    await expect(stage(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(zoomField(page)).toBeFocused();
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
    // Shown, it fits once, to the stage it has now.
    await readerTab(page, a!.id).click();
    await expect.poll(async () => (await imageState(page))?.itemId).toBe(a!.id);
    await expect.poll(() => scaleOf(page)).toBeCloseTo(fitSmall, 6);
    const box = await stageBox(page);
    expect(Math.min(box.left, box.top)).toBeCloseTo(24, 0);
  } finally {
    await win.evaluate((x, [cw, ch]) => x.setContentSize(cw!, ch!), [w, h]).catch(() => {});
    await app.close();
  }
});
