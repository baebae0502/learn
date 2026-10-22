// Counts the rows of an open native menu in a screen capture (Task 8 R2-1): the System Events item list of a closed
// menu does not show rows AppKit adds while the menu opens, so the open menu's pixels are the authority.
import { luma, rgbAt, type RgbaImage } from './png';

/** x0, y0 inclusive; x1, y1 exclusive. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MenuRows {
  panel: Box;
  /** Text rows, top to bottom (y ranges of rows that carry ink). */
  rows: Array<{ y0: number; y1: number }>;
  /** Separator lines (y). */
  separators: number[];
}

const delta = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

/**
 * The open menu panel around `seed` — a point inside the panel on a blank row (its top padding) and left of the text:
 * the panel extends along the seed's row and column while the colour stays within `tol` of the seed's.
 */
export function findMenuPanel(img: RgbaImage, seed: { x: number; y: number }, tol = 10): Box {
  const bg = rgbAt(img, seed.x, seed.y);
  const same = (x: number, y: number) => delta(rgbAt(img, x, y), bg) <= tol;
  let y0 = seed.y;
  while (y0 > 0 && same(seed.x, y0 - 1)) y0--;
  let y1 = seed.y;
  while (y1 < img.height - 1 && same(seed.x, y1 + 1)) y1++;
  let x0 = seed.x;
  while (x0 > 0 && same(x0 - 1, seed.y)) x0--;
  let x1 = seed.x;
  while (x1 < img.width - 1 && same(x1 + 1, seed.y)) x1++;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Text rows and separators inside a menu panel. Ink: a pixel whose brightness differs from the panel's by more than
 * INK (glyphs, shortcuts, and a disabled item's grey text). A separator: a row whose pixels mostly differ by a little
 * (8–INK) and carry no ink.
 */
/**
 * Ink threshold. A disabled item (기본 글자 크기 at the default size) is grey text that peaks 61–62 from the panel on
 * the macos-15 runner, so the old 60 split its band into slivers and the row went uncounted (run 39779536146 counted 5
 * of 6). Separators peak at 24–26, regular text at about 195: 40 sits clear of both.
 */
export const INK = 40;

export function menuRows(img: RgbaImage, panel: Box): MenuRows {
  const bg = luma(rgbAt(img, panel.x0 + 2, panel.y0 + 2));
  const x0 = panel.x0 + 3;
  const x1 = panel.x1 - 3;
  const rows: MenuRows['rows'] = [];
  const separators: number[] = [];
  let band: { y0: number; y1: number } | null = null;
  for (let y = panel.y0 + 1; y < panel.y1 - 1; y++) {
    let ink = 0;
    let faint = 0;
    for (let x = x0; x < x1; x++) {
      const d = Math.abs(luma(rgbAt(img, x, y)) - bg);
      if (d > INK) ink++;
      else if (d > 8) faint++;
    }
    if (ink >= 2) {
      if (band && band.y1 === y) band.y1 = y + 1;
      else rows.push((band = { y0: y, y1: y + 1 }));
      continue;
    }
    band = null;
    if (faint >= (x1 - x0) * 0.5) separators.push(y);
  }
  return { panel, rows: rows.filter((r) => r.y1 - r.y0 >= 4), separators };
}

/** Rows below the first separator — in 보기 (sidebar toggle, separator, full screen) the full-screen rows. */
export const rowsBelowFirstSeparator = (m: MenuRows): number => (m.separators.length ? m.rows.filter((r) => r.y0 > m.separators[0]!).length : 0);
