import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { pdfAnchor, type PdfAnchor, type Quad } from '../../packages/domain/src/anchors';
import { quadsDistance } from '../../packages/domain/src/anchor-geometry';
import { FIXTURES, backFromReader, importPaths, launch, openItem } from './helpers';
import type { LearnPdfProbe } from '../../apps/desktop/src/renderer/src/viewers/pdf/anchorProbe';

// ADR-0009 section 7: a selection or a page quote becomes an anchor that lands back within 2 pt (AC03) at four zooms and
// four rotations. The reference anchor is made at 100 % and 0 degrees; every other combination selects the same text afresh.

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const KOREAN = path.join(FIXTURES, 'korean.pdf');
const TOLERANCE_PT = 2;
const ZOOMS = [0.5, 1, 2, 4] as const;
const ROTATIONS = [0, 90, 180, 270] as const;

test.beforeAll(() => {
  for (const f of [PAPER, KOREAN]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

declare global {
  interface Window {
    __learnPdf?: LearnPdfProbe;
  }
}

const viewer = (page: Page) => page.getByTestId('pdf-viewer');

async function open(page: Page, file: string, title: string, pages: number) {
  await importPaths(page, [file]);
  await openItem(page, title);
  await expect(viewer(page)).toHaveAttribute('data-pages', String(pages));
  await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await page.waitForFunction(() => window.__learnPdf !== undefined);
}

/** Zoom and rotate the open PDF through the reader's handle, then wait until the viewer says it has arrived. */
async function setView(page: Page, zoom: number, rotation: number) {
  await page.evaluate(
    ([z, r]) => {
      const handle = (window as unknown as { __learnReader: { getState(): { handle: { setZoom(z: number): void; viewer(): { pagesRotation: number } } } } }).__learnReader.getState().handle;
      handle.setZoom(z!);
      handle.viewer().pagesRotation = r!;
    },
    [zoom, rotation] as const,
  );
  await expect(viewer(page)).toHaveAttribute('data-rotation', String(rotation));
  await expect.poll(() => viewer(page).getAttribute('data-scale').then(Number)).toBeCloseTo(zoom, 5);
}

const pageText = (page: Page, pageIndex: number) => page.evaluate((i) => window.__learnPdf!.pageText(i), pageIndex);

interface Pick1 { name: string; pageIndex: number; start: number; end: number }

/** The span of `text` in the page text, found with plain indexOf: the expectation does not use the code under test. */
const spanOf = (text: string, from: string, to: string = from): { start: number; end: number } => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  if (start < 0 || end < to.length) throw new Error(`not in the page text: ${from}`);
  return { start, end };
};

interface Worst { [combo: string]: { [selection: string]: number } }

async function runMatrix(page: Page, picks: Pick1[], revisionIdOut: { id: string }, worst: Worst) {
  await setView(page, 1, 0);
  const anchors = new Map<string, PdfAnchor>();
  for (const p of picks) {
    await page.evaluate(([i, s, e]) => window.__learnPdf!.selectText(i!, s!, e!), [p.pageIndex, p.start, p.end] as const);
    const anchor = await page.evaluate(() => window.__learnPdf!.anchorOfSelection());
    expect(anchor, p.name).not.toBeNull();
    const parsed = pdfAnchor.parse(anchor);
    revisionIdOut.id = parsed.revisionId;
    expect(parsed.precision).toBe('span');
    expect(parsed.pageIndex).toBe(p.pageIndex);
    const text = await pageText(page, p.pageIndex);
    expect(parsed.text?.position).toEqual({ start: p.start, end: p.end });
    expect(parsed.text?.quote.exact).toBe(text.slice(p.start, p.end));
    anchors.set(p.name, parsed);
  }
  for (const zoom of ZOOMS) {
    for (const rotation of ROTATIONS) {
      await setView(page, zoom, rotation);
      const combo = `${zoom * 100}%/${rotation}`;
      worst[combo] = {};
      for (const p of picks) {
        const anchor = anchors.get(p.name)!;
        const fresh = (await page.evaluate(([i, s, e]) => window.__learnPdf!.quadsOfText(i!, s!, e!), [p.pageIndex, p.start, p.end] as const)) as Quad[];
        const distance = quadsDistance(anchor.quads, fresh);
        worst[combo]![p.name] = distance;
        expect(distance, `${p.name} at ${combo}: ${JSON.stringify({ anchor: anchor.quads, fresh })}`).toBeLessThanOrEqual(TOLERANCE_PT);
        // The anchor drawn back on the screen against the fresh selection's own rectangles, in pixels at this scale.
        const screen = await page.evaluate((a) => window.__learnPdf!.screenBoxes(a), anchor);
        const px = TOLERANCE_PT * screen.pxPerPt;
        for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
          expect(Math.abs(screen.anchor[edge] - screen.selection[edge]), `${p.name} ${edge} at ${combo}`).toBeLessThanOrEqual(px);
        }
      }
    }
  }
}

test('selections become anchors that land back within 2 pt at four zooms and four rotations', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const worst: Worst = {};
  const revisions: Record<string, string> = {};
  try {
    await open(page, PAPER, 'paper-100', 100);
    const p1 = await pageText(page, 0);
    const p3 = await pageText(page, 2);
    const line = spanOf(p1, 'It is based solely on attention mechanisms.');
    const two = spanOf(p1, 'models are based', 'We propose a new');
    // The right column is the second half of the lines; take a whole line from its middle.
    const lines3 = p3.split('\n');
    const rightLine = lines3[Math.floor(lines3.length * 0.75)]!;
    expect(rightLine.length).toBeGreaterThan(20);
    const right = { start: p3.indexOf(rightLine, p3.indexOf(lines3[Math.floor(lines3.length * 0.5)]!) + 1), end: 0 };
    right.end = right.start + rightLine.length;
    const rev = { id: '' };
    await runMatrix(
      page,
      [
        { name: 'paper p1 one line', pageIndex: 0, ...line },
        { name: 'paper p1 two lines', pageIndex: 0, ...two },
        { name: 'paper p3 right column', pageIndex: 2, ...right },
      ],
      rev,
      worst,
    );
    revisions['paper'] = rev.id;
    await setView(page, 1, 0);
    await backFromReader(page);
    await open(page, KOREAN, 'korean', 3);
    const k1 = await pageText(page, 0);
    const korean = spanOf(k1, '변환기는 순환 없이 문장을 한꺼번에 읽습니다.');
    const krev = { id: '' };
    const kWorst: Worst = {};
    await runMatrix(page, [{ name: 'korean p1 one line', pageIndex: 0, ...korean }], krev, kWorst);
    for (const [combo, v] of Object.entries(kWorst)) Object.assign((worst[combo] ??= {}), v);
    revisions['korean'] = krev.id;
  } finally {
    const max = Math.max(...Object.values(worst).flatMap((v) => Object.values(v)));
    await testInfo.attach('anchor-spike.json', {
      body: JSON.stringify({ toleranceInPt: TOLERANCE_PT, maxDistanceInPt: max, maxDistanceByCombination: worst, revisions }, null, 2),
      contentType: 'application/json',
    });
    await app.close();
  }
});

/** The quads of a quote's anchor against the quads of the same text, picked afresh by its offsets. */
async function expectQuoteLands(page: Page, pageIndex: number, quote: string, expected: { start: number; end: number }, why: string) {
  const anchor = await page.evaluate(([i, q]) => window.__learnPdf!.anchorFromQuote(i as number, q as string), [pageIndex, quote] as const);
  expect(anchor, why).not.toBe('NOT_FOUND');
  const parsed = pdfAnchor.parse(anchor);
  expect(parsed.text?.position, why).toEqual(expected);
  const fresh = (await page.evaluate(([i, s, e]) => window.__learnPdf!.quadsOfText(i!, s!, e!), [pageIndex, expected.start, expected.end] as const)) as Quad[];
  expect(quadsDistance(parsed.quads, fresh), why).toBeLessThanOrEqual(TOLERANCE_PT);
  return parsed;
}

test('page quotes become anchors: two lines, a hyphen break, NFD text found by an NFC quote; a quote that is not there is NOT_FOUND', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await open(page, PAPER, 'paper-100', 100);
    const p1 = await pageText(page, 0);
    const twoLines = spanOf(p1, 'models are based', 'We propose a new');
    expect(p1.slice(twoLines.start, twoLines.end)).toContain('\n');
    const a = await expectQuoteLands(page, 0, 'models are based on complex recurrent neural networks. We propose a new', twoLines, 'two lines, the break as a space');
    expect(a.text?.quote.exact).toBe(p1.slice(twoLines.start, twoLines.end));

    const p2 = await pageText(page, 1);
    const hyphen = spanOf(p2, 'sequence transduc-\ntion models');
    await expectQuoteLands(page, 1, 'sequence transduction models', hyphen, 'a word broken across lines with a hyphen');

    expect(await page.evaluate(() => window.__learnPdf!.anchorFromQuote(0, 'a sentence that is nowhere on this page'))).toBe('NOT_FOUND');
    expect(await page.evaluate(() => window.__learnPdf!.anchorFromQuote(0, 'attention is all you want'))).toBe('NOT_FOUND');

    await backFromReader(page);
    await open(page, KOREAN, 'korean', 3);
    const k2 = await pageText(page, 1);
    // Page 2's text is decomposed (NFD): the NFC quote must find it.
    const nfdLine = k2.split('\n')[1]!;
    expect(nfdLine).not.toBe(nfdLine.normalize('NFC'));
    const start = k2.indexOf(nfdLine);
    await expectQuoteLands(page, 1, nfdLine.normalize('NFC'), { start, end: start + nfdLine.length }, 'NFD page text, NFC quote');
  } finally {
    await app.close();
  }
});

test('the probe exists only in a window that carries e2e=1', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-pages', '100');
    expect(await page.evaluate(() => typeof window.__learnPdf)).toBe('object');
    expect(await page.evaluate(() => new URLSearchParams(location.search).get('e2e'))).toBe('1');
  } finally {
    await app.close();
  }
});
