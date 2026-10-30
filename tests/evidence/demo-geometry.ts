// Where the demo puts a settings chapter's caption (critique mac1 m3, residual polish concern 4). Pure, for its test.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The overlay's caption box in the main window (demo.css): left 24, bottom 108 (or higher: captionBottom), up to 560 wide. */
export const CAPTION_BOX = { left: 24, bottom: 108, width: 560, lines2: 72, lines3: 96, lines5: 160 } as const;

/**
 * The caption's distance from the window's bottom: 108, or 16 above the sidebar's tag selector when that reaches higher
 * (round 2 minor 2: a wrapped selector's 태그 header went under the caption) — clear even while the caption rises in from 8
 * lower. `tagTop`: the selector's top in CSS px, null with no selector drawn (the sidebar hidden).
 */
export function captionBottom(windowHeight: number, tagTop: number | null): number {
  return tagTop === null ? CAPTION_BOX.bottom : Math.max(CAPTION_BOX.bottom, Math.ceil(windowHeight - tagTop + 16));
}

/** The arrow's tip to the bottom of what it draws (macOS's arrow is about 20 px tall), with a margin. */
const ARROW_BELOW = 28;

/**
 * Where the pointer rests in the main window (round 2 minor 3): x 120, in the sidebar's tree. 48 below its last row, but never
 * so low that the arrow reaches a caption of up to three lines above the tag selector (captionBottom), nor the window's
 * bottom 72. `treeBottom`: the last drawn tree row's bottom; `tagTop` as for captionBottom. CSS px.
 */
export function parkSpot(windowHeight: number, treeBottom: number, tagTop: number | null): { x: number; y: number } {
  const captionTop = windowHeight - captionBottom(windowHeight, tagTop) - CAPTION_BOX.lines3;
  return { x: 120, y: Math.round(Math.min(treeBottom + 48, captionTop - ARROW_BELOW, windowHeight - 72)) };
}
/** A caption narrower than this would wrap into a column: the settings window's own overlay takes it instead. */
export const CAPTION_MIN_WIDTH = 240;

export type CaptionSpot = { target: 'main'; maxWidth?: number } | { target: 'settings' };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * The main window's caption box, unless the settings window covers it. Then a narrower one in the main window, left of
 * the settings window (maxWidth = settings.x − main.x − 48: 24 from the window's edge, 24 from the settings window;
 * it wraps into more lines, so its taller box is checked too). Only when even that leaves no room, the settings
 * window's own overlay. All in screen points; `fromBottom`: the caption's distance from the main window's bottom (captionBottom).
 */
export function captionSpot(main: Rect, settings: Rect, fromBottom: number = CAPTION_BOX.bottom): CaptionSpot {
  const left = main.x + CAPTION_BOX.left;
  const bottom = main.y + main.height - fromBottom;
  const full: Rect = { x: left, y: bottom - CAPTION_BOX.lines2, width: CAPTION_BOX.width, height: CAPTION_BOX.lines2 };
  if (!overlaps(full, settings)) return { target: 'main' };
  const maxWidth = Math.min(CAPTION_BOX.width, Math.floor(settings.x - main.x - 2 * CAPTION_BOX.left));
  if (maxWidth >= CAPTION_MIN_WIDTH) {
    const narrow: Rect = { x: left, y: bottom - CAPTION_BOX.lines5, width: maxWidth, height: CAPTION_BOX.lines5 };
    if (!overlaps(narrow, settings)) return { target: 'main', maxWidth };
  }
  return { target: 'settings' };
}

/**
 * Where the arrow rests while Finder is in front (Mac risk 8): on the desktop, clear of both windows and 40 points from
 * the screen's edges (the hidden Dock and the hot corners): the middle of the wider side margin. With no margin that
 * wide, under the Finder window (over the inactive Learn window), else beside it. Screen points.
 */
export function desktopSpot(display: Rect, learn: Rect, finder: Rect): { x: number; y: number } {
  const edge = 40;
  const right = display.x + display.width - (learn.x + learn.width);
  const left = learn.x - display.x;
  const midY = Math.round(display.y + display.height / 2);
  if (Math.max(left, right) >= 2 * edge) {
    return right >= left ? { x: Math.round(learn.x + learn.width + right / 2), y: midY } : { x: Math.round(display.x + left / 2), y: midY };
  }
  const below = finder.y + finder.height + edge;
  if (below <= display.y + display.height - edge) return { x: Math.round(finder.x + finder.width / 2), y: below };
  const beside = finder.x - edge;
  return { x: beside >= display.x + edge ? beside : Math.min(finder.x + finder.width + edge, display.x + display.width - edge), y: midY };
}
