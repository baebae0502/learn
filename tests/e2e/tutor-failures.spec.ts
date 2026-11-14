// T1a Task 20: what a failed turn shows (AC14, spec 8.8, 13) — before any answer the question and its chip go back to the composer and
// nothing is sent again by itself; during one the part that came stays with 다시 보내기; offline, the agent not answering, its login that
// lapsed, a tool Learn turned off, the agent killed, Learn killed mid-answer; a resend main refused or whose turn failed before its
// answer. The fake agent only, as itself or inside a Claude-shaped install. Each state on screen has its axe stop (Task 22).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import type { LearnPdfProbe } from '../../apps/desktop/src/renderer/src/viewers/pdf/anchorProbe';
import {
  FIXTURES, expectDisabledReason, expectTooltipText, hardKill, hoverLikeUser, importPaths, launch, mainWindow, openItem, readClipboard, runPalette, textExtraction, textIdle,
  tutorFakeLog, tutorFakeScript, tutorKillAgent, tutorNetwork, tutorTimeouts, type Session,
} from './helpers';
import { consentAndChoose, installFakeAgents } from './tutor-helpers';

declare global {
  interface Window {
    __learnPdf?: LearnPdfProbe;
  }
}

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const UNSET = { LEARN_E2E_SETTINGS: '' };
const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const nb = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\u2060/g, '');

/** paper-100.pdf with its body text read, open at 1440 wide; the consent given and `agent` chosen: the tutor on a new empty session. */
async function atSession(testInfo: { outputPath(...p: string[]): string }, env: Record<string, string> = {}, agent: 'fake' | 'claude' = 'fake'): Promise<Session & { itemId: string }> {
  const s = await launch(...dirs(testInfo), { env: { ...UNSET, ...env } });
  await (await mainWindow(s.app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
  const [paper] = await importPaths(s.page, [PAPER]);
  await textExtraction(s.app, 'now');
  await textIdle(s.app);
  await openItem(s.page, 'paper-100');
  await expect(s.page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
  await consentAndChoose(s.page, agent);
  await expect(s.page.getByTestId('tutor-empty')).toBeVisible();
  return Object.assign(s, { itemId: paper!.id });
}

const composerInput = (page: Page) => page.getByTestId('tutor-input');
const attachedChip = (page: Page) => page.getByTestId('tutor-attached');
/** The questions the fake agents of this run were asked (one prompt each). */
const prompts = async (app: ElectronApplication): Promise<number> => (await tutorFakeLog(app)).filter((e) => e.t === 'prompt').length;
/** A question typed into the composer and sent with ↩, as a person does. */
async function sendFromComposer(page: Page, text: string): Promise<void> {
  await composerInput(page).click();
  await page.keyboard.insertText(text);
  await expect(composerInput(page)).toHaveValue(text);
  await page.keyboard.press('Enter');
}
/** The item's sessions as sessions.list has them. */
async function sessionCount(page: Page, itemId: string): Promise<number> {
  const r = await page.evaluate((id) => window.learn.sessions.list({ itemId: id }), itemId);
  if (!r.ok) throw new Error(`sessions.list: ${r.code}`);
  return r.data.length;
}
/** The one session's messages as sessions.get reads them: [id, role, status, errorCode]. */
async function thread(page: Page, itemId: string): Promise<{ conversationId: string; messages: Array<[string, string, string, string | null]> }> {
  return page.evaluate(async (id) => {
    const list = await window.learn.sessions.list({ itemId: id });
    if (!list.ok || list.data.length !== 1) throw new Error(`sessions.list: ${list.ok ? list.data.length : list.code}`);
    const t = await window.learn.sessions.get({ conversationId: list.data[0]!.id });
    if (!t.ok) throw new Error(`sessions.get: ${t.code}`);
    return { conversationId: list.data[0]!.id, messages: t.data.messages.map((m) => [m.id, m.role, m.status, m.errorCode] as [string, string, string, string | null]) };
  }, itemId);
}
/** The composer has the focus, its caret at the end of its text. */
async function expectFocusAtEnd(page: Page): Promise<void> {
  await expect(composerInput(page)).toBeFocused();
  const [start, end, length] = await composerInput(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
  expect([start, end]).toEqual([length, length]);
}

test('before any answer: the question and its chip go back to the composer, no session is left, the notice says the agent stopped before answering; nothing goes again until ↩', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'fail-before');
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    const passage = 'We propose a new simple network architecture.';
    const at = (await page.evaluate(() => window.__learnPdf!.pageText(0))).indexOf(passage);
    expect(at, 'page 1 holds the passage').toBeGreaterThanOrEqual(0);
    await page.evaluate(async ([s, e]) => {
      (document.activeElement as HTMLElement | null)?.blur();
      await window.__learnPdf!.selectText(0, s!, e!);
    }, [at, at + passage.length] as const);
    await expect(attachedChip(page)).toBeVisible();
    await sendFromComposer(page, '이 문장은 무슨 뜻인가요?');

    const failure = page.getByTestId('tutor-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-phase', 'before');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('가짜 에이전트가 답하기 전에 멈췄습니다');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('답을 받지 못했습니다. 잠시 뒤 입력창에서 ↩로 다시 보내세요. 질문은 입력창에 그대로 있습니다.');
    await expect(failure.getByRole('button')).toHaveCount(0);
    // The question is in the composer again, the focus there with the caret at its end; its chip is back, unheld, and so is its mark.
    await expect(composerInput(page)).toHaveValue('이 문장은 무슨 뜻인가요?');
    await expectFocusAtEnd(page);
    await expect(attachedChip(page).getByTestId('tutor-attached-label')).toHaveText(`1쪽 · ${passage}`);
    await expect(attachedChip(page)).not.toHaveAttribute('data-held');
    await expect(page.locator('[data-testid="pdf-attached"]')).toHaveCount(1);
    // Its session went with it: the tab is on a new empty session, with the notice over it, and the alert said its title.
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    expect(await sessionCount(page, itemId)).toBe(0);
    await expect(page.getByTestId('tutor-alert')).toHaveText('가짜 에이전트가 답하기 전에 멈췄습니다');
    await expect(failure).toHaveCount(1);
    await expectNoSeriousA11y(page, 'tutor failure before any answer');

    // The control: one ↩ sends it again, and the notice goes with that send. Until then nothing went.
    expect(await prompts(app)).toBe(1);
    await tutorFakeScript(app, 'answer');
    await composerInput(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question').locator('.bubble p')).toHaveText('이 문장은 무슨 뜻인가요?');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await expect(failure).toHaveCount(0);
    expect(await prompts(app)).toBe(2);
    await expect(page.getByTestId('tutor-question').locator('.tutor-quote .q')).toHaveText(passage);
  } finally {
    await app.close();
  }
});

test('during the answer: the part that came stays, cut, with 다시 보내기 — the same question asked from the start, and no failed answer is left', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'fail-mid');
    await sendFromComposer(page, '천천히 답해 주세요.');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'failed');
    await expect(answer.getByTestId('tutor-answer-text')).not.toHaveText('');
    await expect(answer.locator('.tutor-cut')).toHaveCount(1);
    const failure = answer.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-phase', 'during');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('가짜 에이전트가 답하는 도중 멈췄습니다');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('에이전트 프로그램이 예기치 않게 종료되어 답이 중간에 끊겼습니다. 다시 보내면 에이전트를 다시 시작하고 같은 질문을 처음부터 묻습니다.');
    // The question stays in the thread, not in the composer.
    await expect(composerInput(page)).toHaveValue('');
    await expect(page.getByTestId('tutor-alert')).toHaveText('가짜 에이전트가 답하는 도중 멈췄습니다');
    await hoverLikeUser(page, 'tutor-resend');
    await expectTooltipText(page, '같은 질문을 처음부터 다시 묻습니다', 'tutor-resend');
    // While the item opens (the reader's own flag) 다시 보내기 waits, soft-disabled with the composer's words for it.
    const ready = (on: boolean) => page.evaluate((v) => (window as unknown as { __learnReader: { getState(): { setPdf(p: { ready: boolean }): void } } }).__learnReader.getState().setPdf({ ready: v }), on);
    await ready(false);
    await expectDisabledReason(answer.getByTestId('tutor-resend'), '자료를 여는 중입니다');
    await ready(true);
    await expectDisabledReason(answer.getByTestId('tutor-resend'), null);
    await expectNoSeriousA11y(page, 'tutor failure during the answer');
    const before = await thread(page, itemId);
    expect(before.messages.map(([, role, status]) => [role, status])).toEqual([['user', 'complete'], ['tutor', 'failed']]);

    await tutorFakeScript(app, 'answer');
    await answer.getByTestId('tutor-resend').click();
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await expect(page.getByTestId('tutor-failure')).toHaveCount(0);
    const after = await thread(page, itemId);
    expect(after.messages.map(([, role, status]) => [role, status])).toEqual([['user', 'complete'], ['tutor', 'complete']]);
    expect(after.messages[0]![0]).toBe(before.messages[0]![0]); // the same question
    expect(after.messages[1]![0]).not.toBe(before.messages[1]![0]); // a new answer, the failed one gone
    const asked = (await tutorFakeLog(app)).filter((e) => e.t === 'prompt');
    expect(asked).toHaveLength(2);
    expect(asked[1]!.blocks.map((b) => b.text).join('\n')).toContain('천천히 답해 주세요.');
  } finally {
    await app.close();
  }
});

test('offline: nothing is sent and the question stays; back online nothing goes by itself — one ↩ sends it, once', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorNetwork(app, 'offline');
    await sendFromComposer(page, '연결이 없을 때 묻습니다.');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('인터넷에 연결되어 있지 않습니다');
    await expect(failure).toHaveAttribute('data-code', 'OFFLINE');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('질문을 보내지 못했습니다. 연결을 확인한 뒤 입력창에서 ↩로 보내세요. 질문은 입력창에 그대로 있습니다.');
    await expect(failure.locator('.lucide-wifi-off')).toHaveCount(1);
    await expect(composerInput(page)).toHaveValue('연결이 없을 때 묻습니다.');
    await expectFocusAtEnd(page);
    expect(await sessionCount(page, itemId)).toBe(0);
    expect(await prompts(app)).toBe(0);
    await expectNoSeriousA11y(page, 'tutor offline before sending');

    await tutorNetwork(app, 'online');
    await expect(failure).toBeVisible();
    // The positive control: this ↩ is the one send, and the agent is asked exactly once.
    await composerInput(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question').locator('.bubble p')).toHaveText('연결이 없을 때 묻습니다.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    await expect(failure).toHaveCount(0);
    expect(await prompts(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test('a failure before the answer, asked from a column scrolled up to an earlier answer, is brought into view at the column\'s end', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await sendFromComposer(page, '먼저 묻는 질문입니다.');
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    const log = page.getByTestId('tutor-log');
    const fromBottom = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(200);
    // Read again from the top: the column is away from its end.
    await log.evaluate((el) => void (el.scrollTop = 0));
    await expect.poll(fromBottom).toBeGreaterThan(200);
    await tutorNetwork(app, 'offline');
    await sendFromComposer(page, '위를 읽다가 묻습니다.');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'OFFLINE');
    await expect(failure).toBeInViewport();
    await expect.poll(fromBottom).toBeLessThanOrEqual(24);
    await expect(composerInput(page)).toHaveValue('위를 읽다가 묻습니다.');
  } finally {
    await app.close();
  }
});

test('an agent that never answers: past its first-update limit the turn ends, the notice says it does not answer, and the question is back', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await tutorTimeouts(app, { firstUpdateMs: 500 });
    await tutorFakeScript(app, 'hang');
    await sendFromComposer(page, '대답이 없을 질문입니다.');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('가짜 에이전트가 답하지 않습니다', { timeout: 30_000 });
    await expect(failure).toHaveAttribute('data-code', 'AGENT_TIMEOUT');
    await expect(composerInput(page)).toHaveValue('대답이 없을 질문입니다.');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expectNoSeriousA11y(page, 'tutor agent that does not answer');
  } finally {
    await app.close();
  }
});

test('a login that lapsed says so only when the agent answers: the notice with the command to run, copied as shown; the question back; the button and the chooser say 로그인 필요', async ({}, testInfo) => {
  const userData = testInfo.outputPath('userdata');
  const bin = installFakeAgents(testInfo.outputPath('npm'), { cli: '2.1.318', adapter: '0.103.0', script: 'login-silent', log: path.join(userData, 'fake-agent.log') });
  const { app, page } = await atSession(testInfo, { LEARN_AGENT_SEARCH_PATH: bin }, 'claude');
  try {
    const button = page.getByTestId('tutor-agent');
    await expect(button).toHaveText('Claude Code');
    await sendFromComposer(page, '로그인이 풀린 뒤의 질문입니다.');
    const failure = page.getByTestId('tutor-failure');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('Claude Code 로그인이 필요합니다', { timeout: 30_000 });
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('질문을 보내지 못했습니다. 터미널에서 아래 명령으로 로그인한 뒤 입력창에서 ↩로 보내세요. 질문은 입력창에 그대로 있습니다.');
    // The command comes with the report the window read again after that failure: the chooser's own, shown and copied the same.
    const shown = failure.getByTestId('tutor-failure-copy-text');
    await expect(shown).toContainText('claude auth login');
    const folder = path.join(userData, 'Tutor', 'agents', 'claude');
    const command = nb(await shown.innerText()).replace(/\n/g, '');
    expect([`CLAUDE_CONFIG_DIR="${folder}" claude auth login`, `CLAUDE_CONFIG_DIR="$HOME/${path.relative(os.homedir(), folder)}" claude auth login`]).toContain(command);
    await failure.getByTestId('tutor-failure-copy').click();
    await expect.poll(() => readClipboard(app)).toBe(command);
    await expectTooltipText(page, '복사했습니다', 'tutor-failure-copy');
    await expect(composerInput(page)).toHaveValue('로그인이 풀린 뒤의 질문입니다.');
    await expect(button).toHaveText('Claude Code · 로그인 필요');
    await expectNoSeriousA11y(page, 'tutor login needed before sending');
    await runPalette(page, app, '에이전트', 'tutor.chooseAgent');
    const row = page.getByTestId('agent-row').and(page.locator('[data-agent="claude"]'));
    await expect(row.getByTestId('agent-flag')).toHaveText('로그인 필요');
    expect(nb(await row.getByTestId('agent-copy-text').innerText()).replace(/\n/g, '')).toBe(command);
  } finally {
    await app.close();
  }
});

test('a tool Learn turned off: the turn stops with nothing kept, and its notice sends to 에이전트 고르기… (no 다시 보내기); the agent is reported as an old version', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'lockdown');
    await sendFromComposer(page, '목록을 보여 주세요.');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'failed');
    const failure = answer.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'AGENT_LOCKDOWN');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('꺼 둔 도구를 쓰려 해 답을 멈췄습니다');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('가짜 에이전트가 Learn이 꺼 둔 도구를 쓰려 했습니다. 에이전트를 업데이트한 뒤 다시 확인하세요.');
    await expect(failure.getByRole('button', { name: '에이전트 고르기…' })).toBeVisible();
    await expect(failure.getByTestId('tutor-resend')).toHaveCount(0);
    await expect(answer.getByTestId('tutor-answer-text')).toHaveCount(0);
    expect(await page.evaluate(() => window.learn.tutor.agents({ mode: 'cached' }))).toMatchObject({ ok: true, data: { fake: { state: 'old', note: 'lockdown' } } });
    await expectNoSeriousA11y(page, 'tutor turn stopped for a tool Learn turned off');
  } finally {
    await app.close();
  }
});

test('the agent killed mid-answer: "답하는 도중 멈췄습니다" under the part that came, and 다시 보내기', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'slow');
    await sendFromComposer(page, '천천히 답해 주세요.');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer.getByTestId('tutor-answer-text')).not.toHaveText('');
    await tutorKillAgent(app);
    await expect(answer).toHaveAttribute('data-status', 'failed');
    await expect(answer.getByTestId('tutor-failure-title')).toHaveText('가짜 에이전트가 답하는 도중 멈췄습니다');
    await expect(answer.getByTestId('tutor-resend')).toBeVisible();
    await expect(composerInput(page)).toHaveValue('');
  } finally {
    await app.close();
  }
});

test('Learn killed mid-answer: on the next start the answer reads as cut off, with 다시 보내기, and it asks again', async ({}, testInfo) => {
  let s = await atSession(testInfo);
  const { itemId } = s;
  let cut = '';
  let killed = false;
  try {
    await tutorFakeScript(s.app, 'slow');
    await sendFromComposer(s.page, '끊길 답의 질문입니다.');
    await expect(s.page.getByTestId('tutor-answer').getByTestId('tutor-answer-text')).not.toHaveText('');
    cut = (await thread(s.page, itemId)).conversationId;
    await hardKill(s.app);
    killed = true;
  } finally {
    if (!killed) await s.app.close();
  }
  s = Object.assign(await launch(...dirs(testInfo), { env: UNSET }), { itemId });
  const { app, page } = s;
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await expect.poll(async () => (await thread(page, itemId)).messages.map(([, role, status]) => `${role}:${status}`), { message: 'the cut answer mended' }).toEqual(['user:complete', 'tutor:failed']);
    // A new run starts on a new empty session; the tab is put on the cut one as a reload of the window keeps it.
    await expect(page.getByTestId('item-row').or(page.getByTestId('pdf-viewer')).first()).toBeVisible();
    await page.evaluate(([k, v]) => sessionStorage.setItem(k!, v!), [`learn.tutor.session.${itemId}`, cut] as const);
    if ((await page.getByTestId('pdf-viewer').count()) > 0) {
      await page.reload();
      await expect(page.getByTestId('app-ready')).toBeAttached();
    } else await openItem(page, 'paper-100');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'failed');
    const failure = answer.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'INTERRUPTED');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('답을 받는 도중 Learn이 종료되었습니다');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('다시 보내면 같은 질문을 처음부터 묻습니다.');
    // While the PDF still opens 다시 보내기 is off, as 보내기 is; once it is open, it goes.
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(failure.getByTestId('tutor-resend')).not.toHaveAttribute('aria-disabled', 'true');
    await expectNoSeriousA11y(page, 'tutor answer cut off by Learn\'s end');
    await failure.getByTestId('tutor-resend').click();
    await expect(page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'complete');
    expect((await thread(page, itemId)).messages.map(([, role, status]) => `${role}:${status}`)).toEqual(['user:complete', 'tutor:complete']);
  } finally {
    await app.close();
  }
});

test('a resend main refuses changes nothing but the notice; a resent turn that fails before its answer leaves a failed answer with 다시 보내기 again', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    await tutorFakeScript(app, 'fail-mid');
    await sendFromComposer(page, '천천히 답해 주세요.');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'failed');
    const failure = answer.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'AGENT_EXITED');
    const first = await thread(page, itemId);

    // Offline: main refuses before it changes anything — the same rows, the notice now the network's, the composer empty.
    await tutorNetwork(app, 'offline');
    await failure.getByTestId('tutor-resend').click();
    await expect(failure).toHaveAttribute('data-code', 'OFFLINE');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('인터넷에 연결되어 있지 않습니다');
    expect(nb(await failure.locator('.nt-text').innerText())).toBe('질문을 다시 보내지 못했습니다. 연결을 확인한 뒤 다시 보내세요.');
    await expect(failure.getByTestId('tutor-resend')).toBeVisible();
    expect(await thread(page, itemId)).toEqual(first);
    await expect(composerInput(page)).toHaveValue('');

    // Online, and the agent fails before it answers: the question stays, a new answer is failed, and 다시 보내기 is there again.
    await tutorNetwork(app, 'online');
    await tutorFakeScript(app, 'fail-before');
    await failure.getByTestId('tutor-resend').click();
    await expect.poll(async () => (await thread(page, itemId)).messages[1]![0]).not.toBe(first.messages[1]![0]);
    await expect.poll(async () => (await thread(page, itemId)).messages.map(([, role, status, code]) => `${role}:${status}:${code}`)).toEqual(['user:complete:null', 'tutor:failed:AGENT_EXITED']);
    expect((await thread(page, itemId)).messages[0]![0]).toBe(first.messages[0]![0]);
    const again = page.getByTestId('tutor-answer');
    await expect(again).toHaveAttribute('data-status', 'failed');
    await expect(again.getByTestId('tutor-failure')).toHaveAttribute('data-code', 'AGENT_EXITED');
    await expect(again.getByTestId('tutor-resend')).toBeVisible();
    await expect(composerInput(page)).toHaveValue('');
  } finally {
    await app.close();
  }
});

test('a session whose thread cannot be read says so in the column, and 다시 시도 reads it again', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    // The tab is put on a session main cannot read (an id it refuses, as a read that fails for any reason other than the session's being
    // gone): a reload of the window shows the session the tab keeps.
    await page.evaluate(([k, v]) => sessionStorage.setItem(k!, v!), [`learn.tutor.session.${itemId}`, 'not-a-session'] as const);
    await page.reload();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    const failed = page.getByTestId('tutor-thread-failed');
    await expect(failed.getByTestId('tutor-thread-failed-title')).toHaveText('세션을 열지 못했습니다');
    await expect(page.getByTestId('tutor-empty')).toHaveCount(0);
    await expectNoSeriousA11y(page, 'tutor thread that could not be read');
    // main refuses each read before it counts it, and logs its code: the log's lines count the reads.
    const refusals = () => {
      const log = path.join(testInfo.outputDir, 'main.log');
      return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => l.includes('[ipc] sessions:get failed: VALIDATION_FAILED')).length : 0;
    };
    await expect.poll(refusals).toBeGreaterThan(0);
    const reads = refusals();
    await failed.getByRole('button', { name: '다시 시도' }).click();
    await expect.poll(refusals).toBe(reads + 1);
    await expect(failed).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Learn killed before any text came: on the next start the empty answer reads as cut off, with 다시 보내기', async ({}, testInfo) => {
  let s = await atSession(testInfo);
  const { itemId } = s;
  let cut = '';
  let killed = false;
  try {
    await tutorFakeScript(s.app, 'hang');
    await sendFromComposer(s.page, '답이 오기 전에 끊길 질문입니다.');
    // The agent has the question and says nothing: the answer row is there, still coming, with no text.
    await expect.poll(() => prompts(s.app)).toBe(1);
    await expect(s.page.getByTestId('tutor-answer')).toHaveAttribute('data-status', 'streaming');
    await expect(s.page.getByTestId('tutor-answer-text')).toHaveCount(0);
    cut = (await thread(s.page, itemId)).conversationId;
    await hardKill(s.app);
    killed = true;
  } finally {
    if (!killed) await s.app.close();
  }
  s = Object.assign(await launch(...dirs(testInfo), { env: UNSET }), { itemId });
  const { app, page } = s;
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
    await expect.poll(async () => (await thread(page, itemId)).messages.map(([, role, status]) => `${role}:${status}`), { message: 'the cut answer mended' }).toEqual(['user:complete', 'tutor:failed']);
    await expect(page.getByTestId('item-row').or(page.getByTestId('pdf-viewer')).first()).toBeVisible();
    await page.evaluate(([k, v]) => sessionStorage.setItem(k!, v!), [`learn.tutor.session.${itemId}`, cut] as const);
    if ((await page.getByTestId('pdf-viewer').count()) > 0) {
      await page.reload();
      await expect(page.getByTestId('app-ready')).toBeAttached();
    } else await openItem(page, 'paper-100');
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', 'failed');
    await expect(answer.getByTestId('tutor-answer-text')).toHaveCount(0);
    const failure = answer.getByTestId('tutor-failure');
    await expect(failure).toHaveAttribute('data-code', 'INTERRUPTED');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('답을 받는 도중 Learn이 종료되었습니다');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
    await expect(failure.getByTestId('tutor-resend')).toBeVisible();
    await expectDisabledReason(failure.getByTestId('tutor-resend'), null);
  } finally {
    await app.close();
  }
});
