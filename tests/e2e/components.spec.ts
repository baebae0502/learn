// UI primitives in the real renderer: the interactive fixture of the component board (?window=gallery&part=3).
import { expect, test, type Page } from '@playwright/test';
import { launch, type Session } from './helpers';

const fixture = (platform = 'linux') => `learn://app/index.html?window=gallery&part=3&platform=${platform}&det=1`;
const REASON = '열린 자료가 없습니다.';

let s: Session;
test.beforeEach(async ({}, testInfo) => {
  s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
});
test.afterEach(async () => {
  await s.app.close();
});

async function open(page: Page, platform?: string): Promise<void> {
  await page.goto(fixture(platform));
  await page.getByTestId('gallery').waitFor();
}

/** Keyboard focus the way a user gets there: Tab from the control before it (RAC shows tooltips on focus-visible). */
async function tabTo(page: Page, before: string, target: string): Promise<void> {
  await page.getByTestId(before).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId(target)).toBeFocused();
}

test('a control disabled with a reason stays focusable, explains itself and ignores presses (I1)', async () => {
  const { page } = s;
  await open(page);
  const presses = page.getByTestId('g3-presses');
  // Sanity: the enabled neighbour does count presses.
  await page.getByTestId('g3-before').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('g3-before-presses')).toHaveText('1');

  const cases = [
    { id: 'g3-soft', before: 'g3-before', name: '내보내기' },
    { id: 'g3-soft-icon', before: 'g3-soft', name: '사이드바' },
    { id: 'g3-soft-menu', before: 'g3-soft-icon', name: '정렬' },
  ];
  for (const c of cases) {
    const control = page.getByTestId(c.id);
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(await control.evaluate((b) => (b as HTMLButtonElement).disabled)).toBe(false); // focusable, not native-disabled
    await expect(control).toHaveAccessibleName(c.name); // the reason is never part of the name
    await expect(control).toHaveAccessibleDescription(REASON); // persistent, not only while the tooltip is open
    await tabTo(page, c.before, c.id);
    await expect(page.getByRole('tooltip')).toHaveText(REASON);
    for (const key of ['Enter', 'Space', 'ArrowDown']) await page.keyboard.press(key);
    await control.click({ force: true }); // Playwright treats aria-disabled as disabled; a user can still click
    await expect(presses).toHaveText('0');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expect(page.getByTestId('g3-last')).toHaveText('—');
});

test('MenuButton: Enter and Space open it, Escape returns to the trigger, Enter runs an item (I3)', async () => {
  const { page } = s;
  await open(page);
  const trigger = page.getByTestId('g3-menu');
  const menu = page.getByRole('menu');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Space');
  await expect(menu).toBeVisible();
  // Menu grammar: section header, a checked choice, a disabled item, a separator.
  await expect(menu.getByText('정렬 기준')).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: '추가일' })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemradio', { name: '진행' })).toHaveAttribute('aria-disabled', 'true');
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await expect(menu.getByTestId('g3-mi-descending').locator('.check svg')).toHaveCount(1);
  await expect(menu.getByTestId('g3-mi-ascending').locator('.check svg')).toHaveCount(0);

  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('g3-last')).toHaveText('title');
  await expect(trigger).toBeFocused();
});

test('toasts: an error stays and closes by × or Escape; success closes by itself after 5 s with no button (C-6)', async () => {
  const { page } = s;
  await page.clock.install();
  await open(page);
  await page.getByTestId('g3-toast-error').click();
  const error = page.getByTestId('toast-error');
  await expect(error).toBeVisible();
  await expect(error.getByRole('button', { name: '닫기' })).toBeVisible();

  await page.getByTestId('g3-toast-success').click();
  const success = page.getByTestId('toast-success');
  await expect(success).toBeVisible();
  await expect(success.getByRole('button')).toHaveCount(0);
  await page.mouse.move(0, 0); // a hovered toast region pauses its timers
  await page.clock.runFor(4_500);
  await expect(success).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(success).toHaveCount(0);
  await page.clock.runFor(60_000);
  await expect(error).toBeVisible();

  await error.focus();
  await page.keyboard.press('Escape');
  await expect(error).toHaveCount(0);

  await page.getByTestId('g3-toast-error').click();
  await expect(error).toBeVisible();
  await error.getByTestId('toast-close').click();
  await expect(error).toHaveCount(0);
});

test('an icon button tooltip shows its name and the platform shortcut (acceleratorLabel)', async () => {
  const { page } = s;
  for (const [platform, shortcut] of [
    ['linux', 'Ctrl+B'],
    ['darwin', '⌘B'],
  ] as const) {
    await open(page, platform);
    await tabTo(page, 'g3-tip-before', 'g3-tip');
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('책갈피');
    await expect(tip.locator('.tooltip-shortcut')).toHaveText(shortcut);
  }
});

test('segmented control: arrow keys move the selection', async () => {
  const { page } = s;
  await open(page);
  await page.getByRole('radio', { name: '보통' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: '여유 있게' })).toBeChecked();
  await expect(page.getByTestId('g3-seg-value')).toHaveText('comfortable');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: '촘촘하게' })).toBeChecked();
  await expect(page.getByTestId('g3-seg-value')).toHaveText('compact');
});

test('search field: the clear button shows with a value, clears it and returns focus to the field', async () => {
  const { page } = s;
  await open(page);
  const input = page.getByRole('searchbox', { name: '검색' });
  const clear = page.getByTestId('g3-search-clear');
  await expect(input).toHaveValue('신호');
  await expect(clear).toHaveAccessibleName('지우기');
  await clear.click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(clear).toHaveCount(0);
  await input.fill('효소');
  await expect(clear).toBeVisible();
});

test('board geometry: toasts 42 / 58 with the icon on the title line, tooltip 18, menu rows 24, small field 24', async () => {
  const { page } = s;
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  await page.goto('learn://app/index.html?window=gallery&part=2&platform=linux&det=1');
  const success = await box('.toast[data-kind="success"]');
  expect(success.height).toBe(12 + 18 + 12);
  expect((await box('.toast[data-kind="error"]')).height).toBe(12 + 18 + 16 + 12);
  const icon = await box('.toast[data-kind="success"] .t-icon svg');
  expect(icon.width).toBe(16);
  expect(icon.y + icon.height / 2 - success.y).toBe(12 + 18 / 2);
  expect((await box('.gallery .tooltip')).height).toBe(18);

  await page.goto('learn://app/index.html?window=gallery&part=1&platform=linux&det=1');
  expect((await box('.menu .mi')).height).toBe(24);
  expect((await box('.menu .msep')).height).toBe(1);
  expect((await box('.field.small')).height).toBe(24);
});
