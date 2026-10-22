// The demo overlay (LEARN_DEMO_OVERLAY=1, unpackaged builds; the packaged build ignores it, main/demo.test.ts): a
// pointer ring and shortcut pills for screen recordings. It must never be part of the window — no pane, no focus
// target, no pointer target, no axe finding — so F6, the fold rescue and the keymap behave exactly as without it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { closeSheet, drag, expectWindow, launch, mainWindow, runMenuCommand, stubOpenDialog } from './helpers';

const IS_MAC = process.platform === 'darwin';
const DEMO = { env: { LEARN_DEMO_OVERLAY: '1' } };

/**
 * The overlay of `page` is inert: aria-hidden, no pointer events, nothing focusable or with a tooltip, no data-pane, not
 * inside a pane; the drawn cursor takes no hit and uses none of the app's focus colour (T13-M4).
 */
async function expectInert(page: Page, at: { x: number; y: number }): Promise<void> {
  const overlay = page.getByTestId('demo-overlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  expect(await overlay.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await overlay.evaluate((el) => el.querySelectorAll('a, button, input, select, textarea, [tabindex], [data-pane], [title], [role="tooltip"]').length)).toBe(0);
  expect(await overlay.evaluate((el) => el.closest('[data-pane]'))).toBeNull();
  await page.mouse.move(at.x, at.y);
  const cursor = page.locator('.demo-pointer');
  await expect(cursor).toBeVisible();
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="demo-overlay"]') ?? null, at)).toBeNull();
  const colours = await cursor.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus)';
    document.body.append(probe);
    const focus = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { focus, used: [cs.borderTopColor, cs.backgroundColor, cs.boxShadow, cs.outlineColor].join(' | ') };
  });
  expect(colours.used).not.toContain(colours.focus);
}

/** Where the focus is: its data-pane and the test id of it (or of its nearest ancestor with one). */
const focus = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return `${el?.closest('[data-pane]')?.getAttribute('data-pane') ?? '-'}/${el?.closest('[data-testid]')?.getAttribute('data-testid') ?? '-'}`;
  });

/**
 * One keyboard journey, recorded stop by stop: F6 / ⇧F6 through sidebar → content → toasts (an error toast stays up),
 * then ⌃⌘S folding the sidebar under a keyboard focus (the rescue hands it to the toolbar toggle) and back.
 */
async function journey(app: ElectronApplication, page: Page, dir: string): Promise<string[]> {
  const notes = path.join(dir, 'notes.txt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(notes, 'plain text');
  await stubOpenDialog(app, [notes]);
  await runMenuCommand(app, 'file.importManaged');
  await expect(page.getByTestId('import-failures')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: string[] = [];
  for (const key of ['F6', 'F6', 'F6', 'F6', 'Shift+F6', 'Shift+F6', 'Shift+F6']) {
    await page.keyboard.press(key);
    stops.push(`${key} → ${await focus(page)}`);
  }
  await runMenuCommand(app, 'view.toggleSidebar');
  await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  stops.push(`fold → ${await focus(page)}`);
  await page.keyboard.press('F6');
  stops.push(`F6 → ${await focus(page)}`);
  await runMenuCommand(app, 'view.toggleSidebar');
  await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
  await page.keyboard.press('Shift+F6');
  stops.push(`Shift+F6 → ${await focus(page)}`);
  return stops;
}

test('without LEARN_DEMO_OVERLAY there is no overlay and no demo flag on the URL', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect(page.url()).not.toContain('demo=1');
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('demo-overlay')).toHaveCount(0);
    await page.keyboard.press('Escape');
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    expect(settings.url()).not.toContain('demo=1');
    await expect(settings.getByTestId('demo-overlay')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('with LEARN_DEMO_OVERLAY=1 the overlay is inert in the main and settings windows, and shows pills and captions', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), DEMO);
  try {
    expect(page.url()).toContain('demo=1');
    await expectInert(page, { x: 400, y: 300 });
    // A move the platform makes up when a window over this one moves (another place, no movement) leaves the cursor
    // where the pointer is; a real move carries its movement.
    const cursorAt = () => page.locator('.demo-pointer').evaluate((el) => [(el as HTMLElement).style.left, (el as HTMLElement).style.top]);
    await page.evaluate(() => dispatchEvent(new PointerEvent('pointermove', { clientX: 720, clientY: 450 })));
    expect(await cursorAt()).toEqual(['400px', '300px']);
    await page.mouse.move(420, 310);
    expect(await cursorAt()).toEqual(['420px', '310px']);

    // A menu command shows a pill: its keys in this platform's glyphs and its menu label.
    await runMenuCommand(app, 'app.palette');
    const pill = page.getByTestId('demo-pill');
    await expect(pill).toContainText('명령 팔레트…');
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['⌘', 'K'] : ['Ctrl', 'K']);
    // The palette's input keeps the focus the command gave it; the pill takes none and has nothing that could.
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await expectNoSeriousA11y(page, 'demo overlay with a pill, palette open');
    // Window keys are named by what they do there (the palette footer's words).
    await page.keyboard.press('ArrowDown');
    await expect(pill).toContainText('이동');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['esc'] : ['Esc']);
    await expect(pill).toContainText('닫기');
    // It fades out by itself (1.9 s, then the exit).
    await expect(pill).toHaveCount(0, { timeout: 4000 });

    // ⌃⌘S names what it did: the state it found.
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(pill).toContainText('사이드바 가리기');
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(pill).toContainText('사이드바 보기');

    // A held ⌥ / Alt while files are dragged over the window: shown until released, naming the link.
    await drag(page, 'dragenter', [['a.pdf', 'application/pdf']]);
    await page.keyboard.down('Alt');
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['⌥'] : ['Alt']);
    await expect(pill).toContainText('외부 파일로 연결');
    await page.waitForTimeout(2500); // past a pill's own 1.9 s
    await expect(pill).toContainText('외부 파일로 연결');
    await page.keyboard.up('Alt');
    await expect(pill).toHaveCount(0, { timeout: 2000 });
    await drag(page, 'dragleave', [['a.pdf', 'application/pdf']]);

    // A chapter caption, sent by the demo script: shown, then gone after its 3.5 s.
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: '설정은 따로 뜨는 창입니다.' })));
    const caption = page.getByTestId('demo-caption');
    await expect(caption).toHaveText('설정은 따로 뜨는 창입니다.');
    expect(await page.getByTestId('demo-overlay').evaluate((el) => el.querySelectorAll('[tabindex], button, [title]').length)).toBe(0);
    await expect(caption).toHaveCount(0, { timeout: 6000 });
    // The script may name the duration (a long caption stays longer, T13R2-m3).
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: { text: '짧게', ms: 600 } })));
    await expect(caption).toHaveText('짧게');
    await expect(caption).toHaveCount(0, { timeout: 1500 });
    // Or at the top, where the bottom holds the page's own text (the settings window, mac1 m3).
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: { text: '위에', ms: 600, place: 'top' } })));
    await expect(caption).toHaveAttribute('data-place', 'top');
    expect((await caption.boundingBox())!.y).toBeLessThan(40); // 12 from the top (8 more while it rises in)
    await expect(caption).toHaveCount(0, { timeout: 1500 });
    // Further down (under a settings window's theme tiles), or narrower (beside a settings window): as the script says.
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: { text: '타일 아래에', ms: 900, place: 'top', top: 300 } })));
    await expect.poll(async () => (await caption.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(300);
    await expect(caption).toHaveCount(0, { timeout: 2000 });
    const long = '설정 창 옆에서는 캡션이 더 좁게, 여러 줄로 나옵니다. 설정 창을 가리지 않습니다.';
    await page.evaluate((text) => dispatchEvent(new CustomEvent('learn:demo-caption', { detail: { text, ms: 900, maxWidth: 300 } })), long);
    expect((await caption.boundingBox())!.width).toBeLessThanOrEqual(300);
    await expect(caption).toHaveCount(0, { timeout: 2000 });
    // A lasting tag while a scripted gesture is on screen, until it is cleared.
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-tag', { detail: '스크립트로 재현' })));
    const tag = page.getByTestId('demo-tag');
    await expect(tag).toHaveText('스크립트로 재현');
    await page.waitForTimeout(2500);
    await expect(tag).toBeVisible();
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-tag', { detail: null })));
    await expect(tag).toHaveCount(0);

    // ⌘/ opens a sheet over the window's middle: its pill starts bottom-left, where the sheet leaves room, and stays
    // there while the sheet comes (T13R2-m6; round 3 m1: a pill on screen never moves).
    await expect(pill).toHaveCount(0, { timeout: 4000 });
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    await expect(pill).toContainText('단축키 도움말');
    await expect(pill).toHaveAttribute('data-aside', '');
    const asideAt = (await pill.boundingBox())!;
    expect(asideAt.x).toBeLessThan(40);
    await page.waitForTimeout(400);
    expect((await pill.boundingBox())!.x).toBe(asideAt.x);
    await closeSheet(sheet, 'Escape');
    // Another command's pill is centred again.
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(pill).toContainText('사이드바 가리기');
    await expect(pill).not.toHaveAttribute('data-aside', '');
    const centred = (await pill.boundingBox())!;
    expect(Math.abs(centred.x + centred.width / 2 - (await page.evaluate(() => innerWidth)) / 2)).toBeLessThan(2);
    await runMenuCommand(app, 'view.toggleSidebar');

    // 설정… is run by main itself (no menuCommand): main tells the overlay. The settings window has its own, as inert.
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect(pill).toContainText('설정…');
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['⌘', ','] : ['Ctrl', ',']);
    expect(settings.url()).toContain('demo=1');
    await expectInert(settings, { x: 300, y: 120 });
    await expectNoSeriousA11y(settings, 'settings window with the demo overlay');
    // Its height is its content's: the fixed overlay is outside the measured root.
    const fits = async () =>
      (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('window=settings'))!.getContentSize()[1])) ===
      (await settings.locator('[data-settings-root]').evaluate((el) => Math.ceil(el.getBoundingClientRect().height)));
    await expect.poll(fits).toBe(true);
    await settings.close();
  } finally {
    await app.close();
  }
});

// Critique mac1 M1: with the system's own arrow on screen (macOS), a disc following it was a second pointer. There the
// overlay draws only a click ring while a button is down; with synthetic input (no cursor on screen) a disc follows.
// Either way nothing is drawn once the pointer has left the window or another window has the focus, until it moves in.
test('the drawn pointer: a disc that follows, or only a click ring; gone when the pointer leaves', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), DEMO);
  try {
    const overlay = page.getByTestId('demo-overlay');
    const pointer = page.getByTestId('demo-pointer');
    const at = () => pointer.evaluate((el) => [(el as HTMLElement).style.left, (el as HTMLElement).style.top]);
    const h = await page.evaluate(() => innerHeight);
    // Follow (the default): the disc is where the pointer is …
    await expect(overlay).toHaveAttribute('data-pointer-mode', 'follow');
    await page.mouse.move(120, h - 72);
    await expect(pointer).toBeVisible();
    // … until the pointer leaves the window or the window loses the focus; the next real move brings it back.
    await page.evaluate(() => document.documentElement.dispatchEvent(new PointerEvent('pointerleave')));
    await expect(pointer).toHaveCount(0);
    await page.mouse.move(130, h - 72);
    await expect(pointer).toBeVisible();
    await page.evaluate(() => dispatchEvent(new FocusEvent('blur')));
    await expect(pointer).toHaveCount(0);
    await page.mouse.move(135, h - 72);
    await expect(pointer).toBeVisible();
    // Another window taking the focus (main's windowState push: the page's own blur is emulated away here) hides it too.
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect(pointer).toHaveCount(0);
    await settings.close();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await (await mainWindow(app)).evaluate((w) => w.focus());
    // A made-up move (no movement, elsewhere) does not bring it back.
    await page.evaluate(() => dispatchEvent(new PointerEvent('pointermove', { clientX: 720, clientY: 450 })));
    await expect(pointer).toHaveCount(0);
    await page.mouse.move(140, h - 72);
    expect(await at()).toEqual(['140px', `${h - 72}px`]);

    // Clicks: nothing while the pointer only moves (the system's arrow is the pointer) …
    await page.evaluate(() => dispatchEvent(new CustomEvent('learn:demo-pointer', { detail: { mode: 'clicks' } })));
    await expect(overlay).toHaveAttribute('data-pointer-mode', 'clicks');
    await expect(pointer).toHaveCount(0);
    await page.mouse.move(120, h - 72);
    await page.mouse.move(130, h - 80);
    await expect(pointer).toHaveCount(0);
    // … a ring at it while the button is down, following a drag, …
    await page.mouse.down();
    await expect(pointer).toBeVisible();
    await expect(pointer).toHaveAttribute('data-down', '');
    expect(await at()).toEqual(['130px', `${h - 80}px`]);
    await page.mouse.move(150, h - 90);
    expect(await at()).toEqual(['150px', `${h - 90}px`]);
    // … fading once it is up (250 ms, then the exit).
    await page.mouse.up();
    await expect(pointer).not.toHaveAttribute('data-down', '');
    await expect(pointer).toHaveCount(0, { timeout: 1500 });
    await page.mouse.move(160, h - 90);
    await page.waitForTimeout(300);
    await expect(pointer).toHaveCount(0);
  } finally {
    await app.close();
  }
});

// Task 13 ruling (Since Task 12): F6 cycles through the same panes with the overlay on as without it, and the fold
// rescue lands where it does without it.
test('F6 / ⇧F6 and the fold rescue visit the same stops with the demo overlay on as without it', async ({}, testInfo) => {
  const plain = await launch(testInfo.outputPath('plain', 'library'), testInfo.outputPath('plain', 'userdata'));
  let without: string[];
  try {
    without = await journey(plain.app, plain.page, testInfo.outputPath('plain', 'src'));
  } finally {
    await plain.app.close();
  }
  const demo = await launch(testInfo.outputPath('demo', 'library'), testInfo.outputPath('demo', 'userdata'), DEMO);
  try {
    await expect(demo.page.getByTestId('demo-overlay')).toBeAttached();
    const withOverlay = await journey(demo.app, demo.page, testInfo.outputPath('demo', 'src'));
    expect(withOverlay).toEqual(without);
    // The journey really went through every pane and the rescue (not a vacuous equality).
    expect(without).toEqual(expect.arrayContaining([expect.stringMatching(/^F6 → sidebar\//), expect.stringMatching(/^F6 → content\//), expect.stringMatching(/^F6 → toasts\//)]));
    expect(without.find((s) => s.startsWith('fold'))).toBe('fold → -/toolbar-sidebar-toggle');
    // F6 showed its pill meanwhile.
    await demo.page.keyboard.press('Shift+F6');
    await expect(demo.page.getByTestId('demo-pill').locator('.kbd')).toHaveText(IS_MAC ? ['⇧', 'F6'] : ['Shift', 'F6']);
    expect(await (await mainWindow(demo.app)).evaluate((w) => w.webContents.getURL().includes('demo=1'))).toBe(true);
  } finally {
    await demo.app.close();
  }
});
