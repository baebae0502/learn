// UI primitives in the real renderer: the interactive fixture of the component board (?window=gallery&part=3).
import { expect, test, type Locator, type Page } from '@playwright/test';
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

/**
 * The focus ring a user sees on a control: who draws it (the control, or the .soft-disabled wrapper of a Button that
 * is disabled with a reason), its geometry, and the opacity it is painted with (product over the ancestors).
 */
async function focusRing(control: Locator) {
  return control.evaluate((el) => {
    const holder = el.parentElement?.classList.contains('soft-disabled') ? el.parentElement : el;
    const cs = getComputedStyle(holder);
    let opacity = 1;
    for (let e: Element | null = holder; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    return { holder: holder === el ? 'self' : 'wrapper', style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, opacity };
  });
}
const OUTSIDE_RING = { holder: 'wrapper', style: 'solid', width: '2px', offset: '1px', opacity: 1 }; // like .btn
const INSIDE_RING = { holder: 'self', style: 'solid', width: '2px', offset: '-2px', opacity: 1 }; // like .icon-btn

test('a control disabled with a reason stays focusable, explains itself and ignores presses (I1)', async () => {
  const { page } = s;
  await open(page);
  const presses = page.getByTestId('g3-presses');
  // Sanity: the enabled neighbour does count presses.
  await page.getByTestId('g3-before').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('g3-before-presses')).toHaveText('1');

  const cases = [
    { id: 'g3-soft', before: 'g3-before', name: '내보내기', ring: OUTSIDE_RING },
    { id: 'g3-soft-icon', before: 'g3-soft', name: '사이드바', ring: INSIDE_RING },
    { id: 'g3-soft-menu', before: 'g3-soft-icon', name: '정렬', ring: OUTSIDE_RING },
  ];
  for (const c of cases) {
    const control = page.getByTestId(c.id);
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(await control.evaluate((b) => (b as HTMLButtonElement).disabled)).toBe(false); // focusable, not native-disabled
    await expect(control).toHaveAccessibleName(c.name); // the reason is never part of the name
    await expect(control).toHaveAccessibleDescription(REASON); // persistent, not only while the tooltip is open
    await tabTo(page, c.before, c.id);
    const tooltip = page.getByRole('tooltip');
    if (c.ring === INSIDE_RING) {
      // Icon button: name, then the reason in secondary colour; the shortcut slot gives way; one 18 px line.
      await expect(tooltip).toContainText(c.name);
      await expect(tooltip.locator('.tooltip-reason')).toHaveText(REASON);
      await expect(tooltip.locator('.tooltip-shortcut')).toHaveCount(0);
      expect((await tooltip.boundingBox())!.height).toBe(18);
    } else {
      await expect(tooltip).toHaveText(REASON);
    }
    // Spec 8.3: the ring keeps 3:1, so it is never dimmed with the disabled control (only its body or glyph is).
    expect(await focusRing(control)).toEqual(c.ring);
    expect(Number(await (c.ring === INSIDE_RING ? control.locator('.icon') : control).evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.5);
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

test('toasts: an action runs once and takes its toast away; a busy toast spins, has no button, stays until closed (P-29)', async () => {
  const { page } = s;
  await page.clock.install();
  await open(page);
  await page.getByTestId('g3-toast-action').click();
  const withAction = page.getByTestId('toast-action');
  await expect(withAction.getByRole('button')).toHaveText(['Finder에서 보기']);
  await withAction.getByTestId('toast-action-button').click();
  await expect(withAction).toHaveCount(0);
  await expect(page.getByTestId('g3-last')).toHaveText('reveal');

  await page.getByTestId('g3-toast-busy').click();
  const busy = page.getByTestId('toast-busy');
  await expect(busy.locator('.t-icon .spinner')).toHaveCount(1);
  await expect(busy.getByRole('button')).toHaveCount(0);
  await page.mouse.move(0, 0); // a hovered region would hold timers; a busy toast has none to hold
  await page.clock.runFor(60_000);
  await expect(busy).toBeVisible();
  await busy.focus();
  await page.keyboard.press('Escape'); // only an error toast closes by esc
  await expect(busy).toBeVisible();
  await page.getByTestId('g3-toast-busy-close').click();
  await expect(busy).toHaveCount(0);
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

test('board geometry: toasts 42 / 58 with icon and × on the title line, tooltip 18, menu rows 24, small field 24', async () => {
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
  const error = await box('.toast[data-kind="error"]');
  const close = await box('.toast[data-kind="error"] .icon-btn');
  expect(close.y + close.height / 2 - error.y).toBe(12 + 18 / 2); // × centred on the title line
  // A one-line toast with an action stays 42, the small button centred on the title line like the ×.
  const action = page.locator('.toast[data-kind="success"]').filter({ has: page.locator('.t-actions') });
  const actionBox = (await action.boundingBox())!;
  expect(actionBox.height).toBe(12 + 18 + 12);
  const actionButton = (await action.locator('.t-actions .btn').boundingBox())!;
  expect(actionButton.y + actionButton.height / 2 - actionBox.y).toBe(12 + 18 / 2);
  // The busy toast: the 16 px spinner where the icon goes, title and one file line (58).
  const busy = await box('.toast[data-kind="busy"]');
  expect(busy.height).toBe(12 + 18 + 16 + 12);
  const spinner = await box('.toast[data-kind="busy"] .spinner');
  expect(spinner.width).toBe(16);
  expect(spinner.y + spinner.height / 2 - busy.y).toBe(12 + 18 / 2);

  await page.goto(fixture());
  await page.getByTestId('g3-toast-error-title').click();
  expect((await page.getByTestId('toast-error-title').boundingBox())!.height).toBe(12 + 18 + 12);

  await page.goto('learn://app/index.html?window=gallery&part=1&platform=linux&det=1');
  // The board's forced-focus samples of controls disabled with a reason (the tour baseline guards their pixels).
  expect(await focusRing(page.getByTestId('g-soft-focus'))).toEqual(OUTSIDE_RING);
  expect(await focusRing(page.getByTestId('g-soft-focus-icon'))).toEqual(INSIDE_RING);
  expect((await box('.menu .mi')).height).toBe(24);
  // Section headers line up with the item labels (4 + 16 check column + 8 gap).
  const headText = await page.locator('.menu .mhead').first().evaluate((e) => e.getBoundingClientRect().left + parseFloat(getComputedStyle(e).paddingLeft));
  expect(headText).toBe((await box('.menu .mi .mi-label')).x);
  expect((await box('.menu .msep')).height).toBe(1);
  expect((await box('.field.small')).height).toBe(24);
});
