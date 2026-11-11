// T1a Task 15: the tutor's first states in the reader's right panel — the consent card, 나중에 and the off state, 동의 (spec 8.2, 8.6).
// Nothing runs before consent. The conversation and the composer come with the next tasks.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, expectTooltipText, hoverLikeUser, importPaths, ipcCalls, launch, mainWindow, openItem, tutorProcesses } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const UNSET = { env: { LEARN_E2E_SETTINGS: '' } };

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const prefs = (page: Page) => page.evaluate(() => window.learn.prefs.get());
/** The calls that would start or probe an agent, or tell main a session is on screen. */
const tutorCalls = async (app: ElectronApplication) => Object.entries(await ipcCalls(app)).filter(([k]) => /^tutor:(agents|chooseAgent|view|warm|ask|stop|resend|reground)$/.test(k));

async function openPaper(page: Page): Promise<void> {
  await importPaths(page, [PAPER]);
  await openItem(page, 'paper-100');
  await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
}

test('the card comes first and nothing runs before 동의; 나중에 turns the tutor off for this run; 동의 is recorded by main', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    const card = page.getByTestId('tutor-consent');
    await expect(card).toBeVisible();
    // What the card says: one company and one agent; the Learn-only line in its three sentences (S6, S8).
    await expect(card).toContainText('Anthropic');
    await expect(card).toContainText('Claude Code');
    await expect(card).not.toContainText('OpenAI');
    await expect(card).not.toContainText('Codex');
    await expect(card.getByRole('heading', { name: '튜터는 이 Mac의 에이전트로 답합니다' })).toBeVisible();
    const config = (await page.getByTestId('tutor-consent-config').innerText()).replace(/ /g, ' ');
    expect(config).toContain('Learn 전용 설정');
    expect(config).toContain('에이전트는 평소 설정과 따로, Learn 전용 설정 폴더를 씁니다.');
    expect(config).toContain('그래서 처음 한 번 따로 로그인해야 합니다.');
    expect(config).toContain('에이전트도 대화 기록을 이 폴더에 남깁니다.');
    await expect(card.getByRole('button', { name: '나중에' })).toBeVisible();
    await expect(card.getByRole('button', { name: '동의' })).toBeVisible();
    await expectNoSeriousA11y(page, 'tutor consent card');
    // The card, with a positive control that the counters count (the consent itself is counted below): no agent, no probe, no view.
    expect((await tutorProcesses(app)).count).toBe(0);
    expect(await tutorCalls(app)).toEqual([]);
    expect((await prefs(page)) as { ok: true; data: { tutor: { consent: unknown } } }).toMatchObject({ ok: true, data: { tutor: { consent: null } } });

    // 나중에: the off state; 튜터 켜기… brings the card back; and 나중에 again.
    await card.getByRole('button', { name: '나중에' }).click();
    const off = page.getByTestId('tutor-off');
    await expect(off).toBeVisible();
    await expect(off).toContainText('튜터가 꺼져 있습니다');
    await expect(card).toHaveCount(0);
    await expectNoSeriousA11y(page, 'tutor off');
    await off.getByRole('button', { name: '튜터 켜기…' }).click();
    await expect(card).toBeVisible();
    await expect(off).toHaveCount(0);
    await card.getByRole('button', { name: '나중에' }).click();
    await expect(off).toBeVisible();
    expect((await tutorProcesses(app)).count).toBe(0);
    expect(await tutorCalls(app)).toEqual([]);

    // 동의: main writes it (the page cannot), and the card goes with prefsChanged.
    await off.getByRole('button', { name: '튜터 켜기…' }).click();
    await card.getByRole('button', { name: '동의' }).click();
    await expect.poll(async () => ((await prefs(page)) as { ok: true; data: { tutor: { consent: { version: number } | null } } }).data.tutor.consent?.version).toBe(1);
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'consented');
    await expect(card).toHaveCount(0);
    await expect(off).toHaveCount(0);
    // The consent card's own call is the only tutor call, and it started no agent.
    expect((await ipcCalls(app))['tutor:consent']).toBe(1);
    expect(await tutorCalls(app)).toEqual([]);
    expect((await tutorProcesses(app)).count).toBe(0);
  } finally {
    await app.close();
  }
});

test('the focus follows every state change of the panel, with the keyboard: 나중에 → 튜터 켜기… → 동의 → the selected tab', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    const card = page.getByTestId('tutor-consent');
    await expect(card).toBeVisible();
    // Into the panel by F6 and Tab to the card's buttons: the keyboard's way, no .focus().
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('F6');
      if (await page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') === 'inspector')) break;
    }
    await expect(page.getByRole('tab', { name: '튜터' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: '나중에' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-off')).toBeVisible();
    await expect(page.getByRole('button', { name: '튜터 켜기…' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: '동의' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => ((await prefs(page)) as { data: { tutor: { consent: { version: number } | null } } }).data.tutor.consent?.version).toBe(1);
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('tab', { name: '튜터' })).toBeFocused();
    expect((await ipcCalls(app))['tutor:consent']).toBe(1);
  } finally {
    await app.close();
  }
});

test('동의 has its tooltip, and a click and ↩ together send one consent', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    const agree = page.getByTestId('tutor-consent-agree');
    await expect(agree).toBeVisible();
    await hoverLikeUser(page, 'tutor-consent-agree');
    await expectTooltipText(page, '동의 — 카드에 포커스가 있으면 ↩', 'tutor-consent-agree');
    await agree.dblclick();
    await expect.poll(async () => ((await prefs(page)) as { data: { tutor: { consent: unknown } } }).data.tutor.consent).not.toBeNull();
    expect((await ipcCalls(app))['tutor:consent']).toBe(1);
  } finally {
    await app.close();
  }
});

test('↩ with the card itself in focus agrees; a button keeps its own ↩', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    const card = page.getByTestId('tutor-consent');
    await expect(card).toBeVisible();
    // On 나중에, ↩ presses 나중에 (not 동의).
    await card.getByRole('button', { name: '나중에' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-off')).toBeVisible();
    expect(((await prefs(page)) as { data: { tutor: { consent: unknown } } }).data.tutor.consent).toBeNull();
    await page.getByRole('button', { name: '튜터 켜기…' }).click();
    // On the card itself (a click on its text puts the focus there), ↩ is 동의.
    await expect(card).toBeVisible();
    await card.focus();
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => ((await prefs(page)) as { data: { tutor: { consent: { version: number } | null } } }).data.tutor.consent?.version).toBe(1);
  } finally {
    await app.close();
  }
});

test('the card is in the panel, not a sheet: the reader keeps its toolbar and the panel keeps its head', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    const card = (await page.getByTestId('tutor-consent').boundingBox())!;
    const panel = (await page.getByTestId('inspector-panel').boundingBox())!;
    const head = (await page.getByTestId('inspector-head').boundingBox())!;
    expect(Math.round(head.height)).toBe(44);
    expect(card.x).toBeGreaterThanOrEqual(panel.x);
    expect(card.x + card.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(card.y).toBeGreaterThanOrEqual(head.y + head.height);
    await expect(page.getByTestId('reader-toolbar')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await app.close();
  }
});
