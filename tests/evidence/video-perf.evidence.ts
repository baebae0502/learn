// @perf — M8a spec 14 (video-perf.json): the transcript pane over long-2000.srt (2,000 cues) beside lecture-60s.mp4.
//   1. the list's scroll, follow off: the gaps between animation frames while the list scrolls (p95 ≤ 16.7 ms);
//   2. 2× playback for 20 s with the switch on and the overlay showing: the same gaps (p95 ≤ 16.7 ms);
//   3. a cue's switch → the overlay's text painted, at 1× speed: for each of the 40 cues of the video, the lag from the first video frame
//      whose media time reached the cue's start (requestVideoFrameCallback's `now`) to the start of the first animation frame after the
//      overlay's DOM change (a MutationObserver's callback asks for it): the frame that paints the change. The DOM change itself is
//      reported beside it. The page's own probes, nothing added to the app (p95 ≤ one frame, 16.7 ms);
//   4. the transcript search: `learn:transcript:search` (the debounce is over, the search begins) → `learn:transcript:painted` (the frame
//      that paints its matches), p95 ≤ 50 ms. The input → painted time, 150 ms of debounce included, is reported beside it.
// Linux CI fails beyond twice each budget (budget.ts); every other run reports.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, openItem, stubOpenDialog, videoReady } from '../e2e/helpers';
import { VIDEO_BUDGET_MS, limitFailures, videoLimits } from './budget';
import { EVIDENCE_ROOT, writeJson } from './capture';
import { frameGaps } from './reader-perf-math';
import { spread, tenth } from './p1-perf-math';
import { cueSwitchLags, type OverlayChange, type VideoFrame } from './video-perf-math';

const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
const RESULT = 'video-perf.json';
const LECTURE = path.join(FIXTURES, 'lecture-60s.mp4');
const LONG = path.join(FIXTURES, 'long-2000.srt');
/** The scroll: pixels per animation frame, over this many frames. */
const SCROLL_PX_PER_FRAME = 60;
const SCROLL_FRAMES = 360;
const PLAY_MS = 20_000;
/** long-2000.srt: a cue every 1.5 s, 1.2 s long, from 0. */
const CUE_STEP_MS = 1500;
/** The search: typed one character at a time (each past the 150 ms debounce), then erased. */
const QUERY = '세포막의 운반 단백질은';

function readSaved(): Record<string, unknown> {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, RESULT), 'utf8')) as Record<string, unknown>;
    return old['run'] === process.ppid ? old : {};
  } catch {
    return {};
  }
}
/** Merged into video-perf.json after each test: a worker restarted after a failure keeps the sections before it. */
function save(patch: Record<string, unknown>): void {
  writeJson(
    RESULT,
    {
      ...readSaved(), ...patch, run: process.ppid, budgetMs: VIDEO_BUDGET_MS, linuxCiFactor: 2,
      linuxCiLimitMs: Object.fromEntries(Object.entries(VIDEO_BUDGET_MS).map(([k, v]) => [k, tenth(v * 2)])),
      platform: `${process.platform}-${process.arch}`, ci: process.env['CI'] ?? null, updatedAt: new Date().toISOString(),
    },
    'M8a spec 14: the transcript pane — list scroll frames (follow off), 2× playback frames with follow and overlay, cue switch → overlay text, transcript search → matches painted',
  );
}

/** The lecture opened with the 2,000-sentence track attached and shown. */
async function openLong(page: Page, app: Parameters<typeof stubOpenDialog>[0]): Promise<void> {
  await importPaths(page, [LECTURE]);
  await openItem(page, 'lecture-60s');
  await videoReady(page);
  await stubOpenDialog(app, [LONG]);
  await page.getByTestId('subtitles-menu').click();
  await page.getByTestId('subtitle-add').click();
  await expect(page.getByTestId('transcript')).toHaveAttribute('data-count', '2000');
  await expect.poll(async () => (await page.evaluate(() => window.__learnVideo!.state()))?.trackId).not.toBeNull();
}

test.beforeAll(() => {
  for (const f of [LECTURE, LONG]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

test('video budgets @1: the transcript list\'s scroll frames (2,000 cues, follow off) and the search input → matches painted', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 120_000 : 180_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openLong(page, app);

    // 1. Scroll: a constant distance on every animation frame; the gaps between the frames' own times. The switch is off first, so
    //    the list only does what the scroll asks of it.
    await page.getByTestId('transcript-follow').click();
    await expect(page.getByTestId('transcript-follow')).not.toHaveAttribute('data-selected');
    const stamps = await page.evaluate(
      async ({ px, frames }) => {
        const scroller = document.querySelector<HTMLElement>('[data-testid="transcript"]')!;
        const out: number[] = [];
        scroller.scrollTop = 0;
        await new Promise((r) => requestAnimationFrame(r));
        return await new Promise<number[]>((resolve) => {
          const step = (t: number) => {
            out.push(t);
            scroller.scrollTop += px;
            if (out.length >= frames) resolve(out);
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      },
      { px: SCROLL_PX_PER_FRAME, frames: SCROLL_FRAMES },
    );
    const moved = await page.getByTestId('transcript').evaluate((el) => el.scrollTop);
    expect(moved, 'the list scrolled the distance asked').toBeGreaterThanOrEqual(SCROLL_PX_PER_FRAME * SCROLL_FRAMES * 0.9);
    const gaps = frameGaps(stamps);
    save({ transcriptScroll: { ...spread(gaps), frames: stamps.length, pxPerFrame: SCROLL_PX_PER_FRAME, over33ms: gaps.filter((g) => g > 33.4).length } });

    // 4. Search: one character at a time in the field, then erased; each input waits for the frame that paints its matches.
    await page.getByTestId('transcript').evaluate((el) => (el.scrollTop = 0));
    const field = page.getByTestId('transcript-search').getByRole('searchbox');
    await field.focus();
    await page.evaluate(() => {
      const w = window as unknown as { __inputs: number[] };
      w.__inputs = [];
      document.addEventListener('input', (e) => w.__inputs.push(e.timeStamp), true);
    });
    interface Step { inputToPaint: number; searchToPaint: number | null }
    const steps: Step[] = [];
    // `searches`: the query is not empty after the input, so a search runs (an empty query clears at once, with no search to time).
    const measure = async (act: () => Promise<void>, searches = true): Promise<void> => {
      const before = await page.evaluate(() => (window as unknown as { __inputs: number[] }).__inputs.length);
      const since = await page.evaluate(() => performance.now());
      await act();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __inputs: number[] }).__inputs.length)).toBe(before + 1);
      const marks = await page
        .waitForFunction(
          ({ since, searches }) => {
            const find = (name: string) => performance.getEntriesByName(`learn:${name}`).map((e) => e.startTime).filter((t) => t > since);
            const search = find('transcript:search');
            const painted = find('transcript:painted');
            if (painted.length === 0) return null;
            const last = painted[painted.length - 1]!;
            if (!searches) return { search: last, painted: last };
            return search.length > 0 && last > search[search.length - 1]! ? { search: search[search.length - 1]!, painted: last } : null;
          },
          { since, searches },
          { timeout: 5000 },
        )
        .then((h) => h.jsonValue() as Promise<{ search: number; painted: number }>);
      const input = await page.evaluate((i) => (window as unknown as { __inputs: number[] }).__inputs[i]!, before);
      steps.push({ inputToPaint: marks.painted - input, searchToPaint: searches ? marks.painted - marks.search : null });
    };
    // Warm-up: the first search over the list loads the engine's paths and is not timed.
    await field.pressSequentially('세');
    await expect(page.getByTestId('transcript-count')).toHaveText('2000개');
    await field.press('Backspace');
    await expect(page.getByTestId('transcript-count')).toHaveCount(0);
    for (const ch of [...QUERY]) await measure(() => page.keyboard.insertText(ch));
    await expect(page.getByTestId('transcript-count')).toHaveText('2000개');
    for (let i = 0; i < QUERY.length; i++) await measure(() => page.keyboard.press('Backspace'), i < QUERY.length - 1);
    expect(steps.length).toBe(QUERY.length * 2);
    const searchMs = steps.flatMap((s) => (s.searchToPaint === null ? [] : [s.searchToPaint]));
    save({
      transcriptSearch: { ...spread(searchMs), inputToPaint: spread(steps.map((s) => s.inputToPaint)), debounceMs: 150, how: 'searchToPaint is learn:transcript:search → learn:transcript:painted; inputToPaint adds the debounce' },
    });
  } finally {
    await app.close();
  }
});

test('video budgets @2: 2× playback for 20 s with follow and the overlay (frame gaps), and the 40 cue switches → the overlay\'s text', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 150_000 : 240_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openLong(page, app);
    // 2×: the speed menu, as the owner sets it.
    await page.getByTestId('video-speed').click();
    await page.getByTestId('video-speed-2').click();
    await expect(page.getByTestId('video-speed')).toHaveText('2×');
    await expect(page.getByTestId('transcript-follow')).toHaveAttribute('data-selected');

    // 2. Play from the start for 20 s: every animation frame's gap, with the list following and the overlay changing every 1.5 media seconds.
    await page.getByTestId('video-stage').focus();
    const play = page.evaluate(
      async (ms) => {
        const v = document.querySelector<HTMLVideoElement>('[data-testid="video"]')!;
        const stamps: number[] = [];
        const shown = new Set<string>();
        return await new Promise<{ stamps: number[]; shown: number; endTime: number }>((resolve) => {
          void v.play();
          const t0 = performance.now();
          const step = (t: number) => {
            stamps.push(t);
            const text = document.querySelector('[data-testid="subtitle-overlay"]')?.textContent;
            if (text) shown.add(text);
            if (t - t0 >= ms) resolve({ stamps, shown: shown.size, endTime: v.currentTime });
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      },
      PLAY_MS,
    );
    const played = await play;
    expect(played.endTime, 'the video played on at 2×').toBeGreaterThan(30);
    expect(played.shown, 'the overlay changed with the cues').toBeGreaterThan(15);
    await expect(page.getByTestId('transcript-follow')).toHaveAttribute('data-selected');
    const gaps = frameGaps(played.stamps);
    save({ playingFollow: { ...spread(gaps), frames: played.stamps.length, overlayTextsSeen: played.shown, mediaSeconds: tenth(played.endTime), over33ms: gaps.filter((g) => g > 33.4).length } });
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="video"]')!.pause());

    // 3. The 40 cue switches, at 1×. The page's own probes: every presented video frame (requestVideoFrameCallback: when its callback ran
    //    and its media time) and every change of the overlay's text (MutationObserver: when the DOM was changed and, from the next animation
    //    frame, when that frame began: the one that paints it, and to what).
    await page.getByTestId('video-speed').click();
    await page.getByTestId('video-speed-1').click();
    await expect(page.getByTestId('video-speed')).toHaveText('1×');
    await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="video"]')!;
      const box = document.querySelector('[data-testid="subtitle-box"]')!;
      const w = window as unknown as { __frames: Array<{ now: number; mediaTime: number }>; __changes: Array<{ at: number; dom: number; text: string }> };
      w.__frames = [];
      w.__changes = [];
      const loop = (now: number, meta: VideoFrameCallbackMetadata) => {
        w.__frames.push({ now, mediaTime: meta.mediaTime });
        v.requestVideoFrameCallback(loop);
      };
      v.requestVideoFrameCallback(loop);
      new MutationObserver(() => {
        const text = box.textContent ?? '';
        if (text === '' || w.__changes[w.__changes.length - 1]?.text === text) return;
        const dom = performance.now();
        const change = { at: dom, dom, text };
        w.__changes.push(change);
        requestAnimationFrame((frame) => (change.at = frame));
      }).observe(box, { childList: true, subtree: true, characterData: true });
      v.currentTime = 0.2;
    });
    await expect.poll(async () => (await page.evaluate(() => window.__learnVideo!.state()))!.timeMs).toBeLessThan(500);
    await page.evaluate(() => void document.querySelector<HTMLVideoElement>('[data-testid="video"]')!.play());
    // To the end of the 60 s (40 cues, the first at 0 s is before the probes).
    await expect.poll(async () => (await page.evaluate(() => window.__learnVideo!.state()))!.timeMs, { timeout: 60_000, intervals: [500] }).toBeGreaterThan(59_000);
    const { frames, changes } = await page.evaluate(() => {
      const w = window as unknown as { __frames: VideoFrame[]; __changes: Array<OverlayChange & { dom: number }> };
      return { frames: w.__frames, changes: w.__changes };
    });
    const starts = Array.from({ length: 39 }, (_, i) => ({ startMs: (i + 1) * CUE_STEP_MS, lead: `${i + 2}번째 문장` }));
    const lags = cueSwitchLags(frames, changes, starts);
    const domLags = cueSwitchLags(frames, changes.map((c) => ({ at: c.dom, text: c.text })), starts);
    expect(lags.length, 'a frame and an overlay change were seen for nearly every cue').toBeGreaterThanOrEqual(36);
    save({ cueSwitch: { ...spread(lags), cues: lags.length, early: lags.filter((l) => l < 0).length, over16_7ms: lags.filter((l) => l > 16.7).length, speed: '1×', domChange: spread(domLags), how: 'lag = start of the first animation frame after the overlay\'s DOM change (the frame that paints it) − the callback time of the first video frame whose mediaTime reached the cue start; domChange is the same to the DOM change itself' } });

    // The verdict for the whole file, once every section is in.
    const all = readSaved() as Record<string, { p95?: number } | undefined>;
    const values = {
      transcriptScrollP95: all['transcriptScroll']?.p95, playingFollowP95: all['playingFollow']?.p95,
      cueSwitchP95: all['cueSwitch']?.p95, transcriptSearchP95: all['transcriptSearch']?.p95,
    };
    for (const [k, v] of Object.entries(values)) expect(typeof v, `${k} was measured`).toBe('number');
    const limits = videoLimits(values as Record<keyof typeof VIDEO_BUDGET_MS, number>);
    const failures = limitFailures(limits);
    // Report-only: a value over its own budget but inside the 2x line (a 60 Hz frame gap sits at the budget) is said, not hidden.
    const overBudget = limits.filter((l) => l.value > l.budget).map((l) => `${l.what}: ${l.value} ms over its budget ${l.budget} ms`);
    save({ values, overBudget, overBudgetOnLinuxCiLine: failures });
    console.log('[measure] video', JSON.stringify(values), overBudget.length ? `over budget: ${overBudget.join('; ')}` : 'within budget', failures.length ? `| over the 2x line: ${failures.join('; ')}` : '| within the 2x line');
    if (linuxCi) expect(failures).toEqual([]);
  } finally {
    await app.close();
  }
});
