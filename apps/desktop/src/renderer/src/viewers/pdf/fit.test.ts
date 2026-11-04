import { describe, expect, it } from 'vitest';
import { FIT_MARGIN, FIT_MAX_AUTO, fitScale } from './fit';

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
