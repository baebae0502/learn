// @perf — T1a spec 15 (tutor-perf.json): the tutor with the fake agent. A send to its user bubble and "답하는 중…" painted, on
// paper-100.pdf and on long-outline.pdf (300 outline entries, the send never waiting for their pages); a send to the answer's first
// text painted, the agent started ahead (learn:tutor:send → learn:tutor:first-text-paint); the frames while 6,000 characters stream
// in at 60 pieces a second with 20 citations, and the long tasks among them; the fake agent's start to its initialize
// answer, tutor:ask in main up to its rows, and read_pdf_pages of 5 pages × 4,000 characters in main (__learnLastMs); the fake
// agent's RSS. Linux CI fails beyond twice each budget (budget.ts); every other run reports.
//
// Ends are states of the page: the first animation frame in which the DOM holds what the action leads to. Starts are the ↩'s own
// keydown timeStamp in the page, or the app's own marks.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, backFromReader, importPaths, launch, mainWindow, openItem, readerTab, seedBodyText, textExtraction, textIdle, tutorFakeLog, tutorFakeScript, tutorProcesses } from '../e2e/helpers';
import { askViaApi, consentAndChoose, turnEnded } from '../e2e/tutor-helpers';
import { limitFailures, type Limit } from './budget';
import { writeJson } from './capture';
import { summarizeLongFrames, type LongFrame } from './long-frames';
import { spread, tenth } from './p1-perf-math';

/** T1a spec 15; ms unless the name says otherwise. */
const BUDGET = {
  sendToBubbleP95: 100,
  sendToBubbleLongOutlineP95: 100,
  sendToFirstTextP95: 500,
  streamFrameP95: 16.7,
  streamLongTasks: 0,
  initializeP95: 800,
  askMainP95: 20,
  readPagesMainP95: 20,
} as const;
const RUNS = 20;
const STREAMS = 3;
const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const LONG_OUTLINE = path.join(FIXTURES, 'long-outline.pdf');

type LastMs = Partial<Record<'tutorAsk' | 'tutorInitialize' | 'tutorReadPages', number>>;
const lastMs = (app: ElectronApplication): Promise<LastMs> => app.evaluate(() => ({ ...((globalThis as { __learnLastMs?: LastMs }).__learnLastMs ?? {}) }));
const forget = (app: ElectronApplication, step: keyof LastMs) => app.evaluate((_e, k) => void delete (globalThis as unknown as { __learnLastMs: LastMs }).__learnLastMs[k], step);
/** The newest time of `step` once it has one again (forget it first). */
async function newest(app: ElectronApplication, step: keyof LastMs): Promise<number> {
  let v: number | undefined;
  await expect.poll(async () => (v = (await lastMs(app))[step]) !== undefined, { message: `__learnLastMs.${step}`, timeout: 30_000 }).toBe(true);
  return v!;
}

const composer = (page: Page) => page.getByTestId('tutor-input');

/**
 * One question sent with ↩ from the composer: from the key's own timeStamp to the first frame that shows one more user bubble and
 * "답하는 중…"; then the answer waited out. Also the app's marks from the send to the answer's first text painted.
 */
async function sendAndTime(page: Page, text: string): Promise<{ bubbleMs: number; firstTextMs: number | null }> {
  await composer(page).click();
  await page.keyboard.insertText(text);
  await expect(composer(page)).toHaveValue(text);
  await page.evaluate(() => {
    performance.clearMarks('learn:tutor:send');
    performance.clearMarks('learn:tutor:first-text-paint');
    const w = window as unknown as { __tutorSend: Promise<number> };
    const before = document.querySelectorAll('[data-testid="tutor-question"]').length;
    w.__tutorSend = new Promise<number>((resolve) => {
      let pressedAt = 0;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter') pressedAt = e.timeStamp;
      };
      addEventListener('keydown', onKey, { capture: true, once: true });
      const shown = () => document.querySelectorAll('[data-testid="tutor-question"]').length > before && document.querySelector('[data-testid="tutor-answering"]') !== null;
      const watch = new MutationObserver(() => {
        if (!shown()) return;
        watch.disconnect();
        requestAnimationFrame(() => resolve(performance.now() - pressedAt));
      });
      watch.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    });
  });
  await page.keyboard.press('Enter');
  const bubbleMs = await page.evaluate(() => (window as unknown as { __tutorSend: Promise<number> }).__tutorSend);
  await expect(page.getByTestId('tutor-answer').last()).toHaveAttribute('data-status', 'complete', { timeout: 60_000 });
  const marks = await page.evaluate(() => {
    const at = (n: string) => performance.getEntriesByName(`learn:${n}`).at(-1)?.startTime ?? null;
    return { sent: at('tutor:send'), painted: at('tutor:first-text-paint') };
  });
  const firstTextMs = marks.sent === null || marks.painted === null ? null : marks.painted - marks.sent;
  return { bubbleMs, firstTextMs };
}

/**
 * The frames while one streamed answer comes in: rAF gaps from its first text to its end, the long tasks meanwhile (over 50 ms, the
 * budget's "긴 작업"), and the long animation frames, which say where a long frame's time went.
 */
async function streamFrames(page: Page): Promise<{ gaps: number[]; longTasks: number[]; longFrames: LongFrame[] }> {
  await composer(page).click();
  await page.keyboard.insertText('긴 답을 흘려 보내 주세요.');
  const answers = await page.getByTestId('tutor-answer').count();
  await page.evaluate((n) => {
    type Loaf = PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; blockingDuration: number; scripts: LongFrame['scripts'] };
    const w = window as unknown as { __tutorFrames: Promise<{ gaps: number[]; longTasks: number[]; longFrames: LongFrame[] }> };
    w.__tutorFrames = new Promise((resolve) => {
      const longFrames: LongFrame[] = [];
      const longTasks: Array<{ startTime: number; duration: number }> = [];
      const tasks = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longTasks.push({ startTime: e.startTime, duration: e.duration });
      });
      const loaf = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
        ? new PerformanceObserver((list) => {
            for (const e of list.getEntries() as Loaf[]) {
              longFrames.push({ startTime: e.startTime, duration: e.duration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, blockingDuration: e.blockingDuration, scripts: e.scripts.map((x) => ({ invoker: x.invoker, invokerType: x.invokerType, sourceFunctionName: x.sourceFunctionName, sourceURL: x.sourceURL, sourceCharPosition: x.sourceCharPosition, startTime: x.startTime, duration: x.duration, forcedStyleAndLayoutDuration: x.forcedStyleAndLayoutDuration })) });
            }
          })
        : null;
      const gaps: number[] = [];
      let last = 0;
      let from = 0;
      const step = (t: number) => {
        const answer = document.querySelectorAll('[data-testid="tutor-answer"]')[n];
        const text = answer?.querySelector('[data-testid="tutor-answer-text"]')?.textContent ?? '';
        if (from === 0 && text !== '') {
          from = t;
          loaf?.observe({ type: 'long-animation-frame' });
          tasks.observe({ type: 'longtask' });
        }
        if (from !== 0 && last !== 0) gaps.push(t - last);
        if (from !== 0) last = t;
        if (answer?.getAttribute('data-status') === 'complete') {
          // Observers deliver a frame's entries after it: the last ones are let in before the window closes.
          setTimeout(() => {
            loaf?.disconnect();
            tasks.disconnect();
            resolve({ gaps, longTasks: longTasks.filter((x) => x.startTime + x.duration >= from && x.duration > 50).map((x) => Math.round(x.duration)), longFrames: longFrames.filter((f) => f.startTime + f.duration >= from) });
          }, 300);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, answers);
  await page.keyboard.press('Enter');
  return page.evaluate(() => (window as unknown as { __tutorFrames: Promise<{ gaps: number[]; longTasks: number[]; longFrames: LongFrame[] }> }).__tutorFrames);
}

test('the tutor with the fake agent: send → bubble and first text, streaming frames, the agent\'s start, main\'s ask and page reads, its RSS', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(900_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { env: { LEARN_E2E_SETTINGS: '' } });
  const { app, page } = s;
  try {
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1440, 900));
    const [paper, outline] = await importPaths(page, [PAPER, LONG_OUTLINE]);
    await textExtraction(app, 'now');
    await textIdle(app);
    const seeded = await seedBodyText(app, { docs: 1, pages: 100, chars: 4000, seed: 19 });
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', '100');
    await consentAndChoose(page, 'fake');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();

    // ---- Send → bubble and → first text on paper-100.pdf, the agent started ahead; main's tutor:ask with each ----
    // One question first, not counted: the session, the process and the code paths are warm after it.
    await sendAndTime(page, '이 자료는 무엇을 다루나요?');
    const paperBubble: number[] = [];
    const firstText: number[] = [];
    const askMain: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await forget(app, 'tutorAsk');
      const r = await sendAndTime(page, `질문 ${i + 1}: 이 쪽의 요점은 무엇인가요?`);
      paperBubble.push(r.bubbleMs);
      expect(r.firstTextMs, `run ${i + 1} marked its send and its first text`).not.toBeNull();
      firstText.push(r.firstTextMs!);
      askMain.push(await newest(app, 'tutorAsk'));
    }

    // ---- Send → bubble on long-outline.pdf: the tab's first question goes at once, its 300 entries' pages still resolving or not ----
    await backFromReader(page);
    await openItem(page, 'long-outline');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', '6');
    await expect(page.getByTestId('tutor-empty')).toBeVisible();
    const resolvedAtFirstSend = await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { outline: { resolvedUpTo: number } | null } } }).__learnReader.getState().outline?.resolvedUpTo ?? null);
    const outlineBubble: number[] = [];
    for (let i = 0; i < RUNS; i++) outlineBubble.push((await sendAndTime(page, `목차 질문 ${i + 1}: 이 부분은 어디에 있나요?`)).bubbleMs);
    const outlineAfter = await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { outline: { resolvedUpTo: number; flat: unknown[] } | null } } }).__learnReader.getState().outline);
    expect(outlineAfter, 'the tutor resolved the long outline\'s 300 entries').toMatchObject({ resolvedUpTo: 300 });

    // ---- The frames while an answer of 6,000 characters streams in at 60 pieces a second, 20 citations ----
    await readerTab(page, paper!.id).click();
    await expect(page.getByTestId('tutor-log')).toBeVisible();
    await tutorFakeScript(app, 'stream');
    const gaps: number[] = [];
    const longTasks: number[] = [];
    const longFrames: LongFrame[] = [];
    for (let i = 0; i < STREAMS; i++) {
      const f = await streamFrames(page);
      expect(f.gaps.length, 'frames were counted while the answer came in').toBeGreaterThan(30);
      gaps.push(...f.gaps.slice(1));
      longTasks.push(...f.longTasks);
      longFrames.push(...f.longFrames);
    }
    const cites = await page.getByTestId('tutor-answer').last().getByTestId('cite-chip').count();
    expect(cites, 'the streamed answer carries its 20 citations').toBe(20);

    // ---- read_pdf_pages of 5 pages × 4,000 characters in main: the seeded item, 5 new pages a question, one session ----
    const readPages: number[] = [];
    let conversationId: string | null = null;
    for (let i = 0; i < RUNS; i++) {
      await forget(app, 'tutorReadPages');
      const asked = await askViaApi(page, {
        itemId: seeded.itemIds[0]!, conversationId, text: `읽기 ${i + 1}`, selection: null,
        reader: { pageIndex: i * 5, pageCount: 100, outline: [], outlineComplete: true, outlineTotal: 0 },
      });
      if ('busyWith' in asked) throw new Error('tutor.ask on the seeded item waited for another answer');
      conversationId = asked.conversationId;
      const ended = await turnEnded(page, asked.conversationId, asked.tutorMessageId);
      expect(ended.tools.filter((t) => t.tool === 'read_pdf_pages').map((t) => [t.outcome, t.pageFrom, t.pageTo]), `run ${i + 1} read its 5 new pages`).toEqual([['ok', i * 5, i * 5 + 4]]);
      readPages.push(await newest(app, 'tutorReadPages'));
    }

    // ---- The fake agent's start → its initialize answer: the idle one closed, the composer's focus starts the next ----
    await tutorFakeScript(app, 'answer');
    const initialize: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      await tutorFakeScript(app, 'answer');
      await expect.poll(async () => (await tutorProcesses(app)).count).toBe(0);
      await forget(app, 'tutorInitialize');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await composer(page).focus();
      initialize.push(await newest(app, 'tutorInitialize'));
    }

    // ---- The fake agent's RSS: the process the last start left running ----
    await expect.poll(async () => (await tutorProcesses(app)).count).toBe(1);
    const env = (await tutorFakeLog(app)).filter((e) => e.t === 'env').at(-1) as { pid: number } | undefined;
    let rssKB: number | null = null;
    try {
      rssKB = env ? Number(execFileSync('ps', ['-o', 'rss=', '-p', String(env.pid)], { encoding: 'utf8' }).trim()) || null : null;
    } catch {
      rssKB = null; // the process ended meanwhile: reported as unknown
    }

    const p95 = (xs: number[]) => spread(xs).p95;
    const values = {
      sendToBubbleP95: p95(paperBubble),
      sendToBubbleLongOutlineP95: p95(outlineBubble),
      sendToFirstTextP95: p95(firstText),
      streamFrameP95: p95(gaps),
      streamLongTasks: longTasks.length,
      initializeP95: p95(initialize),
      askMainP95: p95(askMain),
      readPagesMainP95: p95(readPages),
    };
    const result = {
      budgetMs: BUDGET,
      values,
      sendToBubbleMs: spread(paperBubble),
      sendToBubbleLongOutlineMs: { ...spread(outlineBubble), outlineResolvedAtFirstSend: resolvedAtFirstSend, outlineEntries: outlineAfter?.flat.length ?? null },
      sendToFirstTextMs: spread(firstText),
      streamFrameMs: spread(gaps),
      longTasksMs: longTasks,
      longFrames: { count: longFrames.length, longest: summarizeLongFrames(longFrames, [], 0).slice(0, 5) },
      initializeMs: spread(initialize),
      askMainMs: spread(askMain),
      readPagesMainMs: spread(readPages),
      fakeAgentRssMB: rssKB === null ? null : tenth(rssKB / 1024),
      overBudget: Object.entries(values).filter(([k, v]) => v > BUDGET[k as keyof typeof BUDGET]).map(([k]) => k),
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('tutor-perf.json', result, 'T1a tutor (fake agent): send → bubble (paper-100, long-outline), send → first text, streaming frames and long frames, the agent\'s start → initialize, tutor:ask and read_pdf_pages in main, the fake agent\'s RSS');
    console.log('[measure] tutor-perf', JSON.stringify({ values, fakeAgentRssMB: result.fakeAgentRssMB, outlineResolvedAtFirstSend: resolvedAtFirstSend }));

    if (process.platform === 'linux' && process.env['CI']) {
      const limits: Limit[] = [
        { what: 'send → user bubble and 답하는 중… p95 (paper-100.pdf)', value: values.sendToBubbleP95, budget: BUDGET.sendToBubbleP95 },
        { what: 'send → user bubble and 답하는 중… p95 (long-outline.pdf, 300 entries)', value: values.sendToBubbleLongOutlineP95, budget: BUDGET.sendToBubbleLongOutlineP95 },
        { what: 'send → first answer text painted p95 (agent started ahead)', value: values.sendToFirstTextP95, budget: BUDGET.sendToFirstTextP95 },
        { what: 'frame gap p95 while an answer streams', value: values.streamFrameP95, budget: BUDGET.streamFrameP95 },
        { what: 'long tasks (over 50 ms) while an answer streams', value: values.streamLongTasks, budget: BUDGET.streamLongTasks, unit: 'tasks' },
        { what: 'fake agent start → initialize answer p95', value: values.initializeP95, budget: BUDGET.initializeP95 },
        { what: 'tutor:ask in main up to its rows p95', value: values.askMainP95, budget: BUDGET.askMainP95 },
        { what: 'read_pdf_pages of 5 pages × 4,000 characters in main p95', value: values.readPagesMainP95, budget: BUDGET.readPagesMainP95 },
      ];
      expect(limitFailures(limits)).toEqual([]);
    }
  } finally {
    await app.close();
  }
});
