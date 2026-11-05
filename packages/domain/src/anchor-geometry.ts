import type { Quad } from './anchors';

export interface ClientRect { left: number; top: number; right: number; bottom: number }
export interface PdfPointMapper { convertToPdfPoint(x: number, y: number): number[] }
export interface ViewportPointMapper { convertToViewportPoint(x: number, y: number): number[] }

const SAME_LINE = 1;

interface Box { minX: number; maxX: number; minY: number; maxY: number }
const boxToQuad = (b: Box): Quad => [b.minX, b.maxY, b.maxX, b.maxY, b.minX, b.minY, b.maxX, b.minY];

function rectToBox(rect: ClientRect, viewport: PdfPointMapper): Box {
  const pts = [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]]
    .map(([x, y]) => viewport.convertToPdfPoint(x!, y!));
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** A screen rectangle as a quad in unrotated page space; page rotations are right angles, so the quad stays axis aligned. */
export function rectToQuad(rect: ClientRect, viewport: PdfPointMapper): Quad {
  return boxToQuad(rectToBox(rect, viewport));
}

/** Quads of the selection's rectangles: slivers dropped, rectangles of one line joined, top to bottom then left to right. */
export function rectsToQuads(rects: readonly ClientRect[], viewport: PdfPointMapper): Quad[] {
  const boxes = rects
    .filter((r) => r.right - r.left >= 0.5 && r.bottom - r.top >= 0.5)
    .map((r) => rectToBox(r, viewport));
  // Lines first, by a strict order of the top edge, so the tolerance never sits inside a comparator (it is not transitive).
  boxes.sort((a, b) => b.maxY - a.maxY);
  const lines: Box[][] = [];
  for (const b of boxes) {
    const line = lines.at(-1);
    if (line && Math.abs(line[0]!.maxY - b.maxY) <= SAME_LINE) line.push(b);
    else lines.push([b]);
  }
  const merged: Box[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.minX - b.minX);
    let last: Box | undefined;
    for (const b of line) {
      if (last && Math.abs(last.minY - b.minY) <= SAME_LINE && b.minX - last.maxX <= SAME_LINE) {
        last.minX = Math.min(last.minX, b.minX);
        last.maxX = Math.max(last.maxX, b.maxX);
        last.minY = Math.min(last.minY, b.minY);
        last.maxY = Math.max(last.maxY, b.maxY);
      } else {
        last = { ...b };
        merged.push(last);
      }
    }
  }
  return merged.map(boxToQuad);
}

/** The bounding box, in screen space, of a quad's four corners. */
export function quadToRect(quad: Quad, viewport: ViewportPointMapper): ClientRect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    const [x, y] = viewport.convertToViewportPoint(quad[i]!, quad[i + 1]!);
    xs.push(x!);
    ys.push(y!);
  }
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** The largest coordinate difference between two quad lists; Infinity when they differ in length. */
export function quadsDistance(a: readonly Quad[], b: readonly Quad[]): number {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  a.forEach((q, i) => q.forEach((v, j) => { worst = Math.max(worst, Math.abs(v - b[i]![j]!)); }));
  return worst;
}
