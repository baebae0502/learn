import { describe, expect, it } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, clampZoom, nextZoom, parseZoomInput, pinchScaleFactor, zoomPercent } from './zoom';

describe('zoom steps', () => {
  it('runs from 25 % to 400 % in the menu steps', () => {
    expect(ZOOM_STEPS).toEqual([0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]);
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.25, 4]);
  });
  it('goes to the next step strictly beyond the current scale', () => {
    expect(nextZoom(1, 1)).toBe(1.1);
    expect(nextZoom(1, -1)).toBe(0.9);
    expect(nextZoom(1.2, 1)).toBe(1.25);
    expect(nextZoom(1.2, -1)).toBe(1.1);
    expect(nextZoom(0.8, 1)).toBe(0.9);
    expect(nextZoom(0.8, -1)).toBe(0.75);
  });
  it('treats a scale within 0.005 of a step as that step', () => {
    expect(nextZoom(1.253, 1)).toBe(1.5);
    expect(nextZoom(1.253, -1)).toBe(1.1);
    expect(nextZoom(0.997, 1)).toBe(1.1);
    expect(nextZoom(0.997, -1)).toBe(0.9);
  });
  it('stops at the ends', () => {
    expect(nextZoom(4, 1)).toBe(4);
    expect(nextZoom(3.9, 1)).toBe(4);
    expect(nextZoom(0.25, -1)).toBe(0.25);
    expect(nextZoom(0.26, -1)).toBe(0.25);
    expect(nextZoom(10, 1)).toBe(4);
    expect(nextZoom(0.1, -1)).toBe(0.25);
    expect(nextZoom(0.1, 1)).toBe(0.25);
    expect(nextZoom(10, -1)).toBe(4);
  });
});

describe('zoom text', () => {
  it('writes a scale as a whole percent', () => {
    expect(zoomPercent(1.25)).toBe('125%');
    expect(zoomPercent(1)).toBe('100%');
    expect(zoomPercent(0.6667)).toBe('67%');
    expect(zoomPercent(4)).toBe('400%');
  });
  it('reads a typed percent, with or without the sign', () => {
    expect(parseZoomInput('150')).toBe(1.5);
    expect(parseZoomInput('150%')).toBe(1.5);
    expect(parseZoomInput(' 150 % ')).toBe(1.5);
    expect(parseZoomInput('87.5')).toBe(0.875);
    expect(parseZoomInput('33')).toBe(0.33);
  });
  it('clamps what is out of 25–400', () => {
    expect(parseZoomInput('900')).toBe(4);
    expect(parseZoomInput('10')).toBe(0.25);
    expect(parseZoomInput('0')).toBe(0.25);
    expect(clampZoom(7)).toBe(4);
    expect(clampZoom(0.01)).toBe(0.25);
  });
  it('refuses garbage', () => {
    for (const text of ['', ' ', 'abc', '15x', '%', '-50', '1e2', '1,5,0', '१५०']) expect(parseZoomInput(text), text).toBeNull();
  });
});

describe('pinch', () => {
  it('scales by e^(−deltaY/100): pulling the fingers apart (negative deltaY) enlarges', () => {
    expect(pinchScaleFactor(1, -10)).toBeCloseTo(Math.exp(0.1), 10);
    expect(pinchScaleFactor(1, 10)).toBeCloseTo(Math.exp(-0.1), 10);
  });
  it('stops at 25 % and 400 %', () => {
    expect(1 * pinchScaleFactor(3.9, -50)!).toBeCloseTo(4 / 3.9, 10);
    expect(pinchScaleFactor(4, -50)).toBeNull();
    expect(pinchScaleFactor(0.25, 50)).toBeNull();
    expect(0.3 * pinchScaleFactor(0.3, 500)!).toBeCloseTo(0.25, 10);
  });
  it('ignores a pinch that moves nothing', () => {
    expect(pinchScaleFactor(1, 0)).toBeNull();
  });
});
