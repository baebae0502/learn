// The demo overlay (LEARN_DEMO_OVERLAY=1, unpackaged builds; the packaged build ignores it, main/demo.test.ts): a
// pointer ring and shortcut pills for screen recordings. It must never be part of the window — no pane, no focus
// target, no pointer target, no axe finding — so F6, the fold rescue and the keymap behave exactly as without it.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { expectWindow, launch, mainWindow, runMenuCommand, stubOpenDialog } from './helpers';

const IS_MAC = process.platform === 'darwin';
const DEMO = { env: { LEARN_DEMO_OVERLAY: '1' } };

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
  } finally {
    await app.close();
  }
});

test('with LEARN_DEMO_OVERLAY=1 the overlay is inert: aria-hidden, no pointer events, nothing focusable, no pane', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), DEMO);
  try {
    expect(page.url()).toContain('demo=1');
    const overlay = page.getByTestId('demo-overlay');
    await expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(await overlay.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    // The pointer ring follows the pointer and takes no hit: what is under it is the window's own control.
    await page.mouse.move(400, 300);
    await expect(page.locator('.demo-pointer')).toBeVisible();
    expect(await page.evaluate(() => document.elementFromPoint(400, 300)?.closest('[data-testid="demo-overlay"]') ?? null)).toBeNull();

    // A menu command shows a pill: its keys in this platform's glyphs and its menu label.
    await runMenuCommand(app, 'app.palette');
    const pill = page.getByTestId('demo-pill');
    await expect(pill).toContainText('명령 팔레트…');
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['⌘', 'K'] : ['Ctrl', 'K']);
    // The palette's input keeps the focus the command gave it; the pill takes none and has nothing that could.
    await expect(page.getByTestId('palette-input')).toBeFocused();
    expect(await overlay.evaluate((el) => el.querySelectorAll('a, button, input, select, textarea, [tabindex], [data-pane]').length)).toBe(0);
    expect(await overlay.evaluate((el) => el.closest('[data-pane]'))).toBeNull();
    expect(await overlay.evaluate((el) => el.querySelectorAll('[title], [role="tooltip"]').length)).toBe(0);
    await expectNoSeriousA11y(page, 'demo overlay with a pill, palette open');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['esc'] : ['Esc']);

    // ⌃⌘S names what it did: the state it found.
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(pill).toContainText('사이드바 가리기');
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(pill).toContainText('사이드바 보기');

    // 설정… is run by main itself (no menuCommand): main tells the overlay. Only the main window has an overlay.
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect(pill).toContainText('설정…');
    await expect(pill.locator('.kbd')).toHaveText(IS_MAC ? ['⌘', ','] : ['Ctrl', ',']);
    expect(settings.url()).not.toContain('demo=1');
    await expect(settings.getByTestId('demo-overlay')).toHaveCount(0);
    await settings.close();
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
