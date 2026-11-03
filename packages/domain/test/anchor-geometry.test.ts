import { describe, expect, it } from 'vitest';
import { quadToRect, quadsDistance, rectToQuad, rectsToQuads, type ClientRect, type Quad } from '../src/index';

/** The matrix pdf.js's PageViewport builds for a [0, 0, 595, 842] page, copied here because the domain package does not depend on pdfjs-dist. */
function testViewport(scale: number, rotation: number) {
  const [x1, y1, x2, y2] = [0, 0, 595, 842];
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const [a, b, c, d] = ({ 0: [1, 0, 0, -1], 90: [0, 1, 1, 0], 180: [-1, 0, 0, 1], 270: [0, -1, -1, 0] } as Record<number, number[]>)[rotation]!;
  const offX = (a === 0 ? Math.abs(cy - y1) : Math.abs(cx - x1)) * scale;
  const offY = (a === 0 ? Math.abs(cx - x1) : Math.abs(cy - y1)) * scale;
  const m = [a! * scale, b! * scale, c! * scale, d! * scale, offX - a! * scale * cx - c! * scale * cy, offY - b! * scale * cx - d! * scale * cy] as const;
  const det = m[0] * m[3] - m[1] * m[2];
  return {
    convertToViewportPoint: (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    convertToPdfPoint: (x: number, y: number) => {
      const px = x - m[4];
      const py = y - m[5];
      return [(m[3] * px - m[2] * py) / det, (-m[1] * px + m[0] * py) / det];
    },
  };
}

const identity = { convertToPdfPoint: (x: number, y: number) => [x, y], convertToViewportPoint: (x: number, y: number) => [x, y] };
const r = (left: number, top: number, right: number, bottom: number): ClientRect => ({ left, top, right, bottom });
const Q: Quad = [100, 300, 220, 300, 100, 284, 220, 284];

describe('quad <-> rect', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const scale of [0.5, 1, 2, 4]) {
      it(`round-trips at rotation ${rotation}, scale ${scale}`, () => {
        const vp = testViewport(scale, rotation);
        const quad = rectToQuad(quadToRect(Q, vp), vp);
        expect(quadsDistance([quad], [Q])).toBeLessThan(1e-6);
      });
    }
  }

  it('orders the corners upper-left, upper-right, lower-left, lower-right', () => {
    expect(rectToQuad(r(10, 20, 50, 30), { convertToPdfPoint: (x, y) => [x, 100 - y] })).toEqual([10, 80, 50, 80, 10, 70, 50, 70]);
  });

  it('joins rectangles of one line, drops slivers, and orders top to bottom', () => {
    expect(rectsToQuads([r(10, 10, 50, 22), r(50.5, 10, 90, 22)], identity)).toHaveLength(1);
    expect(rectsToQuads([r(10, 10, 50, 22), r(60, 10, 90, 22)], identity)).toHaveLength(2);
    expect(rectsToQuads([r(10, 10, 50, 10.2), r(10, 30, 50, 42)], identity)).toHaveLength(1);
    const two = rectsToQuads([r(10, 10, 50, 22), r(10, 30, 50, 42)], { convertToPdfPoint: (x, y) => [x, 100 - y] });
    expect(two.map((q) => q[1])).toEqual([90, 70]);
  });

  it('measures the distance between quad lists', () => {
    expect(quadsDistance([Q], [Q])).toBe(0);
    expect(quadsDistance([Q], [[101, 300, 220, 300, 100, 284, 220, 284]])).toBe(1);
    expect(quadsDistance([Q], [])).toBe(Infinity);
  });
});
