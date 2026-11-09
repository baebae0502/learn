/*
 * The image reader's arithmetic (spec 4.2): the fit, the zoom steps, and the stage ↔ picture conversions that keep a point
 * of the picture in place across a zoom, a turn or a change of the stage's size. Pure, so it is unit-tested.
 *
 * Image points are 0–1 of the picture as Chromium draws it at 0° (its EXIF orientation applied), origin top left, y down.
 * The stage scrolls a content box of max(stage, picture + 24 each side), with the turned picture in its middle.
 */

/** A quarter turn clockwise is 90. */
export type Rotation = 0 | 90 | 180 | 270;
/** 'fit': the whole picture, never enlarged; 'width': the stage's width; a number: the scale (1 = one image pixel per CSS pixel). */
export type ImageZoom = 'fit' | 'width' | number;
export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/** Room round the picture on every side, as M7a leaves round a page. */
export const IMAGE_MARGIN = 24;
export const IMAGE_ZOOM_MIN = 0.05;
export const IMAGE_ZOOM_MAX = 8;
/** What ⌘+ and ⌘− walk. A large photo fits near 10 %, so the floor is well below the PDF's 25 %. */
export const IMAGE_ZOOM_STEPS: readonly number[] = [0.05, 0.1, 0.17, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

/** A scale this close to a step is that step. */
const EPSILON = 0.005;

export const clampImageZoom = (scale: number): number => Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, scale));

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function rotatedSize(natural: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270 ? { width: natural.height, height: natural.width } : { width: natural.width, height: natural.height };
}

/**
 * The scale of a fit mode for the turned picture: 'fit' shows all of it and never enlarges a small one (an icon or a screenshot would blur), 'width' fills the
 * stage's width and does. Both leave 24 on every side and stay within 5–800 %.
 */
export function fitScale(natural: Size, rotation: Rotation, stage: Size, mode: 'fit' | 'width'): number {
  const turned = rotatedSize(natural, rotation);
  const room = { width: Math.max(1, stage.width - 2 * IMAGE_MARGIN), height: Math.max(1, stage.height - 2 * IMAGE_MARGIN) };
  const width = room.width / Math.max(1, turned.width);
  if (mode === 'width') return clampImageZoom(width);
  return clampImageZoom(Math.min(1, width, room.height / Math.max(1, turned.height)));
}

/** The next step strictly beyond `current` in the direction, clamped to the ends. */
export function nextImageZoom(current: number, dir: 1 | -1): number {
  const step = dir === 1 ? IMAGE_ZOOM_STEPS.find((s) => s > current + EPSILON) : IMAGE_ZOOM_STEPS.findLast((s) => s < current - EPSILON);
  return clampImageZoom(step ?? current);
}

/**
 * The factor a trackpad pinch (a wheel event with ctrl) multiplies the scale by — exp(−deltaY / 100), the PDF reader's — or null
 * when the scale would not move, so a pinch at either end gives no jitter.
 */
export function imagePinchFactor(current: number, deltaY: number): number | null {
  const factor = clampImageZoom(current * Math.exp(-deltaY / 100)) / current;
  return Math.abs(factor - 1) < 1e-3 ? null : factor;
}

/** What was typed in the zoom field: a percent with or without the sign, clamped to 5–800 %; anything else is not a zoom. */
export function parseImageZoomInput(text: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*%?$/.exec(text.trim());
  if (!m) return null;
  return clampImageZoom(Number(m[1]!.replace(',', '.')) / 100);
}

/** How a picture sits in the stage: `box` is the turned, scaled picture; `content` what the stage scrolls; `offset` the box's place in it. */
export interface ImageLayout {
  scale: number;
  box: Size;
  content: Size;
  offset: Point;
}

export function imageLayout(natural: Size, rotation: Rotation, stage: Size, scale: number): ImageLayout {
  const turned = rotatedSize(natural, rotation);
  const box = { width: turned.width * scale, height: turned.height * scale };
  const content = { width: Math.max(stage.width, box.width + 2 * IMAGE_MARGIN), height: Math.max(stage.height, box.height + 2 * IMAGE_MARGIN) };
  return { scale, box, content, offset: { x: (content.width - box.width) / 2, y: (content.height - box.height) / 2 } };
}

/** A point of the upright picture as a point of the turned one (both 0–1): the turn is clockwise. */
function turn(p: Point, rotation: Rotation): Point {
  if (rotation === 90) return { x: 1 - p.y, y: p.x };
  if (rotation === 180) return { x: 1 - p.x, y: 1 - p.y };
  if (rotation === 270) return { x: p.y, y: 1 - p.x };
  return { x: p.x, y: p.y };
}

/** The inverse of `turn`. */
function unturn(q: Point, rotation: Rotation): Point {
  if (rotation === 90) return { x: q.y, y: 1 - q.x };
  if (rotation === 180) return { x: 1 - q.x, y: 1 - q.y };
  if (rotation === 270) return { x: 1 - q.y, y: q.x };
  return { x: q.x, y: q.y };
}

/** The point of the upright picture under stage point `at` (stage px), clamped to the picture (0–1). */
export function pointAt(l: ImageLayout, rotation: Rotation, scroll: Point, at: Point): Point {
  const q = {
    x: clamp((scroll.x + at.x - l.offset.x) / Math.max(1e-9, l.box.width), 0, 1),
    y: clamp((scroll.y + at.y - l.offset.y) / Math.max(1e-9, l.box.height), 0, 1),
  };
  const p = unturn(q, rotation);
  return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) };
}

/** The scroll that puts point `p` of the upright picture at stage point `at`, before it is held to what the stage can scroll. */
function wantedScroll(l: ImageLayout, rotation: Rotation, p: Point, at: Point): Point {
  const q = turn(p, rotation);
  return { x: l.offset.x + q.x * l.box.width - at.x, y: l.offset.y + q.y * l.box.height - at.y };
}

/** The scroll that puts point `p` of the upright picture at stage point `at`, clamped to what the stage can scroll. */
export function scrollFor(l: ImageLayout, rotation: Rotation, stage: Size, p: Point, at: Point): Point {
  const want = wantedScroll(l, rotation, p, at);
  return { x: clamp(want.x, 0, Math.max(0, l.content.width - stage.width)), y: clamp(want.y, 0, Math.max(0, l.content.height - stage.height)) };
}

/**
 * The picture point at the stage's centre once a placement that asked for point `anchor.p` at stage point `anchor.at` (the centre when
 * null) has left the stage scrolled to `applied`. An anchor that landed where it asked (within the pixel a scroll rounds to) is its own
 * point, so a restore keeps the value it read; one held at an end of the scroll, or anchored elsewhere, leaves the point the stage shows.
 */
export function placedCentre(l: ImageLayout, rotation: Rotation, stage: Size, anchor: { p: Point; at: Point | null }, applied: Point): Point {
  const centre = { x: stage.width / 2, y: stage.height / 2 };
  if (anchor.at === null) {
    const want = wantedScroll(l, rotation, anchor.p, centre);
    if (Math.abs(applied.x - want.x) < 1 && Math.abs(applied.y - want.y) < 1) return { x: anchor.p.x, y: anchor.p.y };
  }
  return pointAt(l, rotation, applied, centre);
}
