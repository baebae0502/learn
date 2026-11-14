// T1a Task 20: an answer whose cites were not read in its turn (AC10, spec 7, 8.3, 13) — 출처 없음 chips, the notice under the answer and
// 원문 근거로 다시 묻기, a new visible turn that names the pages to read first (those past the last page left out), verified once read; the
// notice brought down to its title once that turn follows; a reground that fails before its answer; and a PDF without readable text
// (spec 8.2), which is named over the session and still asked. The fake agent only.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import type { LearnPdfProbe } from '../../apps/desktop/src/renderer/src/viewers/pdf/anchorProbe';
import { FIXTURES, expectTooltipText, importPaths, launch, mainWindow, openItem, textExtraction, textIdle, tutorFakeLog, tutorFakeScript, type Session } from './helpers';
import { consentAndChoose } from './tutor-helpers';

declare global {
  interface Window {
    __learnPdf?: LearnPdfProbe;
  }
}

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const NO_TEXT = path.join(FIXTURES, 'no-text.pdf');
const UNSET = { env: { LEARN_E2E_SETTINGS: '' } };
const nb = (s: string) => s.replace(/ /g, ' ');

/** `file` with its body text read (or found to have none), open at 1440 wide; the consent given and the fake chosen. */
async function atSession(testInfo: { outputPath(...p: string[]): string }, file = PAPER): Promise<Session & { itemId: string }> {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), UNSET);
  await (await mainWindow(s.app)).evaluate((w) => w.setContentSize(1440, w.getContentSize()[1]!));
  const [item] = await importPaths(s.page, [file]);
  await textExtraction(s.app, 'now');
  await textIdle(s.app);
  await openItem(s.page, item!.title);
  await expect(s.page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
  await consentAndChoose(s.page, 'fake');
  await expect(s.page.getByTestId('tutor-empty')).toBeVisible();
  return Object.assign(s, { itemId: item!.id });
}

const composerInput = (page: Page) => page.getByTestId('tutor-input');
const prompts = async (app: ElectronApplication) => (await tutorFakeLog(app)).filter((e) => e.t === 'prompt');
async function sendFromComposer(page: Page, text: string): Promise<void> {
  await composerInput(page).click();
  await page.keyboard.insertText(text);
  await expect(composerInput(page)).toHaveValue(text);
  await page.keyboard.press('Enter');
}
/** Each chip of an answer as "state:page". */
const chipsOf = (answer: ReturnType<Page['locator']>) => answer.getByTestId('cite-chip').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-cite')}:${e.getAttribute('data-page')}`));
/** The pointer over this element as a person brings it there, for a hover tooltip. */
async function hoverOver(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  const [x, y] = await page.evaluate(() => [Math.round(innerWidth / 2), Math.round(innerHeight / 2)] as const);
  await page.mouse.move(x, y);
  await target.hover();
}
/** The session's messages as sessions.get reads them: "role:kind:status". */
async function messagesOf(page: Page, itemId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const list = await window.learn.sessions.list({ itemId: id });
    if (!list.ok || list.data.length !== 1) throw new Error('one session');
    const t = await window.learn.sessions.get({ conversationId: list.data[0]!.id });
    if (!t.ok) throw new Error(`sessions.get: ${t.code}`);
    return t.data.messages.map((m) => `${m.role}:${m.kind}:${m.status}`);
  }, itemId);
}

/** An answer of the unverified script, asked from the composer: it reads the pages after the reader's (or after the attached one's). */
async function unverifiedAnswer(page: Page, app: ElectronApplication, opts: { attach: boolean }): Promise<ReturnType<Page['locator']>> {
  await tutorFakeScript(app, 'unverified');
  if (opts.attach) {
    await page.waitForFunction(() => window.__learnPdf !== undefined);
    const passage = 'We propose a new simple network architecture.';
    const at = (await page.evaluate(() => window.__learnPdf!.pageText(0))).indexOf(passage);
    expect(at, 'page 1 holds the passage').toBeGreaterThanOrEqual(0);
    await page.evaluate(async ([s, e]) => {
      (document.activeElement as HTMLElement | null)?.blur();
      await window.__learnPdf!.selectText(0, s!, e!);
    }, [at, at + passage.length] as const);
    await expect(page.getByTestId('tutor-attached')).toBeVisible();
  }
  await sendFromComposer(page, '이 문장은 무슨 뜻인가요?');
  const answer = page.getByTestId('tutor-answer').first();
  await expect(answer).toHaveAttribute('data-status', 'complete');
  return answer;
}

test('cites the answer did not read are 출처 없음; the notice under it asks again from the source: a new turn names the page to read first (not the one past the last page), and that page read is verified; the notice keeps its title', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    const answer = await unverifiedAnswer(page, app, { attach: true });
    // It read 2–3 and cited them; it cited the attached page 1 without reading it, and page 999, past the last.
    const chips = await chipsOf(answer);
    expect(chips).toEqual(expect.arrayContaining(['go:2', 'go:3', 'none:1', 'none:999']));
    const outside = answer.locator('[data-testid="cite-chip"][data-page="999"]');
    await expect(outside).toHaveText('출처 없음');
    await expect(outside).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('tutor-log').evaluate((el) => void (el.scrollTop = 0));
    await hoverOver(page, outside);
    await expectTooltipText(page, '확인되지 않은 인용 · 999쪽은 이 자료에 없습니다', 'cite-chip');
    await page.mouse.move(5, 5);

    // The notice under it: how many, what that means, and the button.
    const notice = answer.getByTestId('tutor-unverified');
    await expect(notice.getByTestId('tutor-unverified-title')).toHaveText('인용 2개를 확인하지 못했습니다');
    expect(nb(await notice.locator('.nt-text').innerText())).toBe('튜터가 이번 답에서 읽지 않은 쪽을 가리켰습니다. 원문 근거로 다시 물으면 튜터가 먼저 그 쪽을 읽고 답하게 합니다. 이번에도 읽지 않은 쪽을 가리키면 다시 표시합니다.');
    // The column's width, under the answer's foot.
    const [n, log] = [(await notice.boundingBox())!, (await page.locator('.tutor-log-content').boundingBox())!];
    expect(Math.abs(n.width - (log.width - 32))).toBeLessThanOrEqual(1);
    await expectNoSeriousA11y(page, 'tutor answer with its unverified notice');

    // 원문 근거로 다시 묻기: the next answer reads before it answers.
    await tutorFakeScript(app, 'answer');
    await notice.getByTestId('tutor-reground').click();
    const asked = page.getByTestId('tutor-question').nth(1);
    await expect(asked.locator('.bubble p')).toHaveText('1쪽을 먼저 읽고 다시 답해 주세요.');
    const again = page.getByTestId('tutor-answer').nth(1);
    await expect(again).toHaveAttribute('data-status', 'complete');
    await expect.poll(() => chipsOf(again)).toEqual(expect.arrayContaining(['go:1']));
    expect((await chipsOf(again)).filter((c) => c.startsWith('none:'))).toEqual([]);
    // What went to the agent: Learn's request for the page inside the document only.
    const said = (await prompts(app)).at(-1)!.blocks.map((b) => b.text).join('\n');
    expect(said).toContain('cited page(s) 1 without reading them');
    expect(said).not.toContain('999');
    // Its sent list says what it was.
    await asked.getByTestId('sent-scope').click();
    await expect(asked.getByTestId('sent-scope-list').locator('dd').first()).toHaveText('원문 근거 요청');
    // The earlier answer's notice keeps its title only, and its chips stay as they were; the composer was never involved.
    await expect(notice).toHaveClass(/\bis-brief\b/);
    await expect(notice.getByTestId('tutor-unverified-title')).toHaveText('인용 2개를 확인하지 못했습니다');
    await expect(notice.locator('.nt-text')).toHaveCount(0);
    await expect(notice.getByTestId('tutor-reground')).toHaveCount(0);
    expect(await chipsOf(answer)).toEqual(chips);
    await expect(composerInput(page)).toHaveValue('');
    expect(await messagesOf(page, itemId)).toEqual(['user:question:complete', 'tutor:answer:complete', 'user:reground:complete', 'tutor:answer:complete']);
    await expectNoSeriousA11y(page, 'tutor reground turn');
  } finally {
    await app.close();
  }
});

test('a reground turn that fails before its answer goes alone: the question and answer before it stay, the composer stays empty, and the notice has its button again', async ({}, testInfo) => {
  const { app, page, itemId } = await atSession(testInfo);
  try {
    const answer = await unverifiedAnswer(page, app, { attach: false });
    const notice = answer.getByTestId('tutor-unverified');
    await expect(notice.getByTestId('tutor-reground')).toBeVisible();
    await tutorFakeScript(app, 'fail-before');
    await notice.getByTestId('tutor-reground').click();
    const failure = page.getByTestId('tutor-failure');
    await expect(failure.getByTestId('tutor-failure-title')).toHaveText('가짜 에이전트가 답하기 전에 멈췄습니다');
    await expect(failure).toHaveAttribute('data-phase', 'before');
    // Nothing was in the composer to give back, so the notice says no more than its title.
    await expect(failure).toHaveClass(/\bis-brief\b/);
    await expect(failure.locator('.nt-text')).toHaveCount(0);
    await expect(page.getByTestId('tutor-alert')).toHaveText('가짜 에이전트가 답하기 전에 멈췄습니다');
    await expect.poll(() => messagesOf(page, itemId)).toEqual(['user:question:complete', 'tutor:answer:complete']);
    await expect(page.getByTestId('tutor-question')).toHaveCount(1);
    await expect(composerInput(page)).toHaveValue('');
    await expect(notice.getByTestId('tutor-reground')).toBeVisible();
    await expect(notice).not.toHaveClass(/\bis-brief\b/);
  } finally {
    await app.close();
  }
});

test('a PDF without readable text is named over the session, its empty session says only what is true, and asking is not held back', async ({}, testInfo) => {
  const { app, page } = await atSession(testInfo, NO_TEXT);
  try {
    const line = page.getByTestId('tutor-no-text');
    await expect(line).toHaveAttribute('data-kind', 'empty');
    expect(nb(await line.innerText())).toBe('이 PDF에서 글자를 찾지 못해 튜터가 쪽을 읽을 수 없습니다. 스캔한 PDF일 수 있습니다.');
    expect(nb(await page.getByTestId('tutor-empty').locator('.pe-text').innerText())).toBe('이 자료에 대해 물어보세요. 튜터는 일반 지식으로 답하고, 답의 쪽은 확인되지 않습니다.');
    // Over the session, under the panel's head (and the fake's band).
    const [l, band] = [(await line.boundingBox())!, (await page.getByTestId('tutor-fake-band').boundingBox())!];
    expect(l.y).toBeGreaterThanOrEqual(band.y + band.height - 1);
    await expectNoSeriousA11y(page, 'tutor on a PDF without text');
    // 보내기 is on once there is text: nothing about the body holds it back.
    await composerInput(page).click();
    await page.keyboard.insertText('이 자료는 무엇인가요?');
    await expect(page.getByTestId('tutor-send')).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question').locator('.bubble p')).toHaveText('이 자료는 무엇인가요?');
    await expect.poll(async () => (await prompts(app)).length).toBe(1);
    await expect(page.getByTestId('tutor-answer')).not.toHaveAttribute('data-status', 'streaming', { timeout: 60_000 });
    // Over the conversation too.
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual((await page.getByTestId('tutor-log').boundingBox())!.y + 1);
  } finally {
    await app.close();
  }
});
