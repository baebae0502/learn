// T1a spec 16.4: the whole app with the real Claude Code — only with LEARN_AGENT_LIVE=1, run by the controller on the dev server, never
// in CI or on the Mac runner (they use the fake). Always isolated: the agent's folder is $LEARN_AGENT_LIVE_HOME/agents/claude (a
// Learn-only login), and detection searches LEARN_AGENT_LIVE_PATH only. Under Playwright the app runs with LEARN_E2E=1, whose search
// path wins (tutor/env-policy.ts), so the live folders are passed as LEARN_AGENT_SEARCH_PATH too.
//
//   LEARN_AGENT_LIVE=1 LEARN_AGENT_LIVE_HOME=<Learn-only login> LEARN_AGENT_LIVE_PATH=<claude and the connection tool's bin folders> \
//     taskset -c 0-1 xvfb-run -a -s "-screen 0 1920x1200x24" pnpm exec playwright test tests/e2e/tutor-live.spec.ts
//
// What a run found is written as the test's annotations (the agent's state; the answer's page chips).
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, importPaths, launch, mainWindow, openItem, textExtraction, textIdle } from './helpers';

const LIVE = process.env.LEARN_AGENT_LIVE === '1';
const PAPER = path.join(FIXTURES, 'paper-100.pdf');
/** Detection reads the CLI's version and checks the login through the agent itself: a cold start of both takes a while. */
const DETECT_MS = 120_000;
/** A real answer that reads pages: start, tools, and the text. */
const ANSWER_MS = 240_000;

test.skip(!LIVE, 'a live run only (spec 16.4): LEARN_AGENT_LIVE=1, LEARN_AGENT_LIVE_HOME and LEARN_AGENT_LIVE_PATH');

test('the whole app with Claude Code: detected, chosen, and a question about paper-100.pdf answered with at least one verified page chip', async ({}, testInfo) => {
  test.setTimeout(DETECT_MS + ANSWER_MS + 120_000);
  const home = process.env.LEARN_AGENT_LIVE_HOME ?? '';
  const bins = process.env.LEARN_AGENT_LIVE_PATH ?? '';
  expect(home, 'LEARN_AGENT_LIVE_HOME: the Learn-only login folder').not.toBe('');
  expect(bins, 'LEARN_AGENT_LIVE_PATH: the folders of claude and claude-agent-acp').not.toBe('');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), {
    env: { LEARN_E2E_SETTINGS: '', LEARN_AGENT_LIVE: '1', LEARN_AGENT_LIVE_HOME: home, LEARN_AGENT_LIVE_PATH: bins, LEARN_AGENT_SEARCH_PATH: bins },
  });
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, 900));
    // The body text read first: the agent's page reads are what verify its citations.
    await importPaths(page, [PAPER]);
    await textExtraction(app, 'now');
    await textIdle(app);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);

    // 동의, then the chooser's real detection.
    await page.getByTestId('tutor-consent-agree').click();
    await expect(page.getByTestId('tutor-chooser')).toBeVisible();
    const claude = page.getByTestId('agent-row').and(page.locator('[data-agent="claude"]'));
    await expect(claude).toBeVisible({ timeout: DETECT_MS });
    await expect(page.getByTestId('agent-searching')).toHaveCount(0, { timeout: DETECT_MS });
    const state = (await claude.getByTestId('agent-flag').innerText()).trim();
    testInfo.annotations.push({ type: 'live: Claude Code', description: state });
    if (state === '로그인 필요') {
      const command = (await claude.getByTestId('agent-copy-text').innerText()).replace(/ /g, ' ');
      testInfo.annotations.push({ type: 'live: login needed', description: `the Learn-only folder is not logged in; run in a terminal: ${command}` });
      test.skip(true, 'Claude Code needs its Learn-only login: recorded, not failed');
      return;
    }
    expect(state, 'Claude Code is ready to answer').toBe('준비됨');
    await claude.click();
    await expect(page.getByTestId('agent-start')).toHaveText('Claude Code로 시작');
    await page.getByTestId('agent-start').click();
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    await expect(page.getByTestId('tutor-agent')).toHaveText('Claude Code');

    // One question from the composer, about what the pages say.
    const box = page.getByTestId('tutor-input');
    await box.click();
    await page.keyboard.insertText('이 자료의 1장은 무엇을 다루나요? 본문을 읽고, 근거가 된 쪽을 함께 알려 주세요.');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tutor-question')).toBeVisible();
    const answer = page.getByTestId('tutor-answer');
    await expect(answer).toHaveAttribute('data-status', /^(complete|failed|stopped)$/, { timeout: ANSWER_MS });
    const chips = answer.getByTestId('cite-chip');
    const cites = await chips.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-cite')}:${e.getAttribute('data-page')}`));
    testInfo.annotations.push({ type: 'live: answer', description: `status ${await answer.getAttribute('data-status')}; chips ${cites.join(' ') || 'none'}` });
    await expect(answer).toHaveAttribute('data-status', 'complete');
    expect(cites.filter((c) => c.startsWith('go:')).length, 'at least one verified page chip').toBeGreaterThanOrEqual(1);
  } finally {
    await app.close();
  }
});
