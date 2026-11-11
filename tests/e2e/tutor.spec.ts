// T1a Tasks 15 and 16: the tutor's first states in the reader's right panel — the consent card, 나중에 and the off state, 동의 (spec 8.2, 8.6),
// then the agent chooser: Claude Code's row in its five states, 다시 찾기, the fake agent and its band (spec 4.3, 8.7). Nothing runs before
// consent. The conversation and the composer come with the next tasks.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, backFromReader, expectTooltipText, hoverLikeUser, importPaths, ipcCalls, launch, mainWindow, openItem, readClipboard, runMenuCommand, runPalette, tutorFailAgents, tutorProcesses, type Session } from './helpers';
import { READER_100, askViaApi, installFakeAgents } from './tutor-helpers';

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
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'chooser');
    await expect(card).toHaveCount(0);
    await expect(off).toHaveCount(0);
    // The consent card's own call, then the chooser's one read of the agents that this run has: no agent was started, and none was chosen.
    expect((await ipcCalls(app))['tutor:consent']).toBe(1);
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await expect.poll(async () => (await ipcCalls(app))['tutor:agents']).toBe(1);
    expect((await tutorCalls(app)).map(([k]) => k)).toEqual(['tutor:agents']);
    expect((await tutorProcesses(app)).count).toBe(0);
  } finally {
    await app.close();
  }
});

test('the focus follows every state change of the panel, with the keyboard: 나중에 → 튜터 켜기… → 동의 → the chooser', async ({}, testInfo) => {
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
    // The focus goes into the chooser: with no Claude Code here (an empty search folder) the only usable radio is the fake's.
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await expect(page.getByRole('radio', { name: /가짜 에이전트/ })).toBeFocused();
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

// ---- The agent chooser (Task 16) ----

type Layout = Parameters<typeof installFakeAgents>[1];
const READY: Layout = { cli: '2.1.318', adapter: '0.103.0' };
const ADAPTER_CMD = 'npm install -g @agentclientprotocol/claude-agent-acp@0.103.0';
const INSTALL_CMD = 'npm install -g @anthropic-ai/claude-code @agentclientprotocol/claude-agent-acp@0.103.0';
const nb = (s: string) => s.replace(/ /g, ' ');

/** A reader with the consent given, the chooser on screen, and Claude Code installed as `layout` says (null: nothing — an empty search folder). */
async function atChooser(testInfo: { outputPath(...p: string[]): string }, layout: Layout | null, opts: { width?: number; failFirst?: boolean } = {}): Promise<Session & { reinstall(l: Layout): void }> {
  const dir = testInfo.outputPath('npm');
  const env: Record<string, string> = layout === null ? {} : { LEARN_AGENT_SEARCH_PATH: installFakeAgents(dir, layout) };
  const s = await launch(...dirs(testInfo), { env: { LEARN_E2E_SETTINGS: '', ...env } });
  await (await mainWindow(s.app)).evaluate((w, width) => w.setContentSize(width, w.getContentSize()[1]!), opts.width ?? 1440);
  await openPaper(s.page);
  if (opts.failFirst) await tutorFailAgents(s.app, 1);
  await s.page.getByTestId('tutor-consent-agree').click();
  await expect(s.page.getByTestId('tutor-chooser')).toBeVisible();
  return Object.assign(s, {
    /** The install changes under a running Learn: the same folder, rewritten. */
    reinstall(l: Layout) {
      fs.rmSync(dir, { recursive: true, force: true });
      installFakeAgents(dir, l);
    },
  });
}
const claudeRow = (page: Page) => page.getByTestId('agent-row').and(page.locator('[data-agent="claude"]'));
const flagOf = (page: Page) => claudeRow(page).getByTestId('agent-flag');

test('Claude Code\'s row in its five states: what to run in a terminal, copied as shown, and 다시 확인 and 다시 찾기 to see the change', async ({}, testInfo) => {
  const s = await atChooser(testInfo, { cli: '2.1.318', adapter: null });
  const { app, page } = s;
  try {
    // One real agent, no Codex; the fake sits in its own group (a positive control for counting rows).
    await expect(page.getByTestId('agent-row')).toHaveCount(2);
    await expect(page.getByTestId('agent-dev-group').getByTestId('agent-row')).toHaveCount(1);
    await expect(page.getByTestId('tutor-chooser')).not.toContainText('Codex');
    await expect(page.getByRole('heading', { name: '에이전트 고르기' })).toBeVisible();
    expect(nb(await page.getByTestId('tutor-chooser-lead').innerText())).toBe('튜터는 이 Mac에 설치된 Claude Code로 답합니다. 로그인은 Claude Code에서 합니다.');

    // 연결 도구 필요: the install of the connection tool, and the size it downloads.
    await expect(flagOf(page)).toHaveText('연결 도구 필요');
    await expect(claudeRow(page).getByTestId('agent-description')).toHaveText(/설치할 때 약 350 MB를 내려받습니다\.$/);
    await expect(claudeRow(page).getByTestId('agent-copy-text')).toHaveText(ADAPTER_CMD);
    await claudeRow(page).getByTestId('agent-copy').click();
    expect(await readClipboard(app)).toBe(ADAPTER_CMD);
    await expectTooltipText(page, '복사했습니다', 'agent-copy');
    await expect(claudeRow(page).getByRole('radio')).toBeDisabled();
    await expect(page.getByTestId('agent-start')).toHaveAttribute('aria-disabled', 'true');
    await expectNoSeriousA11y(page, 'tutor chooser, connection tool needed');

    // The install is fixed in a terminal; 다시 확인 reads that row again: 준비됨.
    s.reinstall(READY);
    await claudeRow(page).getByTestId('agent-recheck').click();
    await expect(flagOf(page)).toHaveText('준비됨');
    await expect(claudeRow(page).getByTestId('agent-recheck')).toHaveCount(0);
    await expect(claudeRow(page).getByRole('radio')).toBeChecked();
    await expect(page.getByTestId('agent-start')).toHaveText('Claude Code로 시작');
    await expectNoSeriousA11y(page, 'tutor chooser, ready');

    // 지원하지 않는 버전: no command to run, the versions that are needed; 다시 찾기 finds the change.
    s.reinstall({ cli: '2.1.300', adapter: '0.103.0' });
    await page.getByTestId('agent-research').click();
    await expect(flagOf(page)).toHaveText('지원하지 않는 버전');
    expect(nb(await claudeRow(page).getByTestId('agent-description').innerText())).toBe('Claude Code 2.1.318 이상과 연결 도구 0.103.0 이상이 필요합니다. 업데이트한 뒤 다시 확인하세요.');
    await expect(claudeRow(page).getByTestId('agent-copy')).toHaveCount(0);
    await expect(claudeRow(page).getByTestId('agent-recheck')).toBeVisible();

    // 로그인 필요: the Learn-only login command (a terminal's, with Learn's own settings folder).
    s.reinstall({ ...READY, script: 'login' });
    await claudeRow(page).getByTestId('agent-recheck').click();
    await expect(flagOf(page)).toHaveText('로그인 필요');
    const login = nb(await claudeRow(page).getByTestId('agent-copy-text').innerText());
    expect(login).toMatch(/^CLAUDE_CONFIG_DIR="[^"]+" claude auth login$/);
    await claudeRow(page).getByTestId('agent-copy').click();
    expect(nb(await readClipboard(app))).toBe(login);
    expect(await readClipboard(app)).not.toContain(' ');
    await expectNoSeriousA11y(page, 'tutor chooser, login needed');

    // 설치 안 됨: the one-line install of both, and no 다시 확인 (다시 찾기 is what finds an install).
    s.reinstall({ cli: null, adapter: null });
    await page.getByTestId('agent-research').click();
    await expect(flagOf(page)).toHaveText('설치 안 됨');
    await expect(claudeRow(page).getByTestId('agent-copy-text')).toHaveText(INSTALL_CMD);
    await claudeRow(page).getByTestId('agent-copy').click();
    expect(await readClipboard(app)).toBe(INSTALL_CMD);
    await expect(claudeRow(page).getByTestId('agent-recheck')).toHaveCount(0);
    expect(await page.getByTestId('agent-start').getAttribute('aria-disabled')).toBe('true');
    expect((await tutorProcesses(app)).count).toBe(0);
  } finally {
    await app.close();
  }
});

/** The chooser and its command fit the panel: no sideways scroll, the command's lines inside its box, and clear of its copy button. */
async function expectCommandFits(page: Page, what: string): Promise<void> {
  const chooser = page.getByTestId('tutor-chooser');
  expect(await chooser.evaluate((e) => e.scrollWidth <= e.clientWidth), `${what}: the chooser scrolls sideways`).toBe(true);
  const code = claudeRow(page).getByTestId('agent-copy-text');
  expect(await code.evaluate((e) => e.scrollWidth <= e.clientWidth), `${what}: the command runs out of its box`).toBe(true);
  const box = (await code.boundingBox())!;
  const button = (await claudeRow(page).getByTestId('agent-copy').boundingBox())!;
  expect(box.x + box.width, `${what}: the command overlaps its copy button`).toBeLessThanOrEqual(button.x + 0.5);
  for (const w of await code.locator('.cmd-part').all()) {
    const b = (await w.boundingBox())!;
    expect(b.x + b.width, `${what}: a part is outside the box`).toBeLessThanOrEqual(box.x + box.width + 0.5);
  }
}

for (const [name, width, tutor] of [['380', 1440, 380], ['320', 1000, 320]] as const) {
  test(`at a tutor width of ${name} a command breaks between arguments and after a "/", and the chooser never scrolls sideways`, async ({}, testInfo) => {
    const s = await atChooser(testInfo, { cli: '2.1.318', adapter: null }, { width });
    const { page } = s;
    try {
      await expect.poll(() => page.getByTestId('inspector-panel').evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(tutor);
      await expect(flagOf(page)).toHaveText('연결 도구 필요');
      await expectCommandFits(page, 'adapter');
      // More than one line: the command wrapped at its spaces, not only at its "/".
      const code = claudeRow(page).getByTestId('agent-copy-text');
      expect((await code.boundingBox())!.height).toBeGreaterThan(30);
      const lineTops = await code.locator('.cmd-part').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
      expect(lineTops).toBeGreaterThanOrEqual(2);
      await expectNoSeriousA11y(page, `tutor chooser at ${name}`);
      // The login command is as long as this test's folder names (a part wider than the line breaks at the box's edge); then the install of both.
      s.reinstall({ ...READY, script: 'login' });
      await page.getByTestId('agent-research').click();
      await expect(flagOf(page)).toHaveText('로그인 필요');
      await expectCommandFits(page, 'login');
      expect(nb(await code.innerText()).replace(/\n/g, ' ')).toMatch(/^CLAUDE_CONFIG_DIR="[^"]+" claude auth login$/);
      s.reinstall({ cli: null, adapter: null });
      await page.getByTestId('agent-research').click();
      await expect(flagOf(page)).toHaveText('설치 안 됨');
      await expectCommandFits(page, 'missing');
      expect(nb(await code.innerText())).toBe(INSTALL_CMD);
      // What the button copies is the command, whatever the screen did to it.
      await claudeRow(page).getByTestId('agent-copy').click();
      await expect.poll(() => readClipboard(s.app)).toBe(INSTALL_CMD);
    } finally {
      await s.app.close();
    }
  });
}

test('a search that takes longer than 300 ms says so, and 다시 찾기 keeps the rows it has, disabled, until the new list is in', async ({}, testInfo) => {
  // The connection tool that never says its login state: the check waits its 3 s for the notice.
  const { app, page } = await atChooser(testInfo, { ...READY, script: 'login-silent' });
  try {
    // The first read is that slow too: no rows yet, a line that says what is going on, the controls where they will be, disabled.
    const searching = page.getByTestId('agent-searching');
    await expect(searching).toHaveText('에이전트를 찾는 중…');
    await expect(page.getByTestId('agent-research')).toBeDisabled();
    await expect(page.getByTestId('agent-start')).toHaveText('시작');
    await expect(page.getByTestId('agent-start')).toHaveAttribute('aria-disabled', 'true');
    await expectNoSeriousA11y(page, 'tutor chooser, searching');
    await expect(searching).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('agent-row').first()).toBeVisible();
    await expect(page.getByTestId('agent-research')).toBeEnabled();

    // Again: the list stays under the line, disabled.
    const before = await page.getByTestId('agent-row').count();
    await page.getByTestId('agent-research').click();
    await expect(searching).toBeVisible();
    await expect(page.getByTestId('agent-row')).toHaveCount(before);
    await expect(page.getByTestId('tutor-chooser').getByRole('radio').first()).toBeDisabled();
    await expect(page.getByTestId('agent-research')).toBeDisabled();
    await expect(searching).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('agent-row')).toHaveCount(before);
    await expect(page.getByTestId('agent-research')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('the fake agent: its own group and badge in a test build, chosen and started, and the band says what it is', async ({}, testInfo) => {
  const { app, page } = await atChooser(testInfo, READY);
  try {
    const dev = page.getByTestId('agent-dev-group');
    await expect(dev).toContainText('개발·데모 빌드에서만 보입니다');
    await expect(dev.getByTestId('agent-flag')).toHaveText('개발용');
    await expect(dev.getByTestId('agent-description')).toHaveText('정해 둔 답과 인용을 돌려줍니다.');
    await expect(dev.getByRole('radio', { name: /가짜 에이전트/ })).toBeEnabled();
    await expect(page.getByTestId('tutor-fake-band')).toHaveCount(0);
    // Claude Code is chosen first (it is ready); the fake is another click.
    await expect(page.getByTestId('agent-start')).toHaveText('Claude Code로 시작');
    await dev.locator('.a-name').click(); // its name: a click on the label's text (the input itself is hidden)
    await expect(page.getByTestId('agent-start')).toHaveText('가짜 에이전트로 시작');
    await expectNoSeriousA11y(page, 'tutor chooser, the fake chosen');
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('tutor-chooser')).toHaveCount(0);
    const band = page.getByTestId('tutor-fake-band');
    await expect(band).toHaveText('가짜 에이전트 · 정해 둔 답을 돌려줍니다(개발·데모 빌드)');
    // Under the head, above what the panel shows.
    const head = (await page.getByTestId('inspector-head').boundingBox())!;
    expect((await band.boundingBox())!.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
    expect(((await prefs(page)) as { data: { tutor: { agent: string } } }).data.tutor.agent).toBe('fake');
    await expectNoSeriousA11y(page, 'tutor with the fake band');

    // 에이전트 고르기… from the palette: back to the chooser (the band stays: the fake is still the agent), the fake checked; Claude Code starts and the band goes.
    await runPalette(page, app, '에이전트', 'tutor.chooseAgent');
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await expect(band).toBeVisible();
    await expect(dev.getByRole('radio', { name: /가짜 에이전트/ })).toBeChecked();
    await claudeRow(page).locator('.a-name').click();
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'ready');
    await expect(band).toHaveCount(0);
    expect(((await prefs(page)) as { data: { tutor: { agent: string } } }).data.tutor.agent).toBe('claude');
    expect((await tutorProcesses(app)).count).toBe(0);
  } finally {
    await app.close();
  }
});

test('↩ on the chosen radio starts it, and ↩ on 다시 찾기 searches and starts nothing', async ({}, testInfo) => {
  const { app, page } = await atChooser(testInfo, READY);
  try {
    await expect(claudeRow(page).getByRole('radio')).toBeFocused();
    await page.getByTestId('agent-research').focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await ipcCalls(app))['tutor:agents']).toBe(2);
    expect((await ipcCalls(app))['tutor:chooseAgent'] ?? 0).toBe(0);
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'chooser');
    await claudeRow(page).getByRole('radio').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'ready');
    expect(((await prefs(page)) as { data: { tutor: { agent: string } } }).data.tutor.agent).toBe('claude');
  } finally {
    await app.close();
  }
});

test('the whole left block of a row selects it, blank space included', async ({}, testInfo) => {
  const { app, page } = await atChooser(testInfo, READY);
  try {
    const dev = page.getByTestId('agent-dev-group').getByTestId('agent-row');
    await dev.click({ position: { x: 36, y: 20 } }); // between the circle and the name
    await expect(page.getByTestId('agent-dev-group').getByRole('radio')).toBeChecked();
    await claudeRow(page).click({ position: { x: 36, y: 20 } });
    await expect(claudeRow(page).getByRole('radio')).toBeChecked();
  } finally {
    await app.close();
  }
});

test('the disabled 시작 says why: nothing ready, searching, a read that failed', async ({}, testInfo) => {
  const s = await atChooser(testInfo, { cli: null, adapter: null }, { failFirst: true });
  const { app, page } = s;
  try {
    // The first read failed: one line where the rows would be, and the reason says it (the focus is on 다시 찾기).
    await expect(page.getByTestId('agent-failed')).toHaveText('에이전트를 확인하지 못했습니다. 다시 찾기를 누르세요.');
    await expect(page.getByTestId('agent-row')).toHaveCount(0);
    await expect(page.getByTestId('agent-research')).toBeEnabled();
    await expect(page.getByTestId('agent-research')).toBeFocused();
    await hoverLikeUser(page, 'agent-start');
    await expectTooltipText(page, '에이전트를 확인하지 못했습니다', 'agent-start');
    await expectNoSeriousA11y(page, 'tutor chooser, a failed read');
    // Shown again, it reads again: 정보 and back.
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('tutor-chooser')).toHaveCount(0);
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect(page.getByTestId('agent-row')).toHaveCount(2);
    await expect(page.getByTestId('agent-failed')).toHaveCount(0);
    // Nothing ready: the reason that points at the row's guidance.
    await expect(flagOf(page)).toHaveText('설치 안 됨');
    await page.mouse.move(0, 0);
    await hoverLikeUser(page, 'agent-start');
    await expectTooltipText(page, 'Claude Code가 준비되지 않았습니다 — 안내를 따른 뒤 다시 확인하세요', 'agent-start');
    // A press that fails keeps the rows, and says so above them.
    await tutorFailAgents(app, 1);
    await page.getByTestId('agent-research').click();
    await expect(page.getByTestId('agent-failed')).toBeVisible();
    await expect(page.getByTestId('agent-row')).toHaveCount(2);
    await expect(page.getByTestId('agent-research')).toBeEnabled();
    await page.getByTestId('agent-research').click();
    await expect(page.getByTestId('agent-failed')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('while a search runs the list is dimmed once and every control in it is off; the focus comes back to 다시 찾기; 시작 says it is searching', async ({}, testInfo) => {
  const s = await atChooser(testInfo, { cli: '2.1.318', adapter: null });
  const { app, page } = s;
  try {
    await expect(claudeRow(page).getByTestId('agent-copy')).toBeEnabled();
    s.reinstall({ ...READY, script: 'login-silent' });
    await page.getByTestId('agent-research').click();
    await expect(page.getByTestId('agent-searching')).toBeVisible();
    await expect(claudeRow(page).getByTestId('agent-copy')).toBeDisabled();
    await expect(claudeRow(page).getByTestId('agent-recheck')).toBeDisabled();
    // One dimming for the whole list, its labels included.
    const opacity = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).opacity);
    expect(await opacity('.agent-groups')).toBe('0.45');
    expect(await opacity('.agent-groups .agent-row')).toBe('1');
    await page.mouse.move(0, 0);
    await hoverLikeUser(page, 'agent-start');
    await expectTooltipText(page, '에이전트를 찾는 중입니다', 'agent-start');
    await expect(page.getByTestId('agent-searching')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('agent-research')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the chooser shown by a switch of tabs takes no focus', async ({}, testInfo) => {
  const { app, page } = await atChooser(testInfo, READY);
  try {
    const sample = path.join(FIXTURES, 'sample.pdf');
    await backFromReader(page);
    await importPaths(page, [sample]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await page.getByTestId('pdf-viewer').click({ position: { x: 20, y: 20 } });
    await page.locator('[data-testid="tab"]', { hasText: 'paper-100' }).click(); // a switch of tabs: the panel of the other tab
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('[data-testid="tutor-chooser"]')?.contains(document.activeElement) ?? true)).toBe(false);
  } finally {
    await app.close();
  }
});

test('a folded panel asks main nothing: no detection until the chooser can be seen', async ({}, testInfo) => {
  let s = await atChooser(testInfo, READY);
  try {
    await runMenuCommand(s.app, 'view.toggleInspector');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    await s.page.waitForTimeout(1000); // the layout is saved 300 ms after it changes
  } finally {
    await s.app.close();
  }
  // Relaunch: consent recorded, no agent chosen, the panel still folded.
  const dir = testInfo.outputPath('npm');
  const again = await launch(...dirs(testInfo), { env: { LEARN_E2E_SETTINGS: '', LEARN_AGENT_SEARCH_PATH: path.join(dir, 'bin') } });
  try {
    await (await mainWindow(again.app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    // The reader tab comes back by itself, or the library shows: either way the paper ends up open.
    await expect(again.page.getByTestId('item-row').or(again.page.getByTestId('pdf-viewer')).first()).toBeVisible();
    if ((await again.page.getByTestId('pdf-viewer').count()) === 0) await openItem(again.page, 'paper-100');
    await expect(again.page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(again.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    await again.page.waitForTimeout(1500);
    expect((await ipcCalls(again.app))['tutor:agents'] ?? 0).toBe(0);
    expect((await tutorProcesses(again.app)).count).toBe(0);
    // Positive control: shown, it reads once.
    await runMenuCommand(again.app, 'view.toggleInspector');
    await expect(again.page.getByTestId('tutor-chooser')).toBeVisible();
    await expect.poll(async () => (await ipcCalls(again.app))['tutor:agents']).toBe(1);
  } finally {
    await again.app.close();
  }
});

test('a turn that fails on the login reads the agents again: the chooser then shows 로그인 필요 with its command (I3)', async ({}, testInfo) => {
  const s = await atChooser(testInfo, READY);
  const { app, page } = s;
  try {
    const itemId = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data[0]!.id : '';
    });
    await expect(flagOf(page)).toHaveText('준비됨');
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'ready');
    await runPalette(page, app, '에이전트', 'tutor.chooseAgent');
    await expect(flagOf(page)).toHaveText('준비됨');
    // The login lapses while Learn runs: the next question fails on it.
    // The panel shows 정보 when the turn fails: nothing of the chooser is mounted to hear it.
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('tutor-chooser')).toHaveCount(0);
    s.reinstall({ ...READY, script: 'login' });
    const a = await askViaApi(page, { itemId, conversationId: null, text: '이 자료는 무엇을 다루나요?', selection: null, reader: READER_100 });
    if ('busyWith' in a) throw new Error('the question waited for another answer');
    // (A question that fails before any answer leaves no session behind, so the chooser's own row is what shows it.)
    await runPalette(page, app, '에이전트', 'tutor.chooseAgent');
    await expect(flagOf(page)).toHaveText('로그인 필요');
    await expect(claudeRow(page).getByTestId('agent-copy-text')).toContainText('claude auth login');
    // No agent is left: the panel shows no session, and whatever ran has exited.
    expect(await page.evaluate(() => window.learn.tutor.view({ view: null }))).toMatchObject({ ok: true });
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(0);
  } finally {
    await app.close();
  }
});
