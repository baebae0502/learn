// T1a Tasks 15–18: the tutor in the reader's right panel — the consent card, 나중에 and the off state, 동의 (spec 8.2, 8.6), then the agent
// chooser: Claude Code's row in its five states, 다시 찾기, the fake agent and its band (spec 4.3, 8.7), then the session: the empty one and
// the conversation — bubbles, tool chips, the answer's chips that go to their page, copy, the sent scope, 최신으로, 새 세션 (spec 7, 8.2, 8.3,
// 8.5) — and the composer: ↩ and ⇧↩, 중지 and esc, the agent button and its menu, drafts, the item still opening, the question that
// waits for another session's answer, F6 and ⌃⌘2 (spec 8.4, 8.7, 8.11). Nothing runs before consent. The conversation's own tests ask
// through window.learn.tutor.ask, the composer's call.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import type { LearnPdfProbe } from '../../apps/desktop/src/renderer/src/viewers/pdf/anchorProbe';
import type { PdfAnchor } from '../../packages/domain/src/anchors';
import type { TutorAskInput } from '../../packages/domain/src/tutor';
import {
  FIXTURES, backFromReader, clickToCloseSheet, closeSheet, expectDisabledReason, expectTooltipText, expectWindow, hoverLikeUser, importPaths, ipcCalls, launch, mainWindow, menuItemEnabled,
  menuSnapshot, openItem, readClipboard, readerTab, recordedPopups, rowByTitle, runMenuAccelerator, runMenuCommand, runPalette, seedSessions, setPdfZoom, specialRow, stubContextMenu,
  stubFolderPicker, stubFolderPicks, textExtraction, textIdle, trashItems, tutorFailAgents, tutorFakeLog, tutorFakeScript, tutorProcesses, type MenuNode, type Session,
} from './helpers';
import { READER_100, askViaApi, consentAndChoose, installFakeAgents, turnEnded } from './tutor-helpers';

declare global {
  interface Window {
    /** The PDF reader's E2E probe (e2e=1 only): a selection's span anchor for a question's attached passage. */
    __learnPdf?: LearnPdfProbe;
    /** E2E only: whether the active reader holds a selection of its page. */
    __learnSelection?: { hasRange(): boolean };
  }
}

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const UNSET = { env: { LEARN_E2E_SETTINGS: '' } };

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const prefs = (page: Page) => page.evaluate(() => window.learn.prefs.get());
/** The calls that would start or probe an agent, or tell main a session is on screen. */
const tutorCalls = async (app: ElectronApplication) => Object.entries(await ipcCalls(app)).filter(([k]) => /^tutor:(agents|chooseAgent|view|warm|ask|stop|resend|reground)$/.test(k));

/** From nowhere, F6 until the focus is in the right pane: where F6 lands there is the test's. */
async function f6IntoPanel(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('F6');
    if (await page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') === 'inspector')) break;
  }
}

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
    await f6IntoPanel(page);
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

test('the fake agent: its own group and badge in a test build, chosen and started, and the band says what it is; 시작 puts the focus in the composer', async ({}, testInfo) => {
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
    // While the chooser shows, no agent runs: the fake's process from the first 시작 closed with the session out of sight, and nothing in
    // the chooser starts one before 시작.
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(0);
    await claudeRow(page).click();
    await expect(page.getByTestId('agent-start')).toHaveText('Claude Code로 시작');
    expect((await tutorProcesses(app)).count).toBe(0);
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-panel')).toHaveAttribute('data-state', 'ready');
    await expect(band).toHaveCount(0);
    expect(((await prefs(page)) as { data: { tutor: { agent: string } } }).data.tutor.agent).toBe('claude');
    // 시작 was pressed in the chooser: the composer takes the focus, and that focus starts the agent ahead of a question — one process,
    // never two (the fake's, started the same way after the first 시작, closed when the chooser showed again).
    await expect(composerInput(page)).toBeFocused();
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(1);
    expect((await tutorProcesses(app)).max).toBe(1);
  } finally {
    await app.close();
  }
});

test('↩ on the chosen radio starts it and the composer takes the focus, and ↩ on 다시 찾기 searches and starts nothing', async ({}, testInfo) => {
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
    // The keyboard is where it was: in the composer that took the chooser's place.
    await expect(composerInput(page)).toBeFocused();
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
    // The pressed chip is the current one (a 1 px ring), the other is not.
    await expect(chips.nth(1)).toHaveClass(/\bis-current\b/);
    expect(await chips.nth(1).evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/inset/);
    await expect(chips.nth(0)).not.toHaveClass(/\bis-current\b/);
    await expect(page.locator('.pdfViewer .page.cite-page')).toHaveCount(0, { timeout: 5000 }); // 1.5 s, then it goes
    await expect(chips.nth(1)).toHaveClass(/\bis-current\b/); // the reader still shows its page
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
    await expect(answer.locator('.cite.is-current')).toHaveCount(0); // the reader left its page
    // Another press: that chip is current; a scroll of the reader away from its page ends it.
    await chips.nth(0).click();
    await expect(field).toHaveValue('41');
    await expect(chips.nth(0)).toHaveClass(/\bis-current\b/);
    await page.getByTestId('pdf-scroll').evaluate((el) => void (el.scrollTop += 3 * el.clientHeight));
    await expect(field).not.toHaveValue('41');
    await expect(answer.locator('.cite.is-current')).toHaveCount(0);
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
    // At the question's right end, as wide as what it says: its right edge is the column's, and it is narrower than the column.
    const column = (await page.locator('.tutor-log-content').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
    }));
    const box = (await list.boundingBox())!;
    expect(Math.abs(box.x + box.width - column.right)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThan(column.right - column.left - 40);
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
    // A chip with its glyph keeps the paragraph's 20 px lines: from one chip's line to the next chip's, whole lines of 20 ± 1 px each.
    const tops = (await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top))).sort((a, b) => a - b);
    let steps = 0;
    for (let k = 1; k < tops.length; k += 1) {
      const d = tops[k]! - tops[k - 1]!;
      if (d < 1) continue; // the same line
      const lines = Math.round(d / 20);
      expect(lines, `chip ${k} is on a later line`).toBeGreaterThanOrEqual(1);
      expect(Math.abs(d - lines * 20), `chip ${k}: ${d} px over ${lines} line(s)`).toBeLessThanOrEqual(lines);
      steps += 1;
    }
    expect(steps).toBeGreaterThan(0);
    const states = await seen();
    expect(states).toEqual(expect.arrayContaining(['streaming:go:41', 'streaming:checking:43', 'streaming:checking:999', 'complete:none:43', 'complete:none:999']));
    expect(states.filter((v) => v.startsWith('streaming:') && v.includes(':none:'))).toEqual([]); // no warning while it came (J41)
    // Not a link to anywhere: in the Tab order, its reason in the tooltip, a press goes nowhere.
    const unread = chips.nth(2);
    await expect(unread).toHaveAttribute('tabindex', '0');
    await expect(unread).toHaveAttribute('aria-disabled', 'true');
    await expect(unread.locator('.lucide-circle-help')).toHaveCount(1);
    // The composer under the log leaves it shorter than the answer: its start is scrolled out. Brought back first, so the hover is not
    // the one that scrolls it in (that scroll shows and hides the session's name row above the log, moving the chip under the pointer).
    await page.getByTestId('tutor-log').evaluate((el) => void (el.scrollTop = 0));
    await expect(page.getByTestId('tutor-sticky')).toBeHidden();
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

test('an answer in Markdown is drawn as its blocks: the line before its page read apart, a numbered list with chips in its items and a code block under one, bold, inline code, a quote, a nested list; a tag stays text', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'markdown');
    const asked = await ask(page, { itemId, conversationId: null, text: '정리해 주세요.', selection: null, reader: READER_41 });
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    const body = page.getByTestId('tutor-answer-text');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    // What the agent wrote before it read its pages is a paragraph of its own, apart from the answer after the read.
    await expect(body.locator(':scope > p').first()).toHaveText('I will read the pages first.');
    // The heading is a bold paragraph; the paragraph's bold stays bold.
    await expect(body.locator(':scope > p').nth(1).locator('strong')).toHaveText('요점');
    await expect(body.locator(':scope > p').nth(2).locator('strong')).toHaveText('세 단계');
    // A numbered list of three items: the paragraph and the code block under the second stay in it. After the quote the list goes on
    // at its own number.
    const lists = body.locator(':scope > ol');
    await expect(lists).toHaveCount(2);
    const ol = lists.first();
    await expect(ol).not.toHaveAttribute('start');
    await expect(lists.nth(1)).toHaveAttribute('start', '4');
    await expect(lists.nth(1).locator(':scope > li')).toHaveCount(1);
    await expect(lists.nth(1).getByTestId('cite-chip')).toHaveText('42쪽');
    // 8 px between blocks: from the paragraph's last line to the list's first.
    const para = body.locator(':scope > p').nth(2);
    expect(Math.abs((await ol.evaluate((el) => el.getBoundingClientRect().top)) - (await para.evaluate((el) => el.getBoundingClientRect().bottom)) - 8)).toBeLessThanOrEqual(1);
    expect(await ol.evaluate((el) => getComputedStyle(el).listStyleType)).toBe('decimal'); // its numbers show
    expect(await body.locator(':scope > ul').evaluate((el) => getComputedStyle(el).listStyleType)).toBe('disc');
    const items = ol.locator(':scope > li');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).locator('code')).toHaveText(['query', 'key']);
    await expect(items.nth(0).getByTestId('cite-chip')).toHaveText('41쪽');
    await expect(items.nth(1).getByTestId('cite-chip')).toHaveText('42쪽');
    await expect(items.nth(1).locator('p')).toHaveText('예를 들면 다음과 같습니다.');
    const code = items.nth(1).locator('pre');
    await expect(code).toHaveText('score = softmax(q · k) [[p1]] <b>'); // a cite token and a tag in code stay text
    await expect(code.getByTestId('cite-chip')).toHaveCount(0);
    await expect(items.nth(2).getByTestId('cite-chip')).toHaveText('42쪽');
    await expect(body.locator('blockquote')).toHaveText('순서가 바뀌어도 같은 결과가 나옵니다.');
    await expect(body.locator(':scope > ul > li > ul > li')).toHaveText('세 단계는 한 번에 계산됩니다.');
    await expect(body.locator('b')).toHaveCount(0);
    // A chip in an item stays on its word's line.
    await expect(items.nth(0).locator('.cite-tail')).toHaveText('비교합니다41쪽.', { useInnerText: true });
    await expectNoSeriousA11y(page, 'tutor answer in Markdown');
  } finally {
    await app.close();
  }
});

test('a question with an attached passage: the quote in the bubble with its page chip, 선택 1, the list\'s 선택한 구간, and 선택한 구간 확인 over the answer', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    const passage = 'We propose a new simple network architecture.';
    const text1 = await page.evaluate(() => window.__learnPdf!.pageText(0));
    const at = text1.indexOf(passage);
    expect(at, 'page 1 holds the passage').toBeGreaterThanOrEqual(0);
    const anchor = await page.evaluate(async ([s, e]) => {
      await window.__learnPdf!.selectText(0, s!, e!);
      return window.__learnPdf!.anchorOfSelection();
    }, [at, at + passage.length] as const);
    const asked = await ask(page, { itemId, conversationId: null, text: '이 문장은 무슨 뜻인가요?', selection: { anchor: anchor as PdfAnchor & { precision: 'span' }, text: passage }, reader: READER_100 });
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    const question = page.getByTestId('tutor-question');
    await expect(question.locator('.tutor-quote .q')).toHaveText(passage);
    await expect(question.locator('.tutor-quote').getByTestId('cite-chip')).toHaveText('1쪽');
    await expect(question.getByTestId('sent-scope')).toHaveAccessibleName(/^선택\s1\s·\s자료\s1$/);
    await question.getByTestId('sent-scope').click();
    await expect(question.getByTestId('sent-scope-list').locator('dd').first()).toHaveText('질문선택한 구간 · 1쪽');
    await expect(page.getByTestId('tutor-answer').getByTestId('tool-chip').first()).toHaveText('선택한 구간 확인');
    await expectNoSeriousA11y(page, 'tutor question with an attached passage');
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
    // A row above the log, not over it: the log (and its scroll bar) starts below it.
    const sticky = (await page.getByTestId('tutor-sticky').boundingBox())!;
    expect((await log.boundingBox())!.y).toBeGreaterThanOrEqual(sticky.y + sticky.height - 0.5);
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

// ---- The composer (Task 18) ----

const composerInput = (page: Page) => page.getByTestId('tutor-input');
/** The questions the fake agents of this run were asked (one prompt each). */
const prompts = async (app: ElectronApplication): Promise<number> => (await tutorFakeLog(app)).filter((e) => e.t === 'prompt').length;
/** A question typed into the composer and sent with ↩, as a person does. */
async function sendFromComposer(page: Page, text: string): Promise<void> {
  await composerInput(page).click();
  await page.keyboard.insertText(text);
  await expect(composerInput(page)).toHaveValue(text);
  await page.keyboard.press('Enter');
}
/** The answers of the item's sessions, newest session first: their ids as sessions.get reads them. */
async function answersOf(page: Page, itemId: string): Promise<Array<{ conversationId: string; tutorMessageId: string; status: string }>> {
  return page.evaluate(async (id) => {
    const list = await window.learn.sessions.list({ itemId: id });
    if (!list.ok) throw new Error(`sessions.list: ${list.code}`);
    const out: Array<{ conversationId: string; tutorMessageId: string; status: string }> = [];
    for (const s of list.data) {
      const t = await window.learn.sessions.get({ conversationId: s.id });
      if (!t.ok) continue;
      for (const m of t.data.messages) if (m.role === 'tutor') out.push({ conversationId: s.id, tutorMessageId: m.id, status: m.status });
    }
    return out;
  }, itemId);
}
/**
 * The agent button while a status line shows: "Claude Code" whole (its box not clipped, clear of the ▾), the state words stepped aside
 * as a whole but still in the button's name (`accessibleName`), and the foot not overflowing.
 */
async function expectAgentNameWhole(page: Page, accessibleName: string): Promise<void> {
  const button = page.getByTestId('tutor-agent');
  const name = button.locator('.name');
  await expect(name).toHaveText('Claude Code');
  expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), 'the name is clipped').toBe(true);
  const [n, chevron] = [(await name.boundingBox())!, (await button.locator('.lucide-chevron-down').boundingBox())!];
  expect(n.x + n.width, 'the name runs into the ▾').toBeLessThanOrEqual(chevron.x + 0.5);
  expect((await button.locator('.state').boundingBox())!.width, 'the state words are on screen').toBeLessThanOrEqual(1);
  await expect(button).toHaveAccessibleName(accessibleName);
  expect(await page.getByTestId('tutor-composer').locator('.foot').evaluate((el) => el.scrollWidth <= el.clientWidth), 'the foot scrolls').toBe(true);
}

/** A popover that has finished coming in: its geometry is final. */
const popoverSettled = (page: Page, selector: string) =>
  expect.poll(() => page.locator(selector).evaluate((el) => el.getAnimations({ subtree: true }).length + (el.hasAttribute('data-entering') ? 1 : 0))).toBe(0);

test('the composer: ↩ sends and ⇧↩ breaks the line; the question shows at once; while the answer comes the text is read only, 답하는 중… and 중지; one esc stops it from 중지 (its tooltip open) or from the head; 보내기 and 중지 are one stop', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'slow');
    const box = composerInput(page);
    const send = page.getByTestId('tutor-send');
    // At rest: the placeholder, 보내기 off with its reason while there is no text (focusable: its tooltip says why).
    await expect(box).toHaveAttribute('placeholder', '질문을 입력하세요');
    await expect(box).toBeEditable();
    await expect(send).toHaveAccessibleName('보내기');
    await expectDisabledReason(send, '질문을 입력하면 보낼 수 있습니다');
    await hoverLikeUser(page, 'tutor-send');
    await expectTooltipText(page, /^보내기\s*질문을 입력하면 보낼 수 있습니다$/, 'tutor-send');
    await expect(page.getByTestId('tutor-agent')).toHaveText('가짜 에이전트');
    await expectNoSeriousA11y(page, 'tutor composer at rest');
    // ↩ with no text sends nothing; ⇧↩ breaks the line.
    await box.click();
    await page.keyboard.press('Enter');
    await expect(box).toHaveValue('');
    await page.keyboard.insertText('천천히 답해 주세요.');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText('둘째 줄');
    await expect(box).toHaveValue('천천히 답해 주세요.\n둘째 줄');
    await expectDisabledReason(send, null);
    await hoverLikeUser(page, 'tutor-send');
    await expectTooltipText(page, /^보내기\s*(↩|Enter)$/, 'tutor-send');
    expect(await prompts(app)).toBe(0);

    await box.focus();
    await page.keyboard.press('Enter');
    // The question's bubble at once; the composer empty and read only while the answer comes, 중지 in 보내기's place.
    await expect(page.getByTestId('tutor-question').locator('.bubble')).toBeVisible();
    expect(await page.getByTestId('tutor-question').locator('.bubble p').innerText()).toBe('천천히 답해 주세요.\n둘째 줄');
    await expect(box).toHaveValue('');
    await expect(box).toHaveAttribute('placeholder', '답을 받는 중입니다');
    await expect(box).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('tutor-answering')).toHaveText('답하는 중…');
    const stop = page.getByTestId('tutor-stop');
    await expect(stop).toHaveText('중지');
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => prompts(app)).toBe(1);
    await hoverLikeUser(page, 'tutor-stop');
    await expectTooltipText(page, /^중지\s*(esc|Esc)$/, 'tutor-stop');
    await page.mouse.move(400, 400);
    // Nothing can be typed meanwhile (the next question is written once the answer ended: spec 8.4).
    await box.focus();
    await page.keyboard.insertText('더');
    await expect(box).toHaveValue('');
    await expectNoSeriousA11y(page, 'tutor composer while an answer comes');
    // The keyboard on 중지 (text area → agent button → 중지), its tooltip open: one esc stops.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tutor-agent')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(/^중지\s*(esc|Esc)$/);
    await page.keyboard.press('Escape');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'stopped');
    await expect(page.getByTestId('tutor-ended')).toHaveText('중지함');
    await expect(page.getByTestId('tutor-said')).toHaveText('답을 중지했습니다');
    await expect(page.getByTestId('tutor-answering')).toHaveCount(0);
    // 중지 and 보내기 are one stop: the focus is still on it, now 보내기 (off: no text).
    await expect(send).toBeFocused();
    await expect(box).not.toHaveAttribute('readonly');
    await expect(box).toHaveAttribute('placeholder', '질문을 입력하세요');
    expect(await prompts(app)).toBe(1);

    // Space on 보내기 sends, and the focus stays on the button that is now 중지; Space on it stops, and the focus is on 보내기 again.
    await box.click();
    await page.keyboard.insertText('한 번 더 천천히 답해 주세요.');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(send).toBeFocused();
    await page.keyboard.press('Space');
    await expect(answer.last()).toHaveAttribute('data-status', 'streaming');
    await expect(stop).toBeFocused();
    await expect.poll(() => prompts(app)).toBe(2);
    await page.keyboard.press('Space');
    await expect(answer.last()).toHaveAttribute('data-status', 'stopped');
    await expect(send).toBeFocused();

    // esc from the panel's head (새 세션, which stays on while the answer comes) stops too.
    await box.click();
    await page.keyboard.insertText('세 번째로 천천히 답해 주세요.');
    await page.keyboard.press('Enter');
    await expect(answer.last()).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => prompts(app)).toBe(3);
    // And esc held down (its key repeating) stops once: one tutor:stop, not one per repeat.
    await page.getByTestId('tutor-new-session').focus();
    const stopsBefore = (await ipcCalls(app))['tutor:stop'] ?? 0;
    const cdp = await page.context().newCDPSession(page);
    const esc = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...esc });
    for (let i = 0; i < 3; i++) await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...esc, autoRepeat: true });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...esc });
    await expect(answer.last()).toHaveAttribute('data-status', 'stopped');
    await expect(answer).toHaveCount(3);
    expect((await ipcCalls(app))['tutor:stop']).toBe(stopsBefore + 1);
    expect(await prompts(app)).toBe(3);
  } finally {
    await app.close();
  }
});

test('the agent button and its menu: the fake checked, a Claude Code that needs its login listed off with its reason, then 에이전트 고르기…; it opens above the button when there is no room below', async ({}, testInfo) => {
  const dir = testInfo.outputPath('npm');
  const { app, page } = await launch(...dirs(testInfo), { env: { LEARN_E2E_SETTINGS: '', LEARN_AGENT_SEARCH_PATH: installFakeAgents(dir, { ...READY, script: 'login' }) } });
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    await consentAndChoose(page, 'fake');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    const button = page.getByTestId('tutor-agent');
    // The fake: its name, its flask, the warning colour; its tooltip says what it is.
    await expect(button).toHaveText('가짜 에이전트');
    await expect(button.locator('.lucide-flask-conical')).toHaveCount(1);
    await expect(button).toHaveClass(/\bwarn\b/);
    await hoverLikeUser(page, 'tutor-agent');
    await expectTooltipText(page, '가짜 에이전트 · 개발·데모 빌드에서만 보입니다', 'tutor-agent');

    await button.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    // One row for Claude Code, one for the fake, then 에이전트 고르기… after a separator (a positive control: three rows in all).
    await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
    await expect(menu.getByRole('menuitem')).toHaveText(['에이전트 고르기…']);
    await expect(menu.getByRole('separator')).toHaveCount(1);
    const claude = menu.getByTestId('tutor-agent-row').and(page.locator('[data-agent="claude"]'));
    const fake = menu.getByTestId('tutor-agent-row').and(page.locator('[data-agent="fake"]'));
    await expect(claude.locator('.mi-label')).toHaveText('Claude Code — 로그인 필요');
    await expect(claude).toHaveAccessibleName('Claude Code — 로그인 필요');
    await expect(claude).toHaveAttribute('aria-disabled', 'true');
    await expect(claude).toHaveAttribute('aria-checked', 'false');
    await expect(claude).toHaveAccessibleDescription('Learn 전용 설정으로 로그인한 뒤 에이전트 고르기에서 다시 확인하세요');
    await expect(claude.locator('.mi-row')).toHaveAttribute('title', 'Learn 전용 설정으로 로그인한 뒤 에이전트 고르기에서 다시 확인하세요');
    await expect(fake.locator('.mi-label')).toHaveText('가짜 에이전트');
    await expect(fake).toHaveAccessibleName('가짜 에이전트');
    await expect(fake).toHaveAttribute('aria-checked', 'true');
    await expect(fake.locator('.check .lucide-check')).toHaveCount(1);
    await expect(fake.locator('.lucide-flask-conical')).toHaveCount(1);
    await expect(fake.locator('.mi-row')).toHaveAttribute('title', '개발·데모 빌드에서만 보입니다');
    await expect(menu.locator('.mi')).toHaveCount(3);
    // The composer is at the window's bottom: the menu opens above the button, 4 px from it, at its left edge.
    await popoverSettled(page, '.agent-menu');
    const [b, m] = [(await button.boundingBox())!, (await page.locator('.agent-menu').boundingBox())!];
    expect(Math.abs(m.y + m.height + 4 - b.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.x - b.x)).toBeLessThanOrEqual(1);
    await expectNoSeriousA11y(page, 'tutor agent menu');
    // The keyboard moves through the rows that can be chosen and passes over the one that is off: the first row it reaches is the fake,
    // below Claude Code, then 에이전트 고르기….
    await page.keyboard.press('ArrowDown');
    await expect(fake).toHaveAttribute('data-focused', 'true');
    await expect(claude).not.toHaveAttribute('data-focused');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByTestId('tutor-agent-choose')).toHaveAttribute('data-focused', 'true');

    // 에이전트 고르기… is the registry's command: the chooser shows.
    await menu.getByRole('menuitem', { name: '에이전트 고르기…' }).click();
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    await expect(claudeRow(page).getByTestId('agent-flag')).toHaveText('로그인 필요');
  } finally {
    await app.close();
  }
});

test('the agent not known as ready does not hold the send back: ↩ checks it again first (one check: a second ↩ meanwhile does nothing), then asks; the menu switches agents through main', async ({}, testInfo) => {
  const dir = testInfo.outputPath('npm');
  const install = (l: Layout) => {
    fs.rmSync(dir, { recursive: true, force: true });
    return installFakeAgents(dir, l);
  };
  const { app, page } = await launch(...dirs(testInfo), { env: { LEARN_E2E_SETTINGS: '', LEARN_AGENT_SEARCH_PATH: install(READY) } });
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await openPaper(page);
    await consentAndChoose(page, 'claude');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    const button = page.getByTestId('tutor-agent');
    await expect(button).toHaveText('Claude Code');
    await expect(button).not.toHaveClass(/\bwarn\b/);
    await hoverLikeUser(page, 'tutor-agent');
    await expectTooltipText(page, '에이전트: Claude Code · 준비됨 — 누르면 에이전트를 바꿉니다', 'tutor-agent');
    // The menu: Claude Code checked, the fake below it. Choosing the fake goes through main (tutor:chooseAgent), not prefs:set.
    await button.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio', { name: 'Claude Code' })).toHaveAttribute('aria-checked', 'true');
    await expect(menu.getByRole('menuitemradio', { name: 'Claude Code' })).not.toHaveAttribute('aria-disabled', 'true');
    const before = await ipcCalls(app);
    await menu.getByRole('menuitemradio', { name: '가짜 에이전트' }).click();
    await expect(button).toHaveText('가짜 에이전트');
    const after = await ipcCalls(app);
    expect(after['tutor:chooseAgent']).toBe((before['tutor:chooseAgent'] ?? 0) + 1);
    expect(after['prefs:set'] ?? 0).toBe(before['prefs:set'] ?? 0);
    await expect(page.getByTestId('tutor-fake-band')).toBeVisible();
    await button.click();
    await page.getByRole('menu').getByRole('menuitemradio', { name: 'Claude Code' }).click();
    await expect(button).toHaveText('Claude Code');
    await expect(page.getByTestId('tutor-fake-band')).toHaveCount(0);

    // The login lapses: a question fails on it, and the button says so (the window reads the agents again after that failure).
    install({ ...READY, script: 'login' });
    await sendFromComposer(page, '첫 질문입니다.');
    await expect(button).toHaveText('Claude Code · 로그인 필요');
    await expect(button).toHaveClass(/\bwarn\b/);
    await expect(button.locator('.lucide-log-in')).toHaveCount(1);
    // (A question that fails before any answer leaves no session: the tab is on a new empty session again.)
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    // The question is back in the composer (spec 8.8), and 보내기 is on: it can go again as it is, or rewritten.
    await expect(composerInput(page)).toHaveValue('첫 질문입니다.');
    await expectDisabledReason(page.getByTestId('tutor-send'), null);
    await composerInput(page).fill('다시 묻습니다.');
    await expectDisabledReason(page.getByTestId('tutor-send'), null);

    // Logged in, in a terminal: ↩ checks Claude Code again (the window's one check), then sends; a second ↩ meanwhile does nothing.
    // The check is slow here (its version answers after 1.5 s): past 300 ms the composer says so, as the chooser does, and 보내기 is off
    // with that reason.
    install(READY);
    fs.writeFileSync(path.join(dir, 'bin', 'claude'), `#!/bin/sh\n/bin/sleep 1.5\necho "${READY.cli} (Claude Code)"\n`, { mode: 0o755 });
    const agentsBefore = (await ipcCalls(app))['tutor:agents'] ?? 0;
    const asksBefore = (await ipcCalls(app))['tutor:ask'] ?? 0;
    // At the narrowest tutor (320), where the line and the button share the least room.
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1000, w.getContentSize()[1]!));
    await expect.poll(() => page.getByTestId('inspector-panel').evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(320);
    await composerInput(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const checking = page.getByTestId('tutor-checking');
    await expect(checking).toHaveText('에이전트를 찾는 중…');
    await expect(checking.locator('.spinner')).toHaveCount(1);
    await expectDisabledReason(page.getByTestId('tutor-send'), '에이전트를 찾는 중입니다');
    await expect(composerInput(page)).toHaveAttribute('readonly', '');
    // The button keeps "Claude Code" whole: its state words step aside as a whole (still its name), and the narrow composer drops the
    // flag; nothing leaves the foot.
    await expectAgentNameWhole(page, 'Claude Code · 로그인 필요');
    await expect(button.locator('.flag')).toBeHidden();
    await expectNoSeriousA11y(page, 'tutor composer while the agent is checked again');
    await expect(page.getByTestId('tutor-question').locator('.bubble')).toHaveText('다시 묻습니다.');
    await expect(checking).toHaveCount(0);
    await expect(button).toHaveText('Claude Code');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', /^(streaming|complete)$/);
    expect((await ipcCalls(app))['tutor:agents']).toBe(agentsBefore + 1);
    expect((await ipcCalls(app))['tutor:ask']).toBe(asksBefore + 1);
    await expect(page.getByTestId('tutor-question')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('the foot never overflows: while an answer comes, the agent button\'s longest not-ready state steps aside whole and "Claude Code" stays whole, at tutor widths 380 and 320, and 중지 stays in the composer', async ({}, testInfo) => {
  const dir = testInfo.outputPath('npm');
  // Claude Code's fake logs where tutorFakeLog reads (the isolated environment drops the fake's own variables).
  const log = path.join(dirs(testInfo)[1], 'fake-agent.log');
  const install = (l: Layout) => {
    fs.rmSync(dir, { recursive: true, force: true });
    return installFakeAgents(dir, { ...l, log });
  };
  // Claude Code answers and never ends until it is stopped.
  const { app, page } = await launch(...dirs(testInfo), { env: { LEARN_E2E_SETTINGS: '', LEARN_AGENT_SEARCH_PATH: install({ ...READY, script: 'hang' }) } });
  try {
    const window = await mainWindow(app);
    await window.evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    const [paper] = await importPaths(page, [PAPER]);
    await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await consentAndChoose(page, 'claude');
    await sendFromComposer(page, '오래 걸리는 질문입니다.');
    await expect(page.getByTestId('tutor-answering')).toBeVisible();
    await expect.poll(() => prompts(app)).toBe(1);
    // Meanwhile another tab's chooser finds Claude Code too old: the window's one report says so, and so does this tab's button.
    install({ cli: '2.1.300', adapter: '0.103.0' });
    await backFromReader(page);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await runPalette(page, app, '에이전트', 'tutor.chooseAgent');
    await page.getByTestId('agent-research').click();
    await expect(flagOf(page)).toHaveText('지원하지 않는 버전');
    await readerTab(page, paper!.id).click();
    const button = page.getByTestId('tutor-agent');
    await expect(button).toHaveText('Claude Code · 지원하지 않는 버전');
    await expect(page.getByTestId('tutor-answering')).toBeVisible();
    const stop = page.getByTestId('tutor-stop');
    for (const [width, tutor] of [[1440, 380], [1000, 320]] as const) {
      await window.evaluate((w, x) => w.setContentSize(x, w.getContentSize()[1]!), width);
      await expect.poll(() => page.getByTestId('inspector-panel').evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBe(tutor);
      const foot = page.getByTestId('tutor-composer').locator('.foot');
      expect(await foot.evaluate((el) => el.scrollWidth <= el.clientWidth), `the foot at ${tutor} scrolls`).toBe(true);
      const [c, b] = [(await page.getByTestId('tutor-composer').boundingBox())!, (await stop.boundingBox())!];
      expect(b.x + b.width, `중지 at ${tutor} is in the composer`).toBeLessThanOrEqual(c.x + c.width);
      await expect(page.getByTestId('tutor-answering')).toBeVisible();
      // The name stays whole; the state steps aside as a whole (the tooltip has it all); the flag goes only below about 300 of composer.
      await expectAgentNameWhole(page, 'Claude Code · 지원하지 않는 버전');
      if (tutor === 380) await expect(button.locator('.flag')).toBeVisible();
      else await expect(button.locator('.flag')).toBeHidden();
    }
    await hoverLikeUser(page, 'tutor-agent');
    await expectTooltipText(page, '에이전트: Claude Code · 지원하지 않는 버전 — 누르면 에이전트를 바꿉니다', 'tutor-agent');
    await stop.click();
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'stopped');
  } finally {
    await app.close();
  }
});

test('a draft stays with its tab and session while the app runs: across modes and tabs, each tab its own', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    const box = composerInput(page);
    await box.click();
    await page.keyboard.insertText('쓰다 만 질문');
    // 정보 and back: the same draft.
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('tutor-panel')).toHaveCount(0);
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect(box).toHaveValue('쓰다 만 질문');
    // Another tab has its own; back here, this one's.
    await backFromReader(page);
    const [sample] = await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(box).toHaveValue('');
    await box.click();
    await page.keyboard.insertText('다른 자료의 질문');
    await readerTab(page, itemId).click();
    await expect(page.getByTestId('tutor-empty').locator('.pe-title')).toHaveText('paper-100');
    await expect(box).toHaveValue('쓰다 만 질문');
    await readerTab(page, sample!.id).click();
    await expect(page.getByTestId('tutor-empty').locator('.pe-title')).toHaveText('sample');
    await expect(box).toHaveValue('다른 자료의 질문');
    expect(await prompts(app)).toBe(0);
  } finally {
    await app.close();
  }
});

test('while the item opens the composer is off: its text area and agent button, and 보내기 says why; once it is open it is on', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    // A real opening, recorded: every state the composer of the newly opened tab is drawn in before its PDF is ready.
    await backFromReader(page);
    await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __composer: string[] }).__composer = seen;
      const look = () => {
        const box = document.querySelector<HTMLTextAreaElement>('[data-testid="tutor-input"]');
        const title = document.querySelector('[data-testid="tutor-empty"] .pe-title')?.textContent;
        if (!box || title !== 'sample') return;
        const ready = (window as unknown as { __learnReader: { getState(): { pdf: { ready: boolean } | null } } }).__learnReader.getState().pdf?.ready === true;
        const v = `${ready ? 'ready' : 'opening'}:${box.disabled ? 'off' : 'on'}:${box.placeholder}`;
        if (!seen.includes(v)) seen.push(v);
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(composerInput(page)).toBeEnabled();
    const seen = await page.evaluate(() => (window as unknown as { __composer: string[] }).__composer);
    expect(seen, 'the opening state was drawn').toContain('opening:off:자료를 여는 중입니다');
    expect(seen.filter((v) => v.startsWith('opening:on'))).toEqual([]);
    expect(seen).toContain('ready:on:질문을 입력하세요');

    // Held in the opening state (the reader's own flag), to read what it says.
    await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { setPdf(p: { ready: boolean }): void } } }).__learnReader.getState().setPdf({ ready: false }));
    const box = composerInput(page);
    await expect(box).toBeDisabled();
    await expect(box).toHaveAttribute('placeholder', '자료를 여는 중입니다');
    await expect(page.getByTestId('tutor-agent')).toBeDisabled();
    await expectDisabledReason(page.getByTestId('tutor-send'), '자료를 여는 중입니다');
    await hoverLikeUser(page, 'tutor-send');
    await expectTooltipText(page, /^보내기\s*자료를 여는 중입니다$/, 'tutor-send');
    // F6 into the panel lands past the text area while it is off: on the head's selected tab, as before there was a composer.
    await f6IntoPanel(page);
    await expect(page.getByRole('tab', { name: '튜터' })).toBeFocused();
    await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { setPdf(p: { ready: boolean }): void } } }).__learnReader.getState().setPdf({ ready: true }));
    await expect(box).toBeEnabled();
    await expect(box).toHaveAttribute('placeholder', '질문을 입력하세요');
    await expect(page.getByTestId('tutor-agent')).toBeEnabled();
  } finally {
    await app.close();
  }
});

test('one agent process: a question in a new session while another session\'s answer comes waits above the composer and is sent once that answer ends; 보내지 않기 makes it a draft again', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'slow');
    await tutorProcesses(app, { resetMax: true });
    await sendFromComposer(page, '천천히 답해 주세요.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    // The agent has the question (its rows were written before it started): from here it is answering.
    await expect.poll(() => prompts(app)).toBe(1);
    const [first] = await answersOf(page, itemId);
    // The next agent start answers at once; the slow one keeps answering.
    await tutorFakeScript(app, 'answer');
    await page.getByTestId('tutor-new-session').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    expect((await tutorProcesses(app)).count).toBe(1);
    expect(await prompts(app)).toBe(1);

    await sendFromComposer(page, '다음 질문입니다.');
    const waitLine = page.getByTestId('tutor-waiting');
    await expect(waitLine).toBeVisible();
    await expect(waitLine.getByRole('status')).toHaveText('다른 세션의 답이 끝나면 보냅니다', { useInnerText: true });
    await expect(waitLine.getByRole('button', { name: '보내지 않기' })).toBeVisible();
    const box = composerInput(page);
    await expect(box).toHaveValue('다음 질문입니다.');
    await expect(box).toHaveAttribute('readonly', '');
    await expectDisabledReason(page.getByTestId('tutor-send'), '다른 세션의 답이 끝나면 보냅니다');
    await hoverLikeUser(page, 'tutor-send');
    await expectTooltipText(page, /^보내기\s*다른.세션의 답이 끝나면 보냅니다$/, 'tutor-send');
    // Above the composer.
    const [w, c] = [(await waitLine.boundingBox())!, (await page.getByTestId('tutor-composer').boundingBox())!];
    expect(w.y + w.height).toBeLessThanOrEqual(c.y);
    await expectNoSeriousA11y(page, 'tutor waiting line');
    expect(await prompts(app)).toBe(1);
    await expect(page.getByTestId('tutor-empty')).toBeVisible(); // no session was made for it

    // The other answer ends: the question goes, once.
    await turnEnded(page, first!.conversationId, first!.tutorMessageId, { timeout: 30_000 });
    await expect(page.getByTestId('tutor-question').locator('.bubble')).toHaveText('다음 질문입니다.');
    await expect(waitLine).toHaveCount(0);
    await expect(box).toHaveValue('');
    await expect.poll(() => prompts(app)).toBe(2);
    const second = (await answersOf(page, itemId)).find((a) => a.conversationId !== first!.conversationId)!;
    await turnEnded(page, second.conversationId, second.tutorMessageId);
    expect(await prompts(app)).toBe(2);
    expect((await tutorProcesses(app)).max).toBe(1);
  } finally {
    await app.close();
  }
});

test('답 중지 from the palette while the tutor is not on screen: 정보 shown, the answer still comes, and the palette stops it; ended, it is off', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'slow');
    await sendFromComposer(page, '천천히 답해 주세요.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => prompts(app)).toBe(1);
    const [first] = await answersOf(page, itemId);
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('tutor-panel')).toHaveCount(0);
    await runPalette(page, app, '답 중지', 'tutor.stop');
    expect((await turnEnded(page, first!.conversationId, first!.tutorMessageId)).status).toBe('stopped');
    // The window saw the end though the tutor was not on screen: the palette offers 튜터 보기 (the control) and no 답 중지.
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('튜터');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="view.inspectorTutor"]')).toBeVisible();
    await expect(page.locator('[data-testid="palette-item"][data-command-id="tutor.stop"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('보내지 않기: the question that waited is a draft to edit again, and nothing is sent when the other answer ends', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'slow');
    await sendFromComposer(page, '천천히 답해 주세요.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => prompts(app)).toBe(1);
    const [first] = await answersOf(page, itemId);
    await tutorFakeScript(app, 'answer');
    await page.getByTestId('tutor-new-session').click();
    await sendFromComposer(page, '다음 질문입니다.');
    await expect(page.getByTestId('tutor-waiting')).toBeVisible();
    await page.getByTestId('tutor-dont-send').click();
    await expect(page.getByTestId('tutor-waiting')).toHaveCount(0);
    const box = composerInput(page);
    await expect(box).toBeFocused();
    await expect(box).not.toHaveAttribute('readonly');
    await page.keyboard.insertText(' 고쳐 씁니다.');
    await expect(box).toHaveValue('다음 질문입니다. 고쳐 씁니다.');
    await turnEnded(page, first!.conversationId, first!.tutorMessageId, { timeout: 30_000 });
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    expect(await prompts(app)).toBe(1);
    await expect(box).toHaveValue('다음 질문입니다. 고쳐 씁니다.');
    // The control: ↩ now sends it.
    await box.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question').locator('.bubble')).toHaveText('다음 질문입니다. 고쳐 씁니다.');
    await expect.poll(() => prompts(app)).toBe(2);
  } finally {
    await app.close();
  }
});

test('F6 into the tutor\'s panel and ⌃⌘2 land in the composer\'s text area, on an empty session and in a conversation', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    const box = composerInput(page);
    await f6IntoPanel(page);
    await expect(box).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect(box).toBeFocused();
    await sendFromComposer(page, '이 장은 무엇을 다루나요?');
    await expect(page.getByTestId('tutor-question')).toBeVisible();
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await f6IntoPanel(page);
    await expect(box).toBeFocused();
    await runMenuCommand(app, 'view.inspectorInfo');
    await expect(page.getByTestId('tutor-panel')).toHaveCount(0);
    await runMenuCommand(app, 'view.inspectorTutor');
    await expect(box).toBeFocused();
    // In the panel the Tab order goes 새 세션 → the conversation → … → the text area → the agent button → 보내기/중지.
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tutor-agent')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tutor-send')).toBeFocused();
    await page.getByTestId('tutor-new-session').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tutor-log')).toBeFocused();
  } finally {
    await app.close();
  }
});

// ---- The passage attached to a question, its page mark, and the outline a question carries (spec 5.1, 8.4) ----

const attachedChip = (page: Page) => page.getByTestId('tutor-attached');
/** The page mark of the attached passage on page `n` (1-based). */
const pageMark = (page: Page, n: number) => page.locator(`.pdfViewer .page[data-page-number="${n}"] [data-testid="pdf-attached"]`);
/** A selection in the reader's text layer as a person leaves one: the focus out of any field first (a field keeps what was selected before). */
async function selectInPage(page: Page, pageIndex: number, start: number, end: number): Promise<void> {
  await page.evaluate(async ([i, s, e]) => {
    (document.activeElement as HTMLElement | null)?.blur();
    await window.__learnPdf!.selectText(i!, s!, e!);
  }, [pageIndex, start, end] as const);
}
type Box = { left: number; top: number; right: number; bottom: number };
/** The union of the boxes of `selector` (client px), and of the live selection's text in the page (client px). */
const boxesOf = (page: Page, selector: string): Promise<Box | null> =>
  page.evaluate((sel) => {
    const rs = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (rs.length === 0) return null;
    return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  }, selector);
const selectionBox = (page: Page): Promise<Box | null> =>
  page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rs: DOMRect[] = [];
    for (const span of document.querySelectorAll('.textLayer span:not(.markedContent)')) {
      const node = span.firstChild;
      if (!node || !range.intersectsNode(node)) continue;
      const piece = document.createRange();
      piece.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) piece.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) piece.setEnd(range.endContainer, range.endOffset);
      rs.push(...[...piece.getClientRects()].filter((r) => r.width >= 0.5 && r.height >= 0.5));
    }
    if (rs.length === 0) return null;
    return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  });
/** The box (client px) of the text layer's span on page `n` that holds exactly `text`: a line drawn as one text item. */
const spanBox = (page: Page, n: number, text: string): Promise<Box | null> =>
  page.evaluate(([n, text]) => {
    const span = [...document.querySelectorAll(`.page[data-page-number="${n}"] .textLayer span:not(.markedContent)`)].find((el) => el.textContent === text);
    const r = span?.getBoundingClientRect();
    return r && r.width > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  }, [n, text] as const);
/**
 * The page mark's wash covers the passage — one line of page `n`, drawn as one span — within the anchor spike's 2 pt (at the zoom of the
 * moment), and its bar stands in the margin left of it, as tall as it.
 */
async function expectMarkOn(page: Page, n: number, passage: string, what: string): Promise<void> {
  const sel = `.pdfViewer .page[data-page-number="${n}"] [data-testid="pdf-attached"]`;
  const twoPoints = 2 * (96 / 72) * Number(await page.getByTestId('pdf-viewer').getAttribute('data-scale'));
  // Both read again until they agree: pdf.js hides a text layer while it lays it out again at a new scale.
  await expect.poll(async () => {
    const [got, want] = [await boxesOf(page, `${sel} .attached`), await spanBox(page, n, passage)];
    return got && want ? Math.max(Math.abs(got.left - want.left), Math.abs(got.top - want.top), Math.abs(got.right - want.right), Math.abs(got.bottom - want.bottom)) : `wash ${JSON.stringify(got)}, selection ${JSON.stringify(want)}`;
  }, { message: `the wash covers the passage (${what})` }).toBeLessThanOrEqual(twoPoints);
  const wash = (await boxesOf(page, `${sel} .attached`))!;
  const bar = (await boxesOf(page, `${sel} .attach-bar`))!;
  const rotated = (await page.getByTestId('pdf-viewer').getAttribute('data-rotation')) === '90';
  if (rotated) {
    // A quarter turn clockwise: the page's left margin is above the text.
    expect(bar.bottom, `the bar is above the text (${what})`).toBeLessThan(wash.top);
    expect(Math.abs(bar.left - wash.left), `the bar spans the text (${what})`).toBeLessThanOrEqual(1.5);
  } else {
    expect(bar.right, `the bar is left of the text (${what})`).toBeLessThan(wash.left);
    expect(Math.abs(bar.top - wash.top) + Math.abs(bar.bottom - wash.bottom), `the bar is as tall as the text (${what})`).toBeLessThanOrEqual(1.5);
  }
}

/**
 * The tooltip that shows stands 6 px above the chip (design-spec 6; the mockup anchors it on the whole chip): the chip's own centred on
 * it, ×'s ending at its right edge, over the × it names.
 */
async function expectTooltipOverChip(page: Page, align: 'centre' | 'end' = 'centre'): Promise<void> {
  const [tip, chip] = [(await page.getByRole('tooltip').boundingBox())!, (await attachedChip(page).boundingBox())!];
  expect(Math.abs(chip.y - (tip.y + tip.height) - 6), 'the tooltip is 6 above the chip').toBeLessThanOrEqual(1);
  if (align === 'centre') expect(Math.abs(chip.x + chip.width / 2 - (tip.x + tip.width / 2)), 'the tooltip is centred on the chip').toBeLessThanOrEqual(1);
  else expect(Math.abs(chip.x + chip.width - (tip.x + tip.width)), 'the tooltip ends at the chip\'s right edge, over ×').toBeLessThanOrEqual(2);
}

test('a selection in the reader attaches itself to the next question: one chip of its page, its tooltip and ×, marked on the page through a zoom and a turn; it stays when the page\'s selection goes, × takes it off, and the question carries it', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    const passage = 'We propose a new simple network architecture.';
    const at = (await page.evaluate(() => window.__learnPdf!.pageText(0))).indexOf(passage);
    expect(at, 'page 1 holds the passage').toBeGreaterThanOrEqual(0);
    await expect(attachedChip(page)).toHaveCount(0);
    await selectInPage(page, 0, at, at + passage.length);
    const chip = attachedChip(page);
    await expect(chip.getByTestId('tutor-attached-label')).toHaveText(`1쪽 · ${passage}`);
    await expect(chip).not.toHaveAttribute('data-multipage');
    await expect(chip).not.toHaveAttribute('data-long');
    // Marked on its page: one line's wash and the bar in the margin left of it.
    await expect(pageMark(page, 1).locator('.attached')).toHaveCount(1);
    await expect(pageMark(page, 1).locator('.attach-bar')).toHaveCount(1);
    await expectMarkOn(page, 1, passage, '100 %');
    // The tooltip says it goes with the question; × says what it takes off.
    await hoverOver(page, chip.getByTestId('tutor-attached-label'));
    await expectTooltipText(page, '질문에 붙은 구간 · 1쪽 — 질문과 함께 보냅니다', 'tutor-attached-label');
    await expectTooltipOverChip(page);
    const remove = chip.getByTestId('tutor-attached-remove');
    // Drawn 16 square, pressed 28 square (spec 8.11): a point 5 px past its drawn edges, either side, is still the ×.
    const x = (await remove.boundingBox())!;
    expect([Math.round(x.width), Math.round(x.height)]).toEqual([16, 16]);
    for (const [px, py] of [[x.x + x.width + 5, x.y + x.height / 2], [x.x + x.width / 2, x.y - 5], [x.x + x.width / 2, x.y + x.height + 5]] as const) {
      expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest('[data-testid="tutor-attached-remove"]') != null, [px, py] as const), `the × at ${px}, ${py}`).toBe(true);
    }
    await expect(remove).toHaveAccessibleName('구간 떼기');
    await expect(remove).toHaveAccessibleDescription('질문에 붙은 구간 · 1쪽 — 질문과 함께 보냅니다');
    await hoverOver(page, remove);
    await expectTooltipText(page, '구간 떼기', 'tutor-attached-remove');
    await expectTooltipOverChip(page, 'end');
    await expectNoSeriousA11y(page, 'tutor composer with an attached passage');

    // The page's selection goes (the reader lets go of it once 300 ms pass, as of a keyboard selection): the chip and its mark stay.
    expect(await page.evaluate(() => window.__learnSelection!.hasRange()), 'the reader holds the selection').toBe(true);
    await page.evaluate(() => window.getSelection()!.removeAllRanges());
    await expect.poll(() => page.evaluate(() => window.__learnSelection!.hasRange())).toBe(false);
    await expect(chip).toBeVisible();
    await expect(pageMark(page, 1).locator('.attached')).toHaveCount(1);

    // A zoom and a quarter turn draw the page again: the mark is drawn again for it — already as the page's redraw begins (pdf.js
    // empties the page of all but its canvas and text before it draws), not only once the page is drawn.
    await page.evaluate(() => {
      const w = window as unknown as { __marked: boolean[]; __learnReader: { getState(): { handle: { eventBus(): { on(name: string, fn: (e: { pageNumber: number }) => void): void } } } } };
      w.__marked = [];
      w.__learnReader.getState().handle.eventBus().on('pagerender', (e) => {
        if (e.pageNumber === 1) w.__marked.push(document.querySelector('.page[data-page-number="1"] > [data-testid="pdf-attached"]') !== null);
      });
    });
    await setPdfZoom(page, 2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __marked: boolean[] }).__marked.length), { message: 'page 1 was drawn again' }).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { __marked: boolean[] }).__marked), 'the mark is on the page as its redraw begins').not.toContain(false);
    await expect.poll(() => page.getByTestId('pdf-viewer').getAttribute('data-scale').then(Number)).toBeCloseTo(2, 5);
    await expectMarkOn(page, 1, passage, '200 %');
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rotation', '90');
    await expectMarkOn(page, 1, passage, '200 %, a quarter turn');
    await runMenuCommand(app, 'reader.rotateCcw');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rotation', '0');
    await setPdfZoom(page, 'auto');

    // × is the chip's Tab stop, just before the text area; it takes the chip and its mark off, and the focus goes to the text area.
    await composerInput(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(chip).toHaveCount(0);
    await expect(page.locator('[data-testid="pdf-attached"]')).toHaveCount(0);
    await expect(composerInput(page)).toBeFocused();

    // Selected again, and asked with ↩: the question carries it — the prompt's attached block, the quote and its page in the bubble,
    // 선택한 구간 확인 over the answer — and the chip and its mark go with it.
    await selectInPage(page, 0, at, at + passage.length);
    await expect(chip).toBeVisible();
    await sendFromComposer(page, '이 문장은 무슨 뜻인가요?');
    const question = page.getByTestId('tutor-question');
    await expect(question.locator('.tutor-quote .q')).toHaveText(passage);
    await expect(question.locator('.tutor-quote').getByTestId('cite-chip')).toHaveText('1쪽');
    await expect(chip).toHaveCount(0);
    await expect(page.locator('[data-testid="pdf-attached"]')).toHaveCount(0);
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    // A new session's first question: its answer was drawn as it came (the mark of its first text, made only for a live answer).
    expect(await page.evaluate(() => performance.getEntriesByName('learn:tutor:first-text-paint').length), 'the answer was drawn as it came').toBeGreaterThan(0);
    await expect(page.getByTestId('tutor-answer').getByTestId('tool-chip').first()).toHaveText('선택한 구간 확인');
    await expect(question.getByTestId('sent-scope')).toHaveAccessibleName(/^선택\s1\s·\s자료\s1$/);
    const said = (await tutorFakeLog(app)).filter((e) => e.t === 'prompt').at(-1)!.blocks.map((b) => b.text).join('\n');
    expect(said).toContain('The user attached this passage from page 1. To cite page 1, read it with read_pdf_pages first:');
    expect(said).toContain(passage);
    await expectNoSeriousA11y(page, 'tutor question sent with an attached passage');
  } finally {
    await app.close();
  }
});

test('a selection across two pages attaches the first page\'s text only, and one over 4,000 characters its first 4,000: the chip\'s tooltip says so on its second line, and that is what goes', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    const [text1, text2] = await page.evaluate(async () => [await window.__learnPdf!.pageText(0), await window.__learnPdf!.pageText(1)]);
    const from = text1.indexOf('We propose a new simple network architecture.');
    // From page 1's passage to a few characters into page 2: page 2's text layer drawn first, then the selection made across both.
    await selectInPage(page, 1, 0, 10);
    await selectInPage(page, 0, from, from + 5);
    await page.evaluate(() => {
      const sel = window.getSelection()!;
      const range = sel.getRangeAt(0).cloneRange();
      const into = document.querySelector('.page[data-page-number="2"] .textLayer span:not(.markedContent)')!.firstChild!;
      range.setEnd(into, 5);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    const chip = attachedChip(page);
    await expect(chip).toHaveAttribute('data-multipage', '');
    await expect(chip.getByTestId('tutor-attached-label')).toContainText('1쪽 · We propose a new simple network architecture.');
    await hoverOver(page, chip.getByTestId('tutor-attached-label'));
    await expectTooltipText(page, '질문에 붙은 구간 · 1쪽 — 질문과 함께 보냅니다여러 쪽에 걸친 선택은 첫 쪽의 글만 붙습니다.', 'tutor-attached-label');
    await expect(page.getByRole('tooltip').locator('.tooltip-note')).toHaveText('여러 쪽에 걸친 선택은 첫 쪽의 글만 붙습니다.');
    await expect(pageMark(page, 1).locator('.attached')).not.toHaveCount(0);
    await expect(pageMark(page, 2)).toHaveCount(0);
    await sendFromComposer(page, '이 부분은 무엇을 말하나요?');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    const [first] = await answersOf(page, itemId);
    const thread = await page.evaluate((id) => window.learn.sessions.get({ conversationId: id }), first!.conversationId);
    if (!thread.ok) throw new Error(`sessions.get: ${thread.code}`);
    const sent = thread.data.messages.find((m) => m.role === 'user')!.attached!;
    expect(sent.pageIndex).toBe(0);
    expect(sent.quote!.startsWith('We propose a new simple network architecture.')).toBe(true);
    // The words as they go: white space folded to single spaces, a line ending with a hyphen joined to the next.
    const fold = (t: string) => t.replace(/(\S-)[ \t]*\n\s*(?=\S)/g, '$1').replace(/\s+/g, ' ').trim();
    expect(fold(text1).endsWith(sent.quote!.slice(-40)), 'it runs to the end of page 1').toBe(true);
    expect(sent.quote).not.toContain(text2.slice(0, 24));

    // All of page 2, longer than 4,000 characters: the first 4,000 go, and the tooltip says that.
    expect(text2.length, 'page 2 is longer than 4,000 characters').toBeGreaterThan(4000);
    await selectInPage(page, 1, 0, text2.length);
    await expect(chip).toHaveAttribute('data-long', '');
    await expect(chip).toHaveAttribute('data-page', '2');
    await expect(chip).not.toHaveAttribute('data-multipage');
    // Page 2 opens with "transduc-" at a line's end: the chip reads "transduc-tion", as the quote and the agent will.
    expect(text2).toContain('transduc-\ntion');
    await expect(chip.getByTestId('tutor-attached-label')).toContainText('The dominant sequence transduc-tion models');
    await hoverOver(page, chip.getByTestId('tutor-attached-label'));
    await expect(page.getByRole('tooltip').locator('.tooltip-note')).toHaveText('앞 4,000자만 보냅니다.');
    await expect(chip.getByTestId('tutor-attached-remove')).toHaveAccessibleDescription('질문에 붙은 구간 · 2쪽 — 질문과 함께 보냅니다 앞 4,000자만 보냅니다.');
    // The mark covers what goes: not the last lines of the page.
    const markBottom = (await boxesOf(page, '.pdfViewer .page[data-page-number="2"] [data-testid="pdf-attached"] .attached'))!.bottom;
    expect(markBottom).toBeLessThan((await selectionBox(page))!.bottom - 5);
    // From the keyboard, × shows the same second line under its name.
    await page.mouse.move(5, 5);
    await composerInput(page).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(chip.getByTestId('tutor-attached-remove')).toBeFocused();
    await expectTooltipText(page, '구간 떼기앞 4,000자만 보냅니다.', 'tutor-attached-remove');
    await expectTooltipOverChip(page, 'end');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await sendFromComposer(page, '이 쪽을 요약해 주세요.');
    await expect(page.getByTestId('tutor-question')).toHaveCount(2);
    await expect(page.getByTestId('tutor-answer').last()).toHaveAttribute('data-status', 'complete');
    const again = await page.evaluate((id) => window.learn.sessions.get({ conversationId: id }), first!.conversationId);
    if (!again.ok) throw new Error(`sessions.get: ${again.code}`);
    const long = again.data.messages.filter((m) => m.role === 'user').at(-1)!.attached!;
    expect(long.pageIndex).toBe(1);
    expect(long.quote).toBe(fold(text2).slice(0, 4000).normalize('NFC'));
    expect(long.quote).toContain('transduc-tion');
  } finally {
    await app.close();
  }
});

test('the chip is held with the question that waits for another session\'s answer: read only like its text, × off; 보내지 않기 gives it back, and the question carries it', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    await tutorFakeScript(app, 'slow');
    await sendFromComposer(page, '천천히 답해 주세요.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    await expect.poll(() => prompts(app)).toBe(1);
    const [first] = await answersOf(page, itemId);
    await tutorFakeScript(app, 'answer');
    await page.getByTestId('tutor-new-session').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    const passage = 'We propose a new simple network architecture.';
    const at = (await page.evaluate(() => window.__learnPdf!.pageText(0))).indexOf(passage);
    await selectInPage(page, 0, at, at + passage.length);
    const chip = attachedChip(page);
    const remove = chip.getByTestId('tutor-attached-remove');
    await expect(chip).toBeVisible();
    await expect(remove).toBeEnabled();
    await sendFromComposer(page, '다음 질문입니다.');
    await expect(page.getByTestId('tutor-waiting')).toBeVisible();
    // Held with the question: the text area's read only look, × off — a press takes nothing off.
    await expect(chip).toHaveAttribute('data-held', '');
    await expect(remove).toBeDisabled();
    await remove.click({ force: true });
    await expect(chip).toBeVisible();
    expect(await chip.evaluate((el) => getComputedStyle(el).color)).toBe(await composerInput(page).evaluate((el) => getComputedStyle(el).color));
    await expectNoSeriousA11y(page, 'tutor composer holding its chip with the waiting question');
    // 보내지 않기: the question is a draft again, and the chip is the reader's again.
    await page.getByTestId('tutor-dont-send').click();
    await expect(chip).not.toHaveAttribute('data-held');
    await expect(remove).toBeEnabled();
    await expect(page.getByTestId('tutor-waiting')).toHaveCount(0);
    // Once the other answer has ended, ↩ sends the question with its chip.
    await turnEnded(page, first!.conversationId, first!.tutorMessageId, { timeout: 30_000 });
    await composerInput(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question').locator('.tutor-quote .q')).toHaveText(passage);
    await expect(chip).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/** The text spans of page `n`, in reading order: their words, where they start in the page text, their boxes (client px). */
const spansOf = (page: Page, n: number) =>
  page.evaluate(async (n) => {
    const text = await window.__learnPdf!.pageText(n - 1);
    let cursor = 0;
    return [...document.querySelectorAll(`.page[data-page-number="${n}"] .textLayer span:not(.markedContent)`)].map((el) => {
      const words = el.textContent ?? '';
      const at = text.indexOf(words, cursor);
      cursor = at + words.length;
      const r = el.getBoundingClientRect();
      return { words, at, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });
  }, n);
/** The page mark's boxes on page `n` (client px). */
const markBoxes = (page: Page, n: number, what: 'attached' | 'attach-bar') =>
  page.locator(`.pdfViewer .page[data-page-number="${n}"] [data-testid="pdf-attached"] .${what}`).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );

test('the page mark stands a bar beside each run of attached lines: one left of each column a passage crosses, none beside lines that do not go', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    // Page 2 (drawn ahead with page 1; a page further on, drawn only once the probe scrolls to it, can stay paused in pdf.js's render
    // queue on a loaded machine): from the middle of column 1's third line from its foot into column 2's second line.
    await selectInPage(page, 1, 0, 5);
    const spans = await spansOf(page, 2);
    const mid = (Math.min(...spans.map((x) => x.left)) + Math.max(...spans.map((x) => x.right))) / 2;
    const body = spans.slice(1).filter((x) => !x.words.includes('Footnote'));
    const [col1, col2] = [body.filter((x) => x.left < mid), body.filter((x) => x.left >= mid)];
    expect(col1.length, 'page 2 has two columns').toBeGreaterThan(10);
    expect(col2.length, 'page 2 has two columns').toBeGreaterThan(10);
    const from = col1.at(-3)!;
    const to = col2[1]!;
    await selectInPage(page, 1, from.at + 5, to.at + to.words.length - 3);
    await expect(attachedChip(page)).toHaveAttribute('data-page', '2');
    await expect.poll(async () => (await markBoxes(page, 2, 'attach-bar')).length).toBe(2);
    const [bar1, bar2] = (await markBoxes(page, 2, 'attach-bar')).sort((a, b) => a.left - b.left);
    const col1Left = Math.min(...col1.map((x) => x.left));
    const col1Right = Math.max(...col1.map((x) => x.right));
    const col2Left = Math.min(...col2.map((x) => x.left));
    // Column 1's bar in the page's margin, beside its three lines; column 2's in the gutter, beside its two (within the anchors' 2 pt).
    const twoPoints = 2 * (96 / 72) * Number(await page.getByTestId('pdf-viewer').getAttribute('data-scale'));
    expect(bar1!.right).toBeLessThan(col1Left);
    expect(Math.abs(bar1!.top - from.top)).toBeLessThanOrEqual(twoPoints);
    expect(Math.abs(bar1!.bottom - col1.at(-1)!.bottom)).toBeLessThanOrEqual(twoPoints);
    expect(bar2!.left).toBeGreaterThan(col1Right);
    expect(bar2!.right).toBeLessThan(col2Left);
    expect(Math.abs(bar2!.top - col2[0]!.top)).toBeLessThanOrEqual(twoPoints);
    expect(Math.abs(bar2!.bottom - to.bottom)).toBeLessThanOrEqual(twoPoints);

    // Page 1, from "We propose…" on to page 2: the title is read after it (above it), then the columns. No bar runs beside the two
    // sentences before the passage; every washed line has a bar beside it.
    const text1 = await page.evaluate(() => window.__learnPdf!.pageText(0));
    await selectInPage(page, 1, 0, 10);
    await selectInPage(page, 0, text1.indexOf('We propose'), text1.indexOf('We propose') + 5);
    await page.evaluate(() => {
      const sel = window.getSelection()!;
      const range = sel.getRangeAt(0).cloneRange();
      range.setEnd(document.querySelector('.page[data-page-number="2"] .textLayer span:not(.markedContent)')!.firstChild!, 5);
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await expect(attachedChip(page)).toHaveAttribute('data-multipage', '');
    await expect.poll(async () => (await markBoxes(page, 1, 'attach-bar')).length).toBeGreaterThan(1);
    const bars = await markBoxes(page, 1, 'attach-bar');
    const washes = await markBoxes(page, 1, 'attached');
    const page1 = await spansOf(page, 1);
    for (const words of ['Attention is all you need.', 'The dominant sequence transduction models are based on complex recurrent neural networks.']) {
      const line = page1.find((x) => x.words === words)!;
      const centre = (line.top + line.bottom) / 2;
      expect(bars.filter((b) => b.top <= centre && b.bottom >= centre), `no bar beside "${words.slice(0, 20)}…"`).toEqual([]);
    }
    for (const w of washes) {
      // The nearest bar to its left that spans it is its own column's: no other washed line stands between them.
      const beside = bars.filter((b) => b.right < w.left && b.top <= w.top + 1 && b.bottom >= w.bottom - 1);
      const where = `${Math.round(w.left)}, ${Math.round(w.top)}`;
      expect(beside.length, `a bar beside the washed line at ${where}`).toBeGreaterThan(0);
      const nearest = beside.reduce((a, b) => (b.right > a.right ? b : a));
      expect(washes.filter((o) => o !== w && o.right <= w.left && o.left >= nearest.right && o.bottom > w.top + 1 && o.top < w.bottom - 1), `the bar beside the washed line at ${where} is its own column's`).toEqual([]);
    }
  } finally {
    await app.close();
  }
});

test('the tutor\'s first showing resolves the outline for its questions without the outline pane: long-outline.pdf\'s 300 entries go with the question, with their pages', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo), UNSET);
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await importPaths(page, [path.join(FIXTURES, 'long-outline.pdf')]);
    await textExtraction(app, 'now');
    await textIdle(app);
    await openItem(page, 'long-outline');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', '6');
    await consentAndChoose(page, 'fake');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('pdf-outline')).toHaveCount(0);
    // The tab's cache has the first 300 entries' pages, the outline pane never shown.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __learnReader: { getState(): { outline: { resolvedUpTo: number; flat: unknown[] } | null } } }).__learnReader.getState().outline))
      .toMatchObject({ resolvedUpTo: 300, flat: { length: 300 } });
    await sendFromComposer(page, '이 자료의 차례를 알려 주세요.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await expect(page.getByTestId('tutor-answer').getByTestId('tool-chip')).toContainText(['목차 확인']);
    const log = await tutorFakeLog(app);
    const call = log.filter((e): e is Extract<typeof e, { t: 'mcp' }> => e.t === 'mcp' && e.method === 'tools/call').find((e) => (e.params as { name?: string }).name === 'get_outline')!;
    const result = (call.result as { result: { structuredContent: { outline: Array<{ depth: number; page: number | null }>; total: number; returned: number; limited: boolean }; content: Array<{ text: string }> } }).result;
    expect(result.structuredContent).toMatchObject({ returned: 300, total: 300, limited: false });
    expect(result.structuredContent.outline).toHaveLength(300);
    expect(result.structuredContent.outline.filter((e) => e.page !== null).length).toBe(300);
    expect(result.structuredContent.outline.slice(0, 5).map((e) => [e.depth, e.page])).toEqual([[0, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
    expect(result.content[0]!.text).not.toContain('outline still loading');
    await expect(page.getByTestId('pdf-outline')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

// ---- The session list (Task 21) ----

const Q_A = '이 장은 무엇을 다루나요?';
const Q_B = '증폭 배율은 어떻게 커지나요?';
/** The application menu's label for a registry command now (main relabels ⌘⌫ by what has the focus). */
async function menuLabel(app: ElectronApplication, id: string): Promise<string | null> {
  const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
  return flat(await menuSnapshot(app)).find((n) => n.id === id)?.label ?? null;
}
const readerRows = (page: Page) => page.getByTestId('reader-sessions').getByTestId('session-row');
const rowOf = (page: Page, conversationId: string) => page.locator(`[data-testid="session-row"][data-conversation-id="${conversationId}"]`);
/** The question the tutor's conversation starts with: which session it shows. */
const shownQuestion = (page: Page) => page.getByTestId('tutor-question').first().locator('.bubble');

/** Two sessions of paper-100 made by questions — A, then B in a new session, B the tab's — each answer ended. */
async function twoSessions(s: Session & { itemId: string }): Promise<{ a: string; b: string }> {
  const a = await ask(s.page, { itemId: s.itemId, conversationId: null, text: Q_A, selection: null, reader: READER_41 });
  await turnEnded(s.page, a.conversationId, a.tutorMessageId);
  await expect(shownQuestion(s.page)).toHaveText(Q_A);
  await s.page.getByTestId('tutor-new-session').click();
  await expect(s.page.getByTestId('tutor-empty')).toBeVisible();
  const b = await ask(s.page, { itemId: s.itemId, conversationId: null, text: Q_B, selection: null, reader: READER_41 });
  await turnEnded(s.page, b.conversationId, b.tutorMessageId);
  await expect(shownQuestion(s.page)).toHaveText(Q_B);
  return { a: a.conversationId, b: b.conversationId };
}

test('the reader\'s 세션 pane (⌥⌘5): the item\'s sessions by day, the tab\'s selected; a row shows its session in the tutor and starts no agent; ↩ names it in place, esc leaves it, and the head shows the name; ⌘⌫ is 세션 삭제 and 실행 취소 brings it back', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page } = s;
  try {
    const { a, b } = await twoSessions(s);
    // The answers are in: the idle fake is closed, and the high-water mark starts again from none.
    await tutorFakeScript(app, 'answer');
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(0);
    await tutorProcesses(app, { resetMax: true });

    // ⌥⌘5, the 보기 menu's 세션 보기 after 목차 보기: the third segment and this item's two sessions, under 오늘, newest first.
    const view = (await menuSnapshot(app)).find((m) => m.id === 'menu.view')!.submenu!.filter((n) => n.id !== null).map((n) => n.id);
    expect(view.indexOf('reader.showSessions')).toBe(view.indexOf('reader.showOutline') + 1);
    expect((await menuSnapshot(app)).flatMap((m) => m.submenu ?? []).find((n) => n.id === 'reader.showSessions')).toMatchObject({ label: '세션 보기', accelerator: 'Alt+CmdOrCtrl+5' });
    await runMenuAccelerator(app, 'reader.showSessions');
    await expect(page.getByTestId('reader-nav-sessions')).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('reader-nav').locator('.seg')).toHaveText(['썸네일', '목차', '세션']);
    await expect(page.getByTestId('reader-sessions').getByTestId('session-group')).toHaveCount(1);
    await expect(page.getByTestId('reader-sessions').getByTestId('session-group')).toHaveAttribute('data-label', '오늘');
    await expect(readerRows(page)).toHaveText([Q_B, Q_A]);
    await expect(page.getByTestId('reader-sessions')).toHaveAttribute('role', 'tree');
    await expect(page.getByTestId('reader-sessions')).toHaveAccessibleName('세션');
    // The session the tab's tutor shows is the selected row; no time on a row; the fake agent's sessions say so with their glyph.
    await expect(rowOf(page, b)).toHaveAttribute('aria-selected', 'true');
    await expect(rowOf(page, a)).toHaveAttribute('aria-selected', 'false');
    await expect(readerRows(page).locator('.lucide-flask-conical')).toHaveCount(2);
    await hoverOver(page, rowOf(page, a));
    await expectTooltipText(page, new RegExp(`^${Q_A.replace('?', '\\?')}\\s·\\s오늘\\s오[전후]\\s\\d{1,2}:\\d{2}\\s·\\s가짜\\s에이전트$`), 'session-row');
    await expectNoSeriousA11y(page, 'session pane');

    // A click on a row: the tab's tutor shows that session; the row is selected; no agent starts.
    await rowOf(page, a).click();
    await expect(rowOf(page, a)).toHaveAttribute('aria-selected', 'true');
    await expect(shownQuestion(page)).toHaveText(Q_A);
    await expect(rowOf(page, a)).toBeFocused();
    // ↑ selects the row above it, and the tutor follows.
    await page.keyboard.press('ArrowUp');
    await expect(rowOf(page, b)).toBeFocused();
    await expect(rowOf(page, b)).toHaveAttribute('aria-selected', 'true');
    await expect(shownQuestion(page)).toHaveText(Q_B);

    // ↩ names the row in place: its name, selected; esc leaves the name as it was and gives the row the focus back.
    await page.keyboard.press('Enter');
    const field = page.getByTestId('session-name-input');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(Q_B);
    await expect(field).toHaveAccessibleName('세션 이름');
    expect(await field.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, Q_B.length]);
    await expectNoSeriousA11y(page, 'session pane, a row named in place');
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(rowOf(page, b)).toBeFocused();
    await expect(rowOf(page, b)).toHaveText(Q_B);
    // ↩, a new name, ↩: the row and the tutor's head say it, the head over the time it started.
    await page.keyboard.press('Enter');
    await expect(field).toBeFocused();
    await page.keyboard.insertText('증폭 배율 정리');
    await page.keyboard.press('Enter');
    await expect(field).toHaveCount(0);
    await expect(rowOf(page, b)).toHaveText('증폭 배율 정리');
    await expect(rowOf(page, b)).toBeFocused();
    const head = page.getByTestId('tutor-session-head');
    await expect(head.locator('.t')).toHaveText('증폭 배율 정리');
    await expect(head.locator('.m')).toHaveText(/^오늘 오[전후] \d{1,2}:\d{2}$/);
    const list = await page.evaluate((id) => window.learn.sessions.list({ itemId: id }), s.itemId);
    expect(list.ok && list.data.map((x) => [x.id, x.title, x.renamed])).toEqual([[b, '증폭 배율 정리', true], [a, Q_A, false]]);

    // Selecting, naming: no agent ran. The composer's focus starts one (the count is live).
    expect((await tutorProcesses(app)).max).toBe(0);
    await composerInput(page).focus();
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(1);
    await expect.poll(() => menuLabel(app, 'item.trash')).toBe('휴지통으로 이동');
    expect(await menuItemEnabled(app, 'item.trash')).toBe(false); // the reader's ⌘⌫ needs a session row with the focus

    // ⌘⌫ on the focused row is 세션 삭제: it goes at once; the tab's tutor is on a new empty session, the focus on the next row.
    await rowOf(page, b).click();
    await expect.poll(() => menuLabel(app, 'item.trash')).toBe('세션 삭제');
    await runMenuAccelerator(app, 'item.trash');
    const toast = page.getByTestId('session-undo');
    await expect(toast).toContainText('세션을 삭제했습니다');
    await expect(toast.getByTestId('undo-action')).toHaveText('실행 취소');
    await expect(rowOf(page, b)).toHaveCount(0);
    await expect(readerRows(page)).toHaveText([Q_A]);
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(rowOf(page, a)).toBeFocused();
    await expect(rowOf(page, a)).toHaveAttribute('aria-selected', 'false');
    // 실행 취소: the session is back in the list and in the tab that showed it.
    await toast.getByTestId('undo-action').click();
    await expect(readerRows(page)).toHaveText(['증폭 배율 정리', Q_A]);
    await expect(rowOf(page, b)).toHaveAttribute('aria-selected', 'true');
    await expect(shownQuestion(page)).toHaveText(Q_B);
  } finally {
    await app.close();
  }
});

/** The sessions of the library as main lists them (sessions.recent), each with the cites its answers carry: what a backup must keep. */
async function sessionFacts(page: Page): Promise<Array<{ item: string; title: string; renamed: boolean; messages: number; cites: number }>> {
  return page.evaluate(async () => {
    const recent = await window.learn.sessions.recent();
    if (!recent.ok) throw new Error(`sessions.recent: ${recent.code}`);
    const out: Array<{ item: string; title: string; renamed: boolean; messages: number; cites: number }> = [];
    for (const g of recent.data.groups) {
      for (const s of g.sessions) {
        const thread = await window.learn.sessions.get({ conversationId: s.id });
        if (!thread.ok) throw new Error(`sessions.get: ${thread.code}`);
        out.push({ item: g.item.title, title: s.title, renamed: s.renamed, messages: thread.data.messages.length, cites: thread.data.messages.reduce((n, m) => n + m.sources.length, 0) });
      }
    }
    return out;
  });
}

test('the library\'s 세션 section: the items talked about last, each with its newest sessions; a row\'s menu names it and deletes it; a row opens its item\'s tab on that session; a new run keeps them, and a backup restored holds the same sessions and cites (AC15)', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page } = s;
  let before: Awaited<ReturnType<typeof sessionFacts>> = [];
  try {
    const { a, b } = await twoSessions(s);
    await runMenuCommand(app, 'view.inspectorInfo');
    await backFromReader(page);
    // Under the collections (none here: under their hint), its own label, the item a label line, its sessions under it, newest first.
    const section = page.getByTestId('library-sessions');
    await expect(section.locator('.section-label')).toHaveText('세션');
    await expect(section.getByTestId('session-item-line')).toHaveText(['paper-100']);
    await expect(section.getByTestId('session-item-line')).toHaveAttribute('aria-hidden', 'true');
    await expect(section.getByTestId('session-group')).toHaveAccessibleName('paper-100');
    await expect(section.getByTestId('session-row')).toHaveText([Q_B, Q_A]);
    expect((await section.boundingBox())!.y).toBeGreaterThanOrEqual((await page.getByTestId('sidebar-hint').boundingBox())!.y);
    await expectNoSeriousA11y(page, 'library session section');

    // A row's menu: 이름 바꾸기 · — · 세션 삭제 with its ⌘⌫; 이름 바꾸기 names the row in place, here in the library.
    await stubContextMenu(app, '이름 바꾸기');
    await rowOf(page, a).click({ button: 'right' });
    const field = section.getByTestId('session-name-input');
    await expect(field).toBeFocused();
    const [lines] = await recordedPopups(app);
    expect(lines!.map((l) => [l.label, l.type, l.enabled])).toEqual([['이름 바꾸기', 'normal', true], ['', 'separator', true], ['세션 삭제', 'normal', true]]);
    await page.keyboard.insertText('6장 요약');
    await page.keyboard.press('Enter');
    await expect(rowOf(page, a)).toHaveText('6장 요약');
    await expect(section.getByTestId('session-row')).toHaveText(['6장 요약', Q_B]); // a renamed session is the newest
    // 세션 삭제 from its menu: at once, with 실행 취소.
    await stubContextMenu(app, '세션 삭제');
    await rowOf(page, b).click({ button: 'right' });
    await expect(page.getByTestId('session-undo')).toContainText('세션을 삭제했습니다');
    await expect(section.getByTestId('session-row')).toHaveText(['6장 요약']);
    await page.getByTestId('session-undo').getByTestId('undo-action').click();
    await expect(section.getByTestId('session-row')).toHaveText(['6장 요약', Q_B]);

    // A row opens its item's tab on that session: the right panel in its tutor mode.
    await rowOf(page, b).click();
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    await expect(page.getByTestId('inspector')).toHaveAttribute('data-mode', 'tutor');
    await expect(shownQuestion(page)).toHaveText(Q_B);
    await runMenuCommand(app, 'reader.showSessions');
    await expect(rowOf(page, b)).toHaveAttribute('aria-selected', 'true');
    before = await sessionFacts(page);
    expect(before).toEqual([
      { item: 'paper-100', title: '6장 요약', renamed: true, messages: 2, cites: 2 },
      { item: 'paper-100', title: Q_B, renamed: false, messages: 2, cites: 2 },
    ]);
  } finally {
    await app.close();
  }

  // A new run: the tab is on a new empty session; the pane still lists both, with their names and cites.
  const next = await launch(...dirs(testInfo), UNSET);
  const backups = testInfo.outputPath('backups');
  fs.mkdirSync(backups, { recursive: true });
  let restored = '';
  try {
    await expect(next.page.getByTestId('item-row').or(next.page.getByTestId('pdf-viewer')).first()).toBeVisible();
    if ((await next.page.getByTestId('pdf-viewer').count()) === 0) await openItem(next.page, 'paper-100');
    await expect(next.page.getByTestId('tutor-empty')).toBeVisible();
    await expect(next.page.getByTestId('reader-sessions').getByTestId('session-row')).toHaveText(['6장 요약', Q_B]);
    expect(await sessionFacts(next.page)).toEqual(before);
    // 백업 만들기…, then 백업에서 복원… into a folder of its own: the restored library's counts are the backup's (its sheet has no issue).
    await backFromReader(next.page);
    await stubFolderPicker(next.app, backups);
    await closeSheet(await expectWindow(next.app, 'sheet', () => runMenuCommand(next.app, 'file.backup')), 'Enter');
    const [backup] = fs.readdirSync(backups).filter((n) => n.startsWith('Learn 백업'));
    const into = testInfo.outputPath('restored');
    fs.mkdirSync(into, { recursive: true });
    await stubFolderPicks(next.app, [path.join(backups, backup!), into]);
    const sheet = await expectWindow(next.app, 'sheet', () => runMenuCommand(next.app, 'file.restore'));
    await expect(sheet.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'success');
    await expect(sheet.getByTestId('restore-issues')).toHaveCount(0);
    const [made] = fs.readdirSync(into).filter((n) => n.startsWith('Learn 복원'));
    restored = path.join(into, made!);
    await closeSheet(sheet, 'Escape');
  } finally {
    await next.app.close();
  }
  const third = await launch(restored, testInfo.outputPath('userdata-restored'), UNSET);
  try {
    await expect(third.page.getByTestId('app-ready')).toBeAttached();
    expect(await sessionFacts(third.page)).toEqual(before);
  } finally {
    await third.app.close();
  }
});

test('영구 삭제… says how many tutor sessions go with the items, as main counts them: one item\'s, several items\', the emptied trash\'s; a deleted session is none of them', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page, itemId } = s;
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
  try {
    const asked = await ask(page, { itemId, conversationId: null, text: Q_A, selection: null, reader: READER_41 });
    await turnEnded(page, asked.conversationId, asked.tutorMessageId);
    const [outline] = await importPaths(page, [path.join(FIXTURES, 'long-outline.pdf')]);
    const seeded = await seedSessions(app, { itemId: outline!.id, sessions: 3, messagesPerSession: 2, citationsPerAnswer: 1 });
    expect(await page.evaluate((id) => window.learn.sessions.delete({ conversationId: id }), seeded.conversationIds[0]!)).toMatchObject({ ok: true });
    await backFromReader(page);
    await trashItems(page, [itemId, outline!.id]);
    await specialRow(page, 'trash').click();
    // One item: its sessions.
    await rowByTitle(page, 'paper-100').click();
    const one = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await expect(one.getByTestId('purge-text')).toHaveText('되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. 외부 연결 원본은 지우지 않습니다. 이 자료의 세션 1개도 함께 지웁니다.');
    await closeSheet(one, 'Escape');
    // Several: the items that have sessions, and their live sessions (the deleted one is gone already).
    await rowByTitle(page, 'long-outline').click({ modifiers: [MOD] });
    const several = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await expect(several.getByTestId('purge-title')).toHaveText('자료 2개를 영구히 삭제하겠습니까?');
    await expect(several.getByTestId('purge-text')).toContainText('자료 2개의 세션 3개도 함께 지웁니다.');
    await closeSheet(several, 'Escape');
    // 휴지통 비우기…: the trash's items' sessions; once it is emptied there are none left, and the library has no 세션 section.
    const empty = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'trash.empty'));
    await expect(empty.getByTestId('purge-text')).toHaveText('자료 2개를 영구히 지웁니다. 되돌릴 수 없습니다. 외부 연결 원본은 지우지 않습니다. 휴지통에 있는 자료의 세션 3개도 함께 지웁니다.');
    await clickToCloseSheet(empty, empty.getByTestId('purge-confirm'));
    await expect(page.getByTestId('purge-done').last()).toHaveText('휴지통을 비웠습니다');
    expect(await page.evaluate(async () => (await window.learn.sessions.recent()).ok)).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const r = await window.learn.sessions.recent();
      return r.ok ? r.data.groups.length : -1;
    })).toBe(0);
    await expect(page.getByTestId('library-sessions')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the 세션 pane with no session says where they come from; older sessions are under their own day, newest first; a long name keeps one line and ends in an ellipsis', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page, itemId } = s;
  try {
    await runMenuCommand(app, 'reader.showSessions');
    const empty = page.getByTestId('reader-sessions-empty');
    await expect(empty.locator('.pe-title')).toHaveText('이 자료의 세션이 없습니다');
    await expect(empty.locator('.pe-text')).toHaveText('튜터에게 질문하면 여기에 생깁니다.');
    await expect(empty.locator('.lucide-message-square')).toHaveCount(1);
    await expectNoSeriousA11y(page, 'session pane, empty');
    // Three days: today (a long question), yesterday, 2026. 10. 12.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(16, 52, 0, 0);
    const LONG = '‘각 단계 배율의 곱’이 무슨 뜻인지 예를 들어 설명해 주시고, 그 곱이 실제 세포에서는 왜 그보다 작게 나오는지도 함께 설명해 주세요';
    const OLD = ['그림 6-2는 어떻게 읽나요?', '연습 문제 3번 풀이가 맞는지 봐 주세요'];
    await seedSessions(app, { itemId, sessions: 2, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: new Date(2026, 9, 12, 9, 0).toISOString(), questions: OLD });
    // The hook's notice of one session reads as a question's: the tab, on a new empty session, takes the first such one.
    await seedSessions(app, { itemId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1, startedAt: yesterday.toISOString(), questions: ['6.3절을 다섯 줄로 요약해 주세요'] });
    await expect(shownQuestion(page)).toHaveText('6.3절을 다섯 줄로 요약해 주세요');
    await seedSessions(app, { itemId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1, questions: [LONG] });
    const groups = page.getByTestId('reader-sessions').getByTestId('session-group');
    await expect(groups).toHaveCount(3);
    expect(await groups.evaluateAll((els) => els.map((e) => e.getAttribute('data-label')))).toEqual(['오늘', '어제', '2026. 10. 12.']);
    await expect(groups.nth(0).locator('.section-label')).toHaveText('오늘');
    await expect(readerRows(page)).toHaveText([LONG, '6.3절을 다섯 줄로 요약해 주세요', OLD[1]!, OLD[0]!]);
    // The tab's session is the one row selected.
    await expect(page.getByTestId('reader-sessions').locator('[aria-selected="true"]')).toHaveText(['6.3절을 다섯 줄로 요약해 주세요']);
    const label = readerRows(page).first().locator('.label');
    expect(await label.evaluate((el) => [el.scrollWidth > el.clientWidth, getComputedStyle(el).textOverflow, getComputedStyle(el).whiteSpace])).toEqual([true, 'ellipsis', 'nowrap']);
    const row = (await readerRows(page).first().boundingBox())!;
    expect(row.height).toBeLessThanOrEqual(32);
    await hoverOver(page, readerRows(page).nth(3));
    await expectTooltipText(page, '그림 6-2는 어떻게 읽나요? · 2026. 10. 12. · 가짜 에이전트', 'session-row');
    // A double-click names a row in place too (the collection rows' grammar); a click elsewhere keeps what was typed.
    await readerRows(page).nth(3).dblclick();
    const field = page.getByTestId('session-name-input');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(OLD[0]!);
    await page.keyboard.insertText('그림 읽기');
    await page.getByTestId('pdf-stage').click();
    await expect(field).toHaveCount(0);
    await expect(readerRows(page).first()).toHaveText('그림 읽기'); // renamed: the newest
  } finally {
    await app.close();
  }
});

test('a session deleted while its answer comes: main stops the answer first, so no answer is left coming — the next question goes at once — and 실행 취소 brings the session back with its answer stopped', async ({}, testInfo) => {
  const s = await atSession(testInfo);
  const { app, page, itemId } = s;
  try {
    await tutorFakeScript(app, 'slow');
    const asked = await ask(page, { itemId, conversationId: null, text: Q_A, selection: null, reader: READER_41 });
    await expect(page.getByTestId('tutor-answering')).toBeVisible();
    await runMenuCommand(app, 'reader.showSessions');
    await rowOf(page, asked.conversationId).click();
    await expect.poll(() => menuLabel(app, 'item.trash')).toBe('세션 삭제');
    await runMenuAccelerator(app, 'item.trash');
    await expect(page.getByTestId('session-undo')).toContainText('세션을 삭제했습니다');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('tutor-answering')).toHaveCount(0);
    // Nothing is left answering: a question in the new session is not held for another answer.
    await tutorFakeScript(app, 'answer');
    const next = await askViaApi(page, { itemId, conversationId: null, text: Q_B, selection: null, reader: READER_41 });
    expect('busyWith' in next, 'the next question waited for the deleted session\'s answer').toBe(false);
    if ('busyWith' in next) return;
    await turnEnded(page, next.conversationId, next.tutorMessageId);
    // 실행 취소: the session is back, its answer stopped as 중지 stops one.
    await page.getByTestId('session-undo').getByTestId('undo-action').click();
    await expect(rowOf(page, asked.conversationId)).toHaveCount(1);
    expect((await turnEnded(page, asked.conversationId, asked.tutorMessageId)).status).toBe('stopped');
    await rowOf(page, asked.conversationId).click();
    await expect(shownQuestion(page)).toHaveText(Q_A);
    await expect(page.getByTestId('tutor-ended')).toHaveText('중지함');
  } finally {
    await app.close();
  }
});

