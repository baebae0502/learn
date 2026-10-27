import { describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD, EDGE_BAND, EDGE_SPEED, dropSlot, edgeScroll, wheelSteps, type HeaderCell } from './columnDrag';

// 제목 200 · 저자 180 · 연도 64 · 종류 88 · 추가일 132, side by side from x = 0.
const cells: HeaderCell[] = [
  { left: 0, right: 200 },
  { left: 200, right: 380 },
  { left: 380, right: 444 },
  { left: 444, right: 532 },
  { left: 532, right: 664 },
];

describe('where a dragged header would land (M5 spec 5.1)', () => {
  it('takes the boundary nearest the pointer, never one before the pinned columns', () => {
    expect(dropSlot(cells, 1, 4, 205)).toEqual({ slot: 1, at: 200 });
    expect(dropSlot(cells, 1, 4, 100)).toEqual({ slot: 1, at: 200 }); // over the title: the first boundary it may take
    expect(dropSlot(cells, 1, 1, 650)).toEqual({ slot: 5, at: 664 }); // past the last column: after it
    expect(dropSlot(cells, 1, 1, 9999)).toEqual({ slot: 5, at: 664 });
    expect(dropSlot(cells, 2, 3, 10)).toEqual({ slot: 2, at: 380 }); // a forced column after the title pins two
  });
  it('gives nothing where the column would land where it is: on its own cell or beside it', () => {
    expect(dropSlot(cells, 1, 2, 300)).toBeNull(); // nearest boundary is 연도's own left edge (380)
    expect(dropSlot(cells, 1, 2, 445)).toBeNull(); // its own right edge
    expect(dropSlot(cells, 1, 1, 205)).toBeNull();
  });
  it('breaks a tie toward the earlier boundary', () => {
    expect(dropSlot(cells, 1, 4, 290)).toEqual({ slot: 1, at: 200 }); // 90 from 200, 90 from 380
  });
  it('has a threshold that tells a click from a drag', () => {
    expect(DRAG_THRESHOLD).toBe(4);
  });
});

describe('scrolling the table sideways while a header is dragged near an edge of the visible header', () => {
  it('is still inside the band, ramps up toward the edge, and is the same beyond it', () => {
    expect(edgeScroll(200, 0, 400)).toBe(0);
    expect(edgeScroll(EDGE_BAND, 0, 400)).toBe(0);
    expect(edgeScroll(16, 0, 400)).toBe(-EDGE_SPEED / 2);
    expect(edgeScroll(0, 0, 400)).toBe(-EDGE_SPEED);
    expect(edgeScroll(-50, 0, 400)).toBe(-EDGE_SPEED);
    expect(edgeScroll(400 - 16, 0, 400)).toBe(EDGE_SPEED / 2);
    expect(edgeScroll(400, 0, 400)).toBe(EDGE_SPEED);
    expect(edgeScroll(900, 0, 400)).toBe(EDGE_SPEED);
  });
  it('is measured from the header\'s own edges, wherever it is on the page', () => {
    expect(edgeScroll(240 + 5, 240, 640)).toBeLessThan(0);
    expect(edgeScroll(440, 240, 640)).toBe(0);
  });
});

describe('a wheel over the header', () => {
  const view = { width: 400, height: 300 };
  const wheel = (deltaX: number, deltaY: number, deltaMode = 0, shiftKey = false) => ({ deltaX, deltaY, deltaMode, shiftKey });
  it('moves the table by pixels, lines of 16 px or pages of the view', () => {
    expect(wheelSteps(wheel(60, 30), view)).toEqual({ x: 60, y: 30 });
    expect(wheelSteps(wheel(0, 3, 1), view)).toEqual({ x: 0, y: 48 });
    expect(wheelSteps(wheel(1, 1, 2), view)).toEqual({ x: 400, y: 300 });
  });
  it('turns ⇧ + wheel into a sideways step', () => {
    expect(wheelSteps(wheel(0, 40, 0, true), view)).toEqual({ x: 40, y: 0 });
    expect(wheelSteps(wheel(10, 40, 0, true), view)).toEqual({ x: 10, y: 40 }); // a real sideways delta is kept
  });
});
