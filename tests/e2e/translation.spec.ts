// The reader's translation (M7a spec 6): the selection pop-up and the panel's 번역 section, consent first, on the fake engine
// (main/translation/fake.ts) — nothing here reaches the real service.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, expectWindow, importPaths, launch, mainWindow, openItem, readClipboard, runMenuCommand, runPalette, selectInPage, translationCalls, translationFake } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const KOREAN = path.join(FIXTURES, 'korean.pdf');
const S1 = 'Attention is all you need.';
const S3 = 'We propose a new simple network architecture.';
const S4 = 'It is based solely on attention mechanisms.';
const K1 = '주의가 필요한 전부입니다.';
const K3 = '우리는 새롭고 간단한 네트워크 아키텍처를 제안합니다.';
const K4 = '이는 주의 메커니즘에만 기반을 두고 있습니다.';

test.beforeAll(() => {
  for (const f of [PAPER, KOREAN]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const popup = (page: Page) => page.getByTestId('selection-popup');
const section = (page: Page) => page.getByTestId('translation-section');
const viewer = (page: Page) => page.getByTestId('pdf-viewer');

async function openReader(page: Page, file: string, title: string) {
  await importPaths(page, [file]);
  await openItem(page, title);
  await expect(viewer(page)).toHaveAttribute('data-pages', /^[1-9]/);
  await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
}
/** The choice the settings window makes, set directly for tests that are not about it. */
const setTranslation = (page: Page, translation: { enabled: boolean | null; autoOnSelect?: boolean }) =>
  page.evaluate(async (t) => {
    const r = await window.learn.prefs.get();
    if (!r.ok) throw new Error(r.code);
    const done = await window.learn.prefs.set({ translation: { ...r.data.translation, autoOnSelect: true, ...t } });
    if (!done.ok) throw new Error(done.code);
  }, translation);
const enabledPref = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.learn.prefs.get();
    return r.ok ? r.data.translation.enabled : 'unreadable';
  });
/** A selection the user lets go of: the text goes and the pop-up with it. */
const unselect = async (page: Page) => {
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await expect(popup(page)).toHaveCount(0);
};
const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // pdf.js's own line for a getPage in flight when a document is closed on purpose; nothing else is let through.
    if (m.type() === 'error' && !/^Unable to get page .*Transport destroyed/s.test(m.text())) errors.push(m.text());
  });
  return errors;
};

test('before the consent a selection asks and sends nothing; 사용 안 함 closes the pop-up and no later selection shows one', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    // A drag with the mouse: the pop-up comes right after the pointer is let go.
    const line = page.locator('.page[data-page-number="1"] .textLayer span', { hasText: S1 }).first();
    const box = (await line.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
    await page.mouse.up();
    await expect(popup(page)).toHaveAttribute('data-state', 'consent');
    await expect(popup(page)).toContainText('선택한 글을 번역하려면 Google로 보냅니다.');
    await expect(popup(page).getByTestId('consent-enable')).toHaveText('번역 켜기');
    // It never takes the focus, so the selection stays where it was made.
    expect(await popup(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
    expect(await page.evaluate(() => getSelection()!.toString().trim())).toBe(S1);
    // The panel asks the same, in its own place.
    await expect(section(page).getByTestId('consent-enable')).toBeVisible();
    expect(await translationCalls(app)).toBe(0);
    await popup(page).getByTestId('consent-decline').click();
    await expect(popup(page)).toHaveCount(0);
    await unselect(page);
    await selectInPage(page, S3);
    await page.waitForTimeout(700); // past the 300 ms a keyboard selection waits
    await expect(popup(page)).toHaveCount(0);
    await expect(section(page)).toContainText('번역을 사용하지 않습니다.');
    expect(await translationCalls(app)).toBe(0);
    expect(await enabledPref(page)).toBe(false);
  } finally {
    await app.close();
  }
});

test('turned on in the settings window, a selection is translated in the pop-up and the panel alike; the same sentence again comes from the cache', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await settings.getByTestId('settings-translation-enabled-on').click();
    await expect.poll(() => enabledPref(page)).toBe(true);
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await selectInPage(page, S1);
    await expect(popup(page)).toHaveAttribute('data-state', 'done');
    await expect(popup(page)).toContainText(K1);
    await expect(page.getByTestId('translation-result')).toHaveText(K1);
    await expect(page.getByTestId('translation-source')).toHaveValue(S1);
    expect(await translationCalls(app)).toBe(1);
    await expect(popup(page).getByTestId('selection-popup-copy')).toBeVisible();
    await popup(page).getByTestId('selection-popup-copy').click();
    await expect.poll(() => readClipboard(app)).toBe(K1);
    await unselect(page);
    await selectInPage(page, S1);
    await expect(popup(page)).toContainText(K1);
    expect(await translationCalls(app)).toBe(1);
    // The reader's panel: 번역 first, then the opened item's information.
    const inspector = page.getByTestId('inspector');
    await expect(inspector.getByTestId('translation-section')).toBeVisible();
    await expect(inspector.getByTestId('inspector-item')).toBeVisible();
    expect(await inspector.getByRole('heading', { level: 3 }).first().textContent()).toContain('번역');
  } finally {
    await app.close();
  }
});

test('이어 붙이기 adds the next selection under the original, and the translation holds both sentences', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    await setTranslation(page, { enabled: true });
    await selectInPage(page, S1);
    await expect(page.getByTestId('translation-result')).toHaveText(K1);
    await page.getByTestId('translation-concat').click();
    await expect(page.getByTestId('translation-concat').locator('input')).toBeChecked();
    await unselect(page);
    await selectInPage(page, S3);
    await expect(page.getByTestId('translation-source')).toHaveValue(`${S1}\n${S3}`);
    await expect(page.getByTestId('translation-result')).toContainText(K1);
    await expect(page.getByTestId('translation-result')).toContainText(K3);
    expect(await translationCalls(app)).toBe(2);
    // 복사 ▾: the original, the translation, or both with a blank line between.
    await page.getByTestId('translation-copy').click();
    await page.getByRole('menuitemradio', { name: '원문과 번역 둘 다' }).or(page.getByRole('menuitem', { name: '원문과 번역 둘 다' })).click();
    const both = await readClipboard(app);
    expect(both.startsWith(`${S1}\n${S3}\n\n`)).toBe(true);
    expect(both).toContain(K3);
    // 지우기 empties both boxes.
    await page.getByTestId('translation-clear').click();
    await expect(page.getByTestId('translation-source')).toHaveValue('');
    await expect(page.getByTestId('translation-result')).toHaveText('번역이 여기에 보입니다.');
  } finally {
    await app.close();
  }
});

test('a failure is said with its next step, nothing is sent again by itself, and 다시 번역 asks once more', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    await setTranslation(page, { enabled: true });
    await translationFake(app, 'offline');
    await selectInPage(page, S4);
    await expect(popup(page)).toHaveAttribute('data-state', 'error');
    await expect(popup(page)).toContainText('번역할 수 없음 — 인터넷에 연결되어 있지 않습니다');
    await expect(section(page).getByTestId('translation-result')).toContainText('번역할 수 없음 — 인터넷에 연결되어 있지 않습니다');
    const calls = await translationCalls(app);
    expect(calls).toBe(1);
    await page.waitForTimeout(3000);
    expect(await translationCalls(app)).toBe(calls);
    await translationFake(app, 'ok');
    await popup(page).getByTestId('translation-retry').click();
    await expect(popup(page)).toHaveAttribute('data-state', 'done');
    await expect(popup(page)).toContainText(K4);
    expect(await translationCalls(app)).toBe(calls + 1);
  } finally {
    await app.close();
  }
});

test('a text already in Korean says so and is not sent', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, KOREAN, 'korean');
    await setTranslation(page, { enabled: true });
    await selectInPage(page, '변환기는 순환 없이 문장을 한꺼번에 읽습니다.');
    await expect(popup(page)).toHaveAttribute('data-state', 'done');
    await expect(popup(page)).toContainText('이미 한국어입니다');
    expect(await translationCalls(app)).toBe(0);
  } finally {
    await app.close();
  }
});

test('⌥⌘I folds and shows the reader panel; at 1024 wide it stays, below 1000 it folds and comes back on demand', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    const shell = page.getByTestId('shell');
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, 900));
    await expect(shell).toHaveAttribute('data-inspector', 'shown');
    await runMenuCommand(app, 'view.toggleInspector'); // ⌥⌘I is the menu's accelerator: main takes the key
    await expect(shell).toHaveAttribute('data-inspector', 'hidden');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect(shell).toHaveAttribute('data-inspector', 'shown');
    // The toolbar toggle is at the right end, after 보기 ▾.
    const toggle = page.getByTestId('inspector-toggle');
    const view = page.getByTestId('pdf-view-menu');
    expect((await toggle.boundingBox())!.x).toBeGreaterThan((await view.boundingBox())!.x);
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, 768));
    await expect.poll(() => page.evaluate(() => Math.abs(innerWidth - 1024))).toBeLessThanOrEqual(1); // a 1024 px screen may take a pixel of frame
    await expect(shell).toHaveAttribute('data-inspector', 'shown');
    const stage = (await page.getByTestId('pdf-stage').boundingBox())!;
    expect(stage.width).toBeGreaterThanOrEqual(440);
    expect(stage.width).toBeLessThanOrEqual(464);
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(960, 768));
    await expect.poll(() => page.evaluate(() => Math.abs(innerWidth - 960))).toBeLessThanOrEqual(1);
    await expect(shell).toHaveAttribute('data-inspector', 'hidden');
    await expect(shell).toHaveAttribute('data-sidebar', 'shown');
    await toggle.click();
    await expect(shell).toHaveAttribute('data-inspector', 'shown');
  } finally {
    await app.close();
  }
});

test('esc closes the pop-up first and leaves the find bar its own esc; a click outside closes it too', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    await setTranslation(page, { enabled: true });
    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('pdf-find-field')).toBeVisible();
    await page.getByTestId('pdf-stage').focus();
    await selectInPage(page, S1);
    await expect(popup(page)).toContainText(K1);
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await expect(page.getByTestId('pdf-find-field')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-find-field')).toHaveCount(0);
    // A click outside: on the panel's heading.
    await selectInPage(page, S3);
    await expect(popup(page)).toContainText(K3);
    await page.getByTestId('translation-section').locator('.tr-label').first().click();
    await expect(popup(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('선택한 글 번역 from the palette shows the pop-up again for the selected text', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    await setTranslation(page, { enabled: true });
    await selectInPage(page, S1);
    await expect(popup(page)).toContainText(K1);
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await runPalette(page, app, '번역', 'translation.translateSelection');
    await expect(popup(page)).toContainText(K1);
  } finally {
    await app.close();
  }
});

test('the panel asks for the consent too, and 번역 켜기 there turns it on', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openReader(page, PAPER, 'paper-100');
    await expect(section(page)).toContainText('선택한 글을 번역하려면 Google로 보냅니다.');
    expect(await translationCalls(app)).toBe(0);
    await section(page).getByTestId('consent-enable').click();
    await expect(page.getByTestId('translation-source')).toBeVisible();
    await selectInPage(page, S1);
    await expect(page.getByTestId('translation-result')).toHaveText(K1);
  } finally {
    await app.close();
  }
});

test('a request still on its way when the reader closes is cancelled and leaves no error; the next reader starts empty', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors = errorsOf(page);
  try {
    await openReader(page, PAPER, 'paper-100');
    await setTranslation(page, { enabled: true });
    await translationFake(app, 'slow');
    await selectInPage(page, S1);
    await expect(popup(page)).toHaveAttribute('data-state', 'pending');
    await page.getByTestId('viewer-back').click();
    await expect(viewer(page)).toHaveCount(0);
    await translationFake(app, 'ok');
    await page.waitForTimeout(1800); // past the slow engine's answer
    await openItem(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('translation-source')).toHaveValue('');
    await expect(popup(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
