// T1a Tasks 15–17: the tutor in the reader's right panel — the consent card, 나중에 and the off state, 동의 (spec 8.2, 8.6), then the agent
// chooser: Claude Code's row in its five states, 다시 찾기, the fake agent and its band (spec 4.3, 8.7), then the session: the empty one and
// the conversation — bubbles, tool chips, the answer's chips that go to their page, copy, the sent scope, 최신으로, 새 세션 (spec 7, 8.2, 8.3,
// 8.5). Nothing runs before consent. The composer comes with the next task: these tests ask through window.learn.tutor.ask.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import type { TutorAskInput } from '../../packages/domain/src/tutor';
import {
  FIXTURES, backFromReader, expectTooltipText, hoverLikeUser, importPaths, ipcCalls, launch, mainWindow, openItem, readClipboard, runMenuCommand, runPalette, textExtraction, textIdle, tutorFailAgents,
  tutorFakeScript, tutorProcesses, type Session,
} from './helpers';
import { READER_100, askViaApi, consentAndChoose, installFakeAgents, turnEnded } from './tutor-helpers';

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
    await expect.poll(() => readClipboard(app)).toBe(ADAPTER_CMD); // the copy lands a moment after the click
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
    await expect.poll(async () => nb(await readClipboard(app))).toBe(login);
    expect(await readClipboard(app)).not.toContain(' ');
    await expectNoSeriousA11y(page, 'tutor chooser, login needed');

    // 설치 안 됨: the one-line install of both, and no 다시 확인 (다시 찾기 is what finds an install).
    s.reinstall({ cli: null, adapter: null });
    await page.getByTestId('agent-research').click();
    await expect(flagOf(page)).toHaveText('설치 안 됨');
    await expect(claudeRow(page).getByTestId('agent-copy-text')).toHaveText(INSTALL_CMD);
    await claudeRow(page).getByTestId('agent-copy').click();
    await expect.poll(() => readClipboard(app)).toBe(INSTALL_CMD);
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
    await dev.getByTestId('agent-row').click(); // the row selects (its label covers it; the input itself is hidden)
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
    await claudeRow(page).click();
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

test('the whole row selects it, its padding included, and its own buttons keep their clicks', async ({}, testInfo) => {
  const s = await atChooser(testInfo, READY);
  const { app, page } = s;
  try {
    const dev = page.getByTestId('agent-dev-group').getByTestId('agent-row');
    await dev.click({ position: { x: 4, y: 4 } }); // the row's corner: padding
    await expect(page.getByTestId('agent-dev-group').getByRole('radio')).toBeChecked();
    await claudeRow(page).click({ position: { x: 4, y: 4 } });
    await expect(claudeRow(page).getByRole('radio')).toBeChecked();
    // A button inside the row keeps its click: 다시 확인 on a row that needs the login checks that row again and selects nothing.
    s.reinstall({ ...READY, script: 'login' });
    await page.getByTestId('agent-research').click();
    await expect(flagOf(page)).toHaveText('로그인 필요');
    await dev.click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId('agent-dev-group').getByRole('radio')).toBeChecked();
    const before = (await ipcCalls(app))['tutor:agents'] ?? 0;
    await claudeRow(page).getByTestId('agent-recheck').click();
    await expect.poll(async () => (await ipcCalls(app))['tutor:agents']).toBe(before + 1);
    await expect(flagOf(page)).toHaveText('로그인 필요');
    await expect(page.getByTestId('agent-dev-group').getByRole('radio')).toBeChecked();
    await expect(claudeRow(page).getByRole('radio')).not.toBeChecked();
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
    await expect(page.getByTestId('agent-research')).toHaveAttribute('aria-describedby', 'agent-failed-note');
    await expect(page.getByTestId('agent-row')).toHaveCount(2);
    await expect(page.getByTestId('agent-research')).toBeEnabled();
    await page.getByTestId('agent-research').click();
    await expect(page.getByTestId('agent-failed')).toHaveCount(0);
    await expect(page.getByTestId('agent-research')).not.toHaveAttribute('aria-describedby', /./);
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

// ---- The session and the conversation (Task 17) ----

/** paper-100.pdf on page 41 as the composer would send it: the answer script reads pages 41–42 and cites them. */
const READER_41: TutorAskInput['reader'] = { ...READER_100, pageIndex: 40 };
const EMPTY_TEXT = '이 자료에 대해 물어보세요. 본문에서 구간을 선택하면 질문에 붙고, 답에는 근거가 된 쪽이 함께 표시됩니다.';

/** paper-100.pdf with its body text read, open; the consent given and the fake agent chosen: the tutor shows its new empty session. */
async function atSession(testInfo: { outputPath(...p: string[]): string }, size: { width?: number; height?: number } = {}): Promise<Session & { itemId: string }> {
  const s = await launch(...dirs(testInfo), UNSET);
  await (await mainWindow(s.app)).evaluate((w, [width, height]) => w.setContentSize(width, height ?? w.getContentSize()[1]!), [size.width ?? 1440, size.height ?? null] as const);
  const [paper] = await importPaths(s.page, [PAPER]);
  await textExtraction(s.app, 'now');
  await textIdle(s.app);
  await openItem(s.page, 'paper-100');
  await expect(s.page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
  await consentAndChoose(s.page, 'fake');
  await expect(s.page.getByTestId('tutor-empty')).toBeVisible();
  return Object.assign(s, { itemId: paper!.id });
}

/** A question as the composer sends it; the answer it started. */
async function ask(page: Page, input: TutorAskInput): Promise<{ conversationId: string; tutorMessageId: string }> {
  const asked = await askViaApi(page, input);
  if ('busyWith' in asked) throw new Error('the question waited for another answer');
  return asked;
}

/** From now on, every state an answer's cite chip is drawn in, as "answer status:chip state:page" (a MutationObserver sees states that last less than a frame). */
async function recordCites(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __cites: string[] }).__cites = seen;
    const look = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-testid="tutor-answer"] [data-testid="cite-chip"]')) {
        const v = `${el.closest('[data-testid="tutor-answer"]')!.getAttribute('data-status')}:${el.dataset['cite']}:${el.dataset['page']}`;
        if (!seen.includes(v)) seen.push(v);
      }
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __cites: string[] }).__cites);
}

/** The pointer over this element as a person brings it there, for a hover tooltip (hoverLikeUser, for a locator). */
async function hoverOver(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  const [x, y] = await page.evaluate(() => [Math.round(innerWidth / 2), Math.round(innerHeight / 2)] as const);
  await page.mouse.move(x, y);
  await target.hover();
}

const fromBottom = (page: Page) => page.getByTestId('tutor-log').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

test('a conversation: the empty session, then a question\'s tool chips and its answer, chips that go to their page, copy, the sent scope and its list, a reload, 새 세션', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page, itemId } = s;
  try {
    // A new empty session: the item's title over what to do; 새 세션 is off and says why. The fake's band is over it.
    const empty = page.getByTestId('tutor-empty');
    await expect(empty.locator('.pe-title')).toHaveText('paper-100');
    expect(nb(await empty.locator('.pe-text').innerText())).toBe(EMPTY_TEXT);
    const newSession = page.getByTestId('tutor-new-session');
    await expect(newSession).toHaveAttribute('aria-disabled', 'true');
    await hoverLikeUser(page, 'tutor-new-session');
    await expectTooltipText(page, /^새.세션\s*지금 세션이 비어 있습니다$/, 'tutor-new-session');
    await expect(page.getByTestId('tutor-fake-band')).toBeVisible();
    await expectNoSeriousA11y(page, 'tutor empty session');

    const seen = await recordCites(page);
    const asked = await ask(page, { itemId, conversationId: null, text: '이 장은 무엇을 다루나요?', selection: null, reader: READER_41 });
    // The tab's tutor shows the session its question made: the question on the right, the tools over the answer.
    await expect(page.getByTestId('tutor-question').locator('.bubble')).toHaveText('이 장은 무엇을 다루나요?');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer.getByTestId('tool-chip')).toHaveText(['위치 확인', '목차 확인', '41–42쪽 읽음']);
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    await expect(answer).toHaveAttribute('data-status', 'complete');
    const chips = answer.getByTestId('cite-chip');
    await expect(chips).toHaveText(['41쪽', '42쪽']);
    // While the answer came, a page this turn had read was a chip at once (never 확인 중), and it stayed one at the end.
    expect(await seen()).toEqual(expect.arrayContaining(['streaming:go:41', 'streaming:go:42', 'complete:go:41', 'complete:go:42']));
    expect((await seen()).filter((v) => !v.includes(':go:'))).toEqual([]);
    await expect(page.getByTestId('tutor-said')).toHaveText('답을 받았습니다');
    await expect(page.getByTestId('tutor-session-head')).toHaveText(/^오늘 (오전|오후) \d{1,2}:\d{2}$/);
    await expect(newSession).not.toHaveAttribute('aria-disabled');
    // The log is one Tab stop, not a live region.
    const log = page.getByTestId('tutor-log');
    await expect(log).toHaveAttribute('role', 'log');
    await expect(log).toHaveAccessibleName('대화');
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(log).toHaveAttribute('tabindex', '0');
    await expect(chips.first()).toHaveRole('link');
    // Named by its words (label in name), "41쪽으로 이동" its description and tooltip.
    await expect(chips.first()).toHaveAccessibleName('41쪽');
    await expect(chips.first()).toHaveAccessibleDescription('41쪽으로 이동');
    await hoverOver(page, chips.first());
    await expectTooltipText(page, '41쪽으로 이동', 'cite-chip');
    // The fake's band stays over the conversation, under the head.
    const band = (await page.getByTestId('tutor-fake-band').boundingBox())!;
    expect((await log.boundingBox())!.y).toBeGreaterThanOrEqual(band.y + band.height - 1);
    await expectNoSeriousA11y(page, 'tutor conversation');

    // A chip goes to its page (a jump: back returns) and outlines that page for a moment; the reader's place is in the anchor's revision.
    const field = page.getByTestId('pdf-page-field');
    await expect(field).toHaveValue('1');
    await chips.nth(1).click();
    await expect(field).toHaveValue('42');
    await expect(page.locator('.pdfViewer .page[data-page-number="42"]')).toHaveClass(/\bcite-page\b/);
    await expect(page.locator('.pdfViewer .page.cite-page')).toHaveCount(0, { timeout: 5000 }); // 1.5 s, then it goes
    const thread = await page.evaluate((id) => window.learn.sessions.get({ conversationId: id }), asked.conversationId);
    if (!thread.ok) throw new Error(`sessions.get: ${thread.code}`);
    const source = thread.data.messages.find((m) => m.id === asked.tutorMessageId)!.sources.find((c) => c.pageIndex === 41)!;
    expect(source.anchorId).not.toBeNull();
    await expect
      .poll(async () => {
        const r = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), itemId);
        return r.ok && r.data !== null && r.data.locator.kind === 'pdf' ? [r.data.revisionId, r.data.locator.pageIndex] : null;
      })
      .toEqual([source.revisionId, 41]);
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field).toHaveValue('1');

    // 답 복사: the answer's text with its cites as "(41쪽)", "(42쪽)"; the tooltip says it is copied.
    await answer.getByTestId('tutor-copy').click();
    await expect.poll(() => readClipboard(app)).toContain('(42쪽)');
    const copied = await readClipboard(app);
    expect(copied).toContain('(41쪽)');
    expect(copied).not.toContain('[[p');
    await expectTooltipText(page, '복사했습니다', 'tutor-copy');

    // The sent-scope line under the question, and its list.
    const scope = page.getByTestId('tutor-question').getByTestId('sent-scope');
    await expect(scope).toHaveAccessibleName(/^선택\s0\s·\s자료\s1$/);
    await expect(scope).toHaveAccessibleDescription('보낸 것 선택 0개, 읽게 열어 둔 것 자료 1개 — 누르면 목록이 열립니다');
    await expect(scope).toHaveAttribute('aria-expanded', 'false');
    await scope.click();
    await expect(scope).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByTestId('sent-scope-list');
    await expect(list.locator('dt')).toHaveText(['보낸 것', '읽게 열어 둔 것', '읽은 쪽', '에이전트']);
    await expect(list.locator('dd')).toHaveText(['질문', 'paper-100', '41–42쪽', '가짜 에이전트']);
    await expect(list.locator('dd').last().locator('.lucide-flask-conical')).toHaveCount(1);
    await expectNoSeriousA11y(page, 'tutor conversation, the sent-scope list open');

    // A reload of the window shows the same session, its chips drawn from what was stored.
    await page.reload();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    const again = page.getByTestId('tutor-answer').getByTestId('cite-chip');
    await expect(again).toHaveText(['41쪽', '42쪽']);
    await expect.poll(() => again.evaluateAll((els) => els.map((e) => e.getAttribute('data-cite')))).toEqual(['go', 'go']);

    // 새 세션: the tab's tutor is on a new empty session; at most the one agent process of the run is left.
    await page.getByTestId('tutor-new-session').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('tutor-new-session')).toHaveAttribute('aria-disabled', 'true');
    expect((await tutorProcesses(app)).count).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }
  // A new run is a new empty session (J44): the session the tab showed is in the list, not on screen.
  const next = await launch(...dirs(testInfo), UNSET);
  try {
    await expect(next.page.getByTestId('item-row').or(next.page.getByTestId('pdf-viewer')).first()).toBeVisible();
    if ((await next.page.getByTestId('pdf-viewer').count()) === 0) await openItem(next.page, 'paper-100');
    await expect(next.page.getByTestId('tutor-empty')).toBeVisible();
    await expect(next.page.getByTestId('tutor-answer')).toHaveCount(0);
  } finally {
    await next.app.close();
  }
});

test('a cite of a page the answer did not read: 확인 중 while it comes, 출처 없음 once it ended, its reason in the tooltip, and copied as (출처 없음)', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'unverified');
    const seen = await recordCites(page);
    const asked = await ask(page, { itemId, conversationId: null, text: '이 장은 무엇을 다루나요?', selection: null, reader: READER_41 });
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'complete');
    // Read 41–42; it also pointed at 43 (not read) and 999 (past the last page).
    const chips = answer.getByTestId('cite-chip');
    await expect(chips).toHaveText(['41쪽', '42쪽', '출처 없음', '출처 없음']);
    expect(await chips.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-cite')}:${e.getAttribute('data-page')}`))).toEqual(['go:41', 'go:42', 'none:43', 'none:999']);
    const states = await seen();
    expect(states).toEqual(expect.arrayContaining(['streaming:go:41', 'streaming:checking:43', 'streaming:checking:999', 'complete:none:43', 'complete:none:999']));
    expect(states.filter((v) => v.startsWith('streaming:') && v.includes(':none:'))).toEqual([]); // no warning while it came (J41)
    // Not a link to anywhere: in the Tab order, its reason in the tooltip, a press goes nowhere.
    const unread = chips.nth(2);
    await expect(unread).toHaveAttribute('tabindex', '0');
    await expect(unread).toHaveAttribute('aria-disabled', 'true');
    await expect(unread.locator('.lucide-circle-help')).toHaveCount(1);
    await hoverOver(page, unread);
    await expectTooltipText(page, '확인되지 않은 인용 · 튜터가 43쪽을 가리켰지만 이번 답에서 그 쪽을 읽지 않았습니다', 'cite-chip');
    await page.mouse.move(5, 5);
    await hoverOver(page, chips.nth(3));
    await expectTooltipText(page, '확인되지 않은 인용 · 999쪽은 이 자료에 없습니다', 'cite-chip');
    await unread.click({ force: true }); // aria-disabled: a click that a person can make, and that goes nowhere
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('1');
    await answer.getByTestId('tutor-copy').click();
    await expect.poll(() => readClipboard(app)).toContain('(출처 없음)');
    expect(await readClipboard(app)).toContain('(41쪽)');
    await expectNoSeriousA11y(page, 'tutor answer with unverified cites');
  } finally {
    await app.close();
  }
});

test('while an answer comes the column keeps to its bottom; scrolled up it stays and 최신으로 brings it back, and stays while unread text is below', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo, { height: 800 });
  try {
    await tutorFakeScript(app, 'slow');
    const asked = await ask(page, { itemId, conversationId: null, text: '천천히 답해 주세요.', selection: null, reader: READER_41 });
    const log = page.getByTestId('tutor-log');
    const latest = page.getByTestId('tutor-latest');
    // Following: once the answer is taller than the column, the column is at its bottom as it grows.
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight), { timeout: 15_000 }).toBeGreaterThan(300);
    await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(24);
    await expect(latest).toHaveCount(0);
    // The user scrolls up: the column stays where they went, and 최신으로 shows above the composer's place, centred.
    await log.hover();
    await page.mouse.wheel(0, -250);
    await expect(latest).toBeVisible();
    const top = await log.evaluate((el) => el.scrollTop);
    const length = await page.getByTestId('tutor-answer-text').evaluate((el) => el.textContent!.length);
    await expect.poll(() => page.getByTestId('tutor-answer-text').evaluate((el) => el.textContent!.length)).toBeGreaterThan(length + 100);
    expect(Math.abs((await log.evaluate((el) => el.scrollTop)) - top)).toBeLessThanOrEqual(1);
    const [l, b] = [(await log.boundingBox())!, (await latest.boundingBox())!];
    expect(Math.abs(b.x + b.width / 2 - (l.x + l.width / 2))).toBeLessThanOrEqual(8); // the column's centre (the scroll bar's gutter aside)
    expect(b.y + b.height).toBeLessThanOrEqual(l.y + l.height);
    // Scrolled past the head line, the session's name stays under the panel head.
    await log.evaluate((el) => void (el.scrollTop = 120));
    await expect(page.getByTestId('tutor-sticky')).toBeVisible();
    await expect(page.getByTestId('tutor-sticky')).toHaveText('천천히 답해 주세요.');
    await expectNoSeriousA11y(page, 'tutor conversation scrolled up while the answer comes');
    // 최신으로: to the bottom, following again.
    await latest.click();
    await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(24);
    await expect(latest).toHaveCount(0);
    await expect(log).toBeFocused();
    const more = await page.getByTestId('tutor-answer-text').evaluate((el) => el.textContent!.length);
    await expect.poll(() => page.getByTestId('tutor-answer-text').evaluate((el) => el.textContent!.length)).toBeGreaterThan(more + 100);
    await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(24);
    // Scrolled up again until the answer ends: what came below is unread, so 최신으로 stays.
    expect(await page.getByTestId('tutor-answer').getAttribute('data-status'), 'the answer is still coming (the slow script runs 10 s)').toBe('streaming');
    await log.evaluate((el) => void (el.scrollTop = 0));
    await expect(latest).toBeVisible();
    await expect(page.getByTestId('tutor-sticky')).toBeHidden(); // the head line is in view
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await expect(latest).toBeVisible();
    await latest.click();
    await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(24);
    await expect(latest).toHaveCount(0);
    // At rest a scroll up shows no 최신으로: nothing new came below.
    await log.evaluate((el) => void (el.scrollTop = 0));
    await expect(page.getByTestId('tutor-sticky')).toBeHidden();
    await expect(latest).toHaveCount(0);
  } finally {
    await app.close();
  }
});
