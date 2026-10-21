// macOS baseline of the current app: screenshots of every screen, first-PDF / first-frame timings,
// seek error, HEVC behaviour, default library path and the fonts Chromium really used.
// Runs anywhere; darwin-only captures are recorded as skipped elsewhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, launch, stubOpenDialog } from '../e2e/helpers';
import { IS_MAC, allShots as captureAll, platformFonts, writeJson, EVIDENCE_ROOT, type ManifestEntry } from './capture';
import { writeEnv } from './env';

const TAG = { tag: '@baseline' };
const REPS = 5;
const SEEK_TARGET = 7.3;

const FILES = {
  pdf: path.join(FIXTURES, 'sample.pdf'),
  koPdf: path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'),
  h264: path.join(FIXTURES, 'sample-h264-aac.mp4'),
  mpeg4: path.join(FIXTURES, 'sample-mpeg4part2.mp4'),
  hevc: path.join(FIXTURES, 'sample-hevc.mp4'),
};
const HAS_HEVC = fs.existsSync(FILES.hevc);

/** Merge a patch into evidence-results/baseline.json so results survive a worker restart. */
function saveBaseline(patch: Record<string, unknown>): void {
  const file = path.join(EVIDENCE_ROOT, 'baseline.json');
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  writeJson('baseline.json', { ...current, ...patch, platform: `${process.platform}-${process.arch}`, updatedAt: new Date().toISOString() }, 'baseline measurements');
}

function stats(values: number[]): { values: number[]; median: number; max: number; min: number; first: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { values: values.map(r), median: r(median), max: r(sorted.at(-1)!), min: r(sorted[0]!), first: r(values[0]!) };
}

type Ready = 'pdf' | 'video' | 'video-error';

/** Click "open" for `title` inside the renderer and time until the viewer is ready (ms, performance.now()). */
function timeOpen(page: Page, title: string, ready: Ready): Promise<number> {
  return page.evaluate(
    ({ title, ready }) =>
      new Promise<number>((resolve, reject) => {
        const btn = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="open-item"]')].find((b) => b.dataset['title'] === title);
        if (!btn) return reject(new Error(`no open-item for ${title}`));
        const isReady = () => {
          if (ready === 'pdf') {
            const c = document.querySelector('[data-testid="pdf-canvas"]');
            return !!c && Number(c.getAttribute('data-rendered')) >= 1;
          }
          if (ready === 'video') {
            const v = document.querySelector<HTMLVideoElement>('[data-testid="video"]');
            return !!v && v.readyState >= 2;
          }
          return !!document.querySelector('[data-testid="video-error"]');
        };
        const t0 = performance.now();
        const tick = () => {
          if (isReady()) return resolve(performance.now() - t0);
          if (performance.now() - t0 > 30_000) return reject(new Error(`timeout waiting for ${ready} (${title})`));
          setTimeout(tick, 2);
        };
        btn.click();
        tick();
      }),
    { title, ready },
  );
}

/** Mean colour and share of non-black pixels of the current video frame (catches green/black decode failures). */
function frameStats(page: Page) {
  return page.getByTestId('video').evaluate((v: HTMLVideoElement) => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, lit = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
      if (d[i]! + d[i + 1]! + d[i + 2]! > 60) lit++;
    }
    return { meanRgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], litShare: Math.round((lit / n) * 1000) / 1000 };
  });
}

async function backToLibrary(page: Page): Promise<void> {
  const back = page.getByTestId('viewer-back');
  if (await back.isVisible()) await back.click();
  await expect(page.getByTestId('library-table')).toBeVisible();
}

/** page + window + full-screen captures; on macOS the native window and full-screen files must exist. */
async function allShots(app: ElectronApplication, page: Page, name: string, description: string): Promise<ManifestEntry[]> {
  const shots = await captureAll(app, page, name, description);
  expect(shots[0]!.file, `${name}: page screenshot`).not.toBeNull();
  if (IS_MAC) {
    for (const s of shots.slice(1)) expect(s.file, `${name}: ${s.kind} capture failed: ${s.error ?? s.skipped ?? ''}`).not.toBeNull();
  }
  return shots;
}

let app: ElectronApplication;
let page: Page;
let tmp: string;

test.beforeAll(async () => {
  for (const f of [FILES.pdf, FILES.koPdf, FILES.h264, FILES.mpeg4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-baseline-'));
  const t0 = Date.now();
  ({ app, page } = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata')));
  const launchToReadyMs = Date.now() - t0;
  await writeEnv(app);
  const files = [FILES.pdf, FILES.koPdf, FILES.h264, FILES.mpeg4, ...(HAS_HEVC ? [FILES.hevc] : [])];
  await stubOpenDialog(app, files);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('item-row')).toHaveCount(files.length);
  saveBaseline({ launchToReadyMs, launchNote: 'Playwright electron.launch → app-ready attached (includes Playwright overhead)', imported: files.map((f) => path.basename(f)) });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('library screen and fonts', TAG, async () => {
  await backToLibrary(page);
  const shots = await allShots(app, page, '01-library', 'library with 5 imported fixtures');
  const fonts = [];
  for (const sel of [
    '[data-testid="toolbar-title"]',
    '.sidebar .section-label',
    '[data-testid="nav-library"] .label',
    '[data-testid="open-item"][data-title="sample"]',
    '[data-testid="open-item"][data-title="한글 경로 (테스트) #1"]',
  ]) {
    fonts.push(await platformFonts(page, sel).catch((e: Error) => ({ selector: sel, error: e.message })));
  }
  saveBaseline({ fonts });
  expect(shots).toHaveLength(3);
});

test('PDF: time to first rendered page', TAG, async () => {
  const runs: number[] = [];
  for (let i = 0; i < REPS; i++) {
    await backToLibrary(page);
    runs.push(await timeOpen(page, 'sample', 'pdf'));
  }
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
  await allShots(app, page, '02-pdf', 'PDF viewer, page 1 at 100%');
  await page.getByTestId('pdf-next').click();
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[2-9]\d*$/);
  await allShots(app, page, '03-pdf-rotated', 'PDF viewer, page 2 (rotated 90°)');
  const ko = [];
  await backToLibrary(page);
  ko.push(await timeOpen(page, '한글 경로 (테스트) #1', 'pdf'));
  saveBaseline({
    pdfFirstPageMs: { ...stats(runs), note: 'click open → canvas data-rendered ≥ 1; first value is the first open after launch' },
    koreanPathPdfMs: ko[0],
  });
});

test('MP4 (H.264/AAC): first frame and seek error', TAG, async () => {
  const firstFrame: number[] = [];
  for (let i = 0; i < REPS; i++) {
    await backToLibrary(page);
    firstFrame.push(await timeOpen(page, 'sample-h264-aac', 'video'));
  }
  const video = page.getByTestId('video');
  const seeks: Array<{ errorMs: number; seekMs: number }> = [];
  for (let i = 0; i < REPS; i++) {
    seeks.push(
      await video.evaluate(async (v: HTMLVideoElement, target: number) => {
        const seekTo = (t: number) =>
          new Promise<void>((resolve) => {
            v.addEventListener('seeked', () => resolve(), { once: true });
            v.currentTime = t;
          });
        v.muted = true;
        await seekTo(0);
        await v.play();
        const t0 = performance.now();
        await seekTo(target);
        const errorMs = Math.abs(v.currentTime - target) * 1000;
        const seekMs = performance.now() - t0;
        v.pause();
        return { errorMs, seekMs };
      }, SEEK_TARGET),
    );
  }
  const meta = await video.evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }));
  const frame = await frameStats(page);
  await allShots(app, page, '04-video', `H.264 video paused at ${SEEK_TARGET}s`);
  saveBaseline({
    mp4FirstFrameMs: { ...stats(firstFrame), note: 'click open → <video>.readyState ≥ 2 (HAVE_CURRENT_DATA)' },
    seekErrorMs: { ...stats(seeks.map((s) => s.errorMs)), target: SEEK_TARGET },
    seekDurationMs: stats(seeks.map((s) => s.seekMs)),
    h264: { ...meta, frame },
  });
  expect(meta.width).toBe(1280);
});

test('HEVC: record behaviour (not a pass/fail criterion)', TAG, async () => {
  test.skip(!HAS_HEVC, 'sample-hevc.mp4 not generated (no libx265)');
  await backToLibrary(page);
  await page.locator('[data-testid="open-item"][data-title="sample-hevc"]').click();
  const video = page.getByTestId('video');
  await expect(video).toBeAttached();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 2 || v.error !== null), { timeout: 15_000 })
    .toBe(true)
    .catch(() => {});
  const state = await video.evaluate(async (v: HTMLVideoElement) => {
    const codecs = ['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0'];
    const canPlayType = Object.fromEntries(codecs.map((c) => [c, v.canPlayType(`video/mp4; codecs="${c}"`)]));
    let decodingInfo: unknown = null;
    try {
      const info = await navigator.mediaCapabilities.decodingInfo({
        type: 'file',
        video: { contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0"', width: 640, height: 360, bitrate: 1_000_000, framerate: 30 },
      });
      decodingInfo = { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
    } catch (e) {
      decodingInfo = { error: String(e) };
    }
    return {
      readyState: v.readyState,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
      error: v.error ? { code: v.error.code, message: v.error.message } : null,
      canPlayType,
      decodingInfo,
    };
  });
  // Canvas read-back of the decoded frame, right after opening and again after a short play
  // (run 39442173392: the HEVC frame was visible on screen but read back black right after opening).
  const frame = state.readyState >= 2 ? await frameStats(page) : null;
  let frameAfterPlay = null;
  if (state.readyState >= 2) {
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true;
      await v.play();
      await new Promise((r) => setTimeout(r, 700));
      v.pause();
      await new Promise<void>((r) => {
        if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => r());
        setTimeout(r, 300);
      });
    });
    frameAfterPlay = await frameStats(page);
  }
  const uiError = (await page.getByTestId('video-error').count()) ? await page.getByTestId('video-error').innerText() : null;
  await allShots(app, page, '05-hevc', `HEVC (hvc1) fixture: readyState ${state.readyState}`);
  saveBaseline({ hevc: { ...state, frame, frameAfterPlay, uiError, note: 'recorded only; runner VM results are not authoritative' } });
});

test('unsupported codec notice (MPEG-4 Part 2)', TAG, async () => {
  await backToLibrary(page);
  const ms = await timeOpen(page, 'sample-mpeg4part2', 'video-error');
  await expect(page.getByTestId('video-error')).toContainText('코덱');
  const error = await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.error ? { code: v.error.code, message: v.error.message } : null));
  await allShots(app, page, '06-unsupported', 'unsupported codec notice');
  saveBaseline({ unsupported: { msToNotice: Math.round(ms), error, uiText: await page.getByTestId('video-error').innerText() } });
});

test('default library path on a disposable runner', TAG, async () => {
  // Without LEARN_LIBRARY_DIR / LEARN_USER_DATA_DIR the app uses the real home: only on throwaway CI Macs.
  test.skip(!(IS_MAC && process.env['CI']), 'only on darwin CI runners (would touch the real home directory)');
  await app?.close(); // single-instance lock: the shared instance must be gone first
  const s = await launch(null, null);
  try {
    const info = await s.page.evaluate(() => window.learn.app.info());
    const userData = await s.app.evaluate(({ app: a }) => a.getPath('userData'));
    const expected = path.join(os.homedir(), 'Library/Application Support/Learn/Library');
    const libraryRoot = info.ok ? info.data.libraryRoot : null;
    saveBaseline({
      defaultLibrary: {
        libraryRoot,
        userData,
        expected,
        matches: libraryRoot === expected,
        exists: libraryRoot ? fs.existsSync(libraryRoot) : false,
        schemaVersion: info.ok ? info.data.schemaVersion : null,
        libraryError: info.ok ? info.data.libraryError : null,
      },
    });
    expect(libraryRoot).toBe(expected);
  } finally {
    await s.app.close();
  }
});
