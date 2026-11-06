import { describe, expect, it } from 'vitest';
import { FIT_MARGIN, FIT_MAX_AUTO, fitScale, tallestHeight, widestPage } from './fit';

const stage = { width: 880, height: 700 };
const a4 = { width: 794, height: 1123 };

describe('fitScale (the mockup margins: 24 on every side of the page)', () => {
  it('page-width leaves 24 on each side', () => {
    expect(FIT_MARGIN).toBe(24);
    expect(fitScale('page-width', stage, a4)).toBeCloseTo((880 - 48) / 794, 6);
  });
  it('page-fit is the smaller of the width fit and the height fit', () => {
    expect(fitScale('page-fit', stage, a4)).toBeCloseTo((700 - 48) / 1123, 6);
    expect(fitScale('page-fit', { width: 300, height: 2000 }, a4)).toBeCloseTo((300 - 48) / 794, 6);
  });
  it('auto of a portrait page is the width fit, at most 125 %', () => {
    expect(fitScale('auto', stage, a4)).toBeCloseTo((880 - 48) / 794, 6);
    expect(fitScale('auto', { width: 2000, height: 700 }, a4)).toBe(FIT_MAX_AUTO);
  });
  it('auto of a landscape page is the whole-page fit, at most 125 %', () => {
    const land = { width: 1123, height: 794 };
    expect(fitScale('auto', { width: 1400, height: 700 }, land)).toBeCloseTo((700 - 48) / 794, 6);
    expect(fitScale('auto', { width: 4000, height: 4000 }, land)).toBe(FIT_MAX_AUTO);
  });
  it('a rotated page is measured as it is shown: the caller passes the rotated size', () => {
    const rotated = { width: a4.height, height: a4.width };
    expect(fitScale('page-width', stage, rotated)).toBeCloseTo((880 - 48) / 1123, 6);
    expect(fitScale('auto', { width: 1400, height: 700 }, rotated)).toBeCloseTo((700 - 48) / 794, 6);
  });
  it('a stage too small for the margins still gives a positive scale within the viewer range', () => {
    const s = fitScale('page-fit', { width: 40, height: 40 }, a4);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeGreaterThanOrEqual(0.1);
  });
});

describe('widestPage (R-21: auto and page width fit the widest page)', () => {
  const portrait = { width: 794, height: 1123 };
  const landscape = { width: 1123, height: 794 };
  it('picks the page with the greatest width', () => {
    expect(widestPage([portrait, landscape], 0)).toEqual(landscape);
    expect(widestPage([portrait, portrait], 0)).toEqual(portrait);
  });
  it('compares the turned sizes at 90 and 270 degrees, and gives the size as shown', () => {
    expect(widestPage([portrait, landscape], 90)).toEqual({ width: 1123, height: 794 });
    expect(widestPage([portrait, landscape], 270)).toEqual({ width: 1123, height: 794 });
    expect(widestPage([portrait, portrait], 90)).toEqual({ width: 1123, height: 794 });
    expect(widestPage([portrait, landscape], 180)).toEqual(landscape);
  });
});

describe('fitScale in the view modes', () => {
  it('a horizontal flow keeps 12 above and below the page and 24 at the sides; auto is the whole-page fit there', () => {
    expect(fitScale('page-fit', stage, a4, { flow: 'horizontal' })).toBeCloseTo((700 - 24) / 1123, 6);
    expect(fitScale('auto', { width: 2000, height: 700 }, a4, { flow: 'horizontal' })).toBeCloseTo((700 - 24) / 1123, 6);
    expect(fitScale('page-width', stage, a4, { flow: 'horizontal' })).toBeCloseTo((880 - 48) / 794, 6);
  });
  it('auto in a horizontal flow is the height fit even when the stage is narrow', () => {
    expect(fitScale('auto', { width: 460, height: 700 }, a4, { flow: 'horizontal' })).toBeCloseTo((700 - 24) / 1123, 6);
    expect(fitScale('page-fit', { width: 460, height: 700 }, a4, { flow: 'horizontal' })).toBeCloseTo((460 - 48) / 794, 6);
  });
  it('a page at a time fits the whole page with 12 above and below, auto included', () => {
    expect(fitScale('auto', { width: 1000, height: 700 }, a4, { flow: 'page' })).toBeCloseTo((700 - 24) / 1123, 6);
    expect(fitScale('auto', { width: 400, height: 900 }, a4, { flow: 'page' })).toBeCloseTo((400 - 48) / 794, 6);
    expect(fitScale('page-fit', stage, a4, { flow: 'page' })).toBeCloseTo((700 - 24) / 1123, 6);
    expect(fitScale('page-width', stage, a4, { flow: 'page' })).toBeCloseTo((880 - 48) / 794, 6);
  });
  it('the tallest page, as shown', () => {
    const sizes = [{ width: 800, height: 1000 }, { width: 600, height: 1200 }];
    expect(tallestHeight(sizes, 0)).toBe(1200);
    expect(tallestHeight(sizes, 90)).toBe(800);
    expect(tallestHeight([], 0)).toBe(0);
  });
  it('a spread fits its two pages and the 12 between them to the width', () => {
    expect(fitScale('page-width', stage, a4, { columns: 2 })).toBeCloseTo((880 - 48 - 12) / (2 * 794), 6);
    expect(fitScale('page-fit', { width: 4000, height: 700 }, a4, { columns: 2 })).toBeCloseTo((700 - 48) / 1123, 6);
  });
  it('no layout is the one-column vertical fit', () => {
    expect(fitScale('page-fit', stage, a4, {})).toBe(fitScale('page-fit', stage, a4));
  });
});
