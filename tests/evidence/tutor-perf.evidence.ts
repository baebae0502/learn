// @perf — T1a spec 15 (tutor-perf.json): the tutor with the fake agent. A send to its user bubble and "답하는 중…" painted, on
// paper-100.pdf and on long-outline.pdf (300 outline entries, the send never waiting for their pages); a send to the answer's first
// text painted, the agent started ahead (learn:tutor:send → learn:tutor:first-text-paint); the frames while 6,000 characters stream
// in at 60 pieces a second with 20 citations — from the turn's first text notice to its last — and the long tasks among them, with
// what they were; the redraw at the answer's end, reported apart and not gated; the fake agent's start to its initialize
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

/** A long task (over 50 ms) and what it was: the browser's attribution, and the scripts of the long frames it falls in. */
interface LongTask {
  atMs: number;
  durationMs: number;
  attribution: Array<{ name: string; containerType: string; containerName: string; containerSrc: string }>;
  scripts: Array<{ invoker: string; fn: string; at: string; ms: number }>;
}
/** One streamed answer, as the page saw it. */
interface Stream {
  /** rAF gaps whose frame fell between the first and the last text notice of the turn: the streaming itself. */
  gaps: number[];
  /** Long tasks that overlap the streaming. */
  longTasks: LongTask[];
  /** The 500 ms after the turn's end notice: the bubble drawn again from the stored answer (20 chips). */
  end: { longestTaskMs: number; longestGapMs: number; longTasks: LongTask[] };
  /** The long animation frames over the whole turn, where a long frame's time went. */
  longFrames: LongFrame[];
  notices: { text: number; spanMs: number };
}

/**
 * One streamed answer (the fake's stream: 6,000 characters at 60 pieces a second, 20 cites). The window that counts is the streaming
 * itself, from the turn's first text notice to its last (T1a spec 15 "받는 동안"); the end notice's redraw from the stored answer is timed
 * apart, over the 500 ms after it. Every long task is kept with its attribution and the scripts of the long frames it falls in.
 */
async function streamFrames(page: Page): Promise<Stream> {
  await composer(page).click();
  await page.keyboard.insertText('긴 답을 흘려 보내 주세요.');
  await page.evaluate(() => {
    type Loaf = PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; blockingDuration: number; scripts: LongFrame['scripts'] };
    type Attribution = PerformanceEntry & { containerType: string; containerName: string; containerSrc: string };
    type Task = PerformanceEntry & { attribution?: Attribution[] };
    const w = window as unknown as { __tutorStream: Promise<Stream>; learn: { on(name: 'tutor:turn', cb: (e: { kind: string }) => void): () => void } };
    w.__tutorStream = new Promise((resolve) => {
      const frames: number[] = [];
      const tasks: Array<{ startTime: number; duration: number; attribution: LongTask['attribution'] }> = [];
      const longFrames: LongFrame[] = [];
      const texts: number[] = [];
      let doneAt = 0;
      const taskObserver = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as Task[]) {
          tasks.push({ startTime: e.startTime, duration: e.duration, attribution: (e.attribution ?? []).map((a) => ({ name: a.name, containerType: a.containerType, containerName: a.containerName, containerSrc: a.containerSrc })) });
        }
      });
      taskObserver.observe({ type: 'longtask' });
      const loaf = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
        ? new PerformanceObserver((list) => {
            for (const e of list.getEntries() as Loaf[]) {
              longFrames.push({ startTime: e.startTime, duration: e.duration, renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, blockingDuration: e.blockingDuration, scripts: e.scripts.map((x) => ({ invoker: x.invoker, invokerType: x.invokerType, sourceFunctionName: x.sourceFunctionName, sourceURL: x.sourceURL, sourceCharPosition: x.sourceCharPosition, startTime: x.startTime, duration: x.duration, forcedStyleAndLayoutDuration: x.forcedStyleAndLayoutDuration })) });
            }
          })
        : null;
      loaf?.observe({ type: 'long-animation-frame' });
      const stop = w.learn.on('tutor:turn', (e) => {
        if (e.kind === 'text') texts.push(performance.now());
        if ((e.kind === 'done' || e.kind === 'failed') && doneAt === 0) doneAt = performance.now();
      });
      const describe = (t: { startTime: number; duration: number; attribution: LongTask['attribution'] }, origin: number): LongTask => ({
        atMs: Math.round(t.startTime - origin),
        durationMs: Math.round(t.duration),
        attribution: t.attribution,
        scripts: longFrames
          .filter((f) => f.startTime < t.startTime + t.duration && f.startTime + f.duration > t.startTime)
          .flatMap((f) => f.scripts)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((x) => ({ invoker: x.invoker, fn: x.sourceFunctionName, at: `${x.sourceURL.split('/').pop() ?? ''}:${x.sourceCharPosition}`, ms: Math.round(x.duration) })),
      });
      const step = (t: number) => {
        frames.push(t);
        if (doneAt !== 0 && t > doneAt + 500) {
          // Observers deliver a frame's entries after it: the last ones are let in before the windows close.
          setTimeout(() => {
            stop();
            taskObserver.disconnect();
            loaf?.disconnect();
            const [first, last] = [texts[0] ?? doneAt, texts.at(-1) ?? doneAt];
            const gaps = frames.flatMap((at, i) => (i > 0 && frames[i - 1]! >= first && at <= last ? [at - frames[i - 1]!] : []));
            const over = (from: number, to: number) => tasks.filter((x) => x.startTime < to && x.startTime + x.duration > from && x.duration > 50);
            const endTasks = over(doneAt, doneAt + 500);
            const endGaps = frames.flatMap((at, i) => (i > 0 && at > doneAt && at <= doneAt + 500 ? [at - frames[i - 1]!] : []));
            resolve({
              gaps,
              longTasks: over(first, last).map((x) => describe(x, first)),
              end: { longestTaskMs: Math.round(Math.max(0, ...endTasks.map((x) => x.duration))), longestGapMs: Math.round(Math.max(0, ...endGaps)), longTasks: endTasks.map((x) => describe(x, doneAt)) },
              longFrames: longFrames.filter((f) => f.startTime + f.duration >= first),
              notices: { text: texts.length, spanMs: Math.round(last - first) },
            });
          }, 300);
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  await page.keyboard.press('Enter');
  return page.evaluate(() => (window as unknown as { __tutorStream: Promise<Stream> }).__tutorStream);
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
    // Each question in a session of its own (새 세션 between them): a session's first question, whose answer is drawn as it comes too.
    const outlineBubble: number[] = [];
    const newSessionFirstText: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      if (i > 0) {
        await page.getByTestId('tutor-new-session').click();
        await expect(page.getByTestId('tutor-empty')).toBeVisible();
      }
      const r = await sendAndTime(page, `목차 질문 ${i + 1}: 이 부분은 어디에 있나요?`);
      outlineBubble.push(r.bubbleMs);
      expect(r.firstTextMs, `new session ${i + 1}: its first answer was drawn as it came`).not.toBeNull();
      newSessionFirstText.push(r.firstTextMs!);
    }
    const outlineAfter = await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { outline: { resolvedUpTo: number; flat: unknown[] } | null } } }).__learnReader.getState().outline);
    expect(outlineAfter, 'the tutor resolved the long outline\'s 300 entries').toMatchObject({ resolvedUpTo: 300 });

    // ---- The frames while an answer of 6,000 characters streams in at 60 pieces a second, 20 citations ----
    await readerTab(page, paper!.id).click();
    await expect(page.getByTestId('tutor-log')).toBeVisible();
    await tutorFakeScript(app, 'stream');
    const gaps: number[] = [];
    const longTasks: LongTask[] = [];
    const longFrames: LongFrame[] = [];
    const endRedraw: Stream['end'][] = [];
    const notices: Stream['notices'][] = [];
    for (let i = 0; i < STREAMS; i++) {
      const f = await streamFrames(page);
      // main sends the text in batches of 33 ms: the 100 pieces come as some 30–50 notices over about 1.7 s.
      expect(f.notices.text, 'the answer came in its pieces').toBeGreaterThan(20);
      expect(f.gaps.length, 'frames were counted while the answer came in').toBeGreaterThan(30);
      gaps.push(...f.gaps);
      longTasks.push(...f.longTasks);
      longFrames.push(...f.longFrames);
      endRedraw.push(f.end);
      notices.push(f.notices);
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
      streamFrameMs: { ...spread(gaps), notices },
      streamLongTasks: longTasks,
      endRedraw: { longestTaskMs: Math.max(...endRedraw.map((e) => e.longestTaskMs)), longestGapMs: Math.max(...endRedraw.map((e) => e.longestGapMs)), runs: endRedraw },
      longFrames: { count: longFrames.length, longest: summarizeLongFrames(longFrames, [], 0).slice(0, 5) },
      sendToFirstTextNewSessionMs: spread(newSessionFirstText),
      initializeMs: spread(initialize),
      askMainMs: spread(askMain),
      readPagesMainMs: spread(readPages),
      fakeAgentRssMB: rssKB === null ? null : tenth(rssKB / 1024),
      overBudget: Object.entries(values).filter(([k, v]) => v > BUDGET[k as keyof typeof BUDGET]).map(([k]) => k),
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('tutor-perf.json', result, 'T1a tutor (fake agent): send → bubble (paper-100; long-outline, each a new session), send → first text, the frames and long tasks while an answer streams (first to last text notice) and the end redraw apart, the agent\'s start → initialize, tutor:ask and read_pdf_pages in main, the fake agent\'s RSS');
    console.log('[measure] tutor-perf', JSON.stringify({ values, endRedraw: { longestTaskMs: result.endRedraw.longestTaskMs, longestGapMs: result.endRedraw.longestGapMs }, newSessionFirstTextP95: result.sendToFirstTextNewSessionMs.p95, fakeAgentRssMB: result.fakeAgentRssMB, outlineResolvedAtFirstSend: resolvedAtFirstSend }));

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
