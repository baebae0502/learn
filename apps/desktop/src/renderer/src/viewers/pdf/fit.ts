/** The fit modes of the zoom menu: the page is sized to the stage, with the mockup's room round it. */
export type FitMode = 'auto' | 'page-width' | 'page-fit';

/** The room kept above, below and beside the page (the mockup's `.pdf-scroll` inset), in CSS px. */
export const FIT_MARGIN = 24;
/** Auto never enlarges a page beyond this (pdf.js: MAX_AUTO_SCALE is 1.25). */
export const FIT_MAX_AUTO = 1.25;
/** pdf.js's own bounds for a scale; a fit stays inside them so the viewer does not move it again. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

export interface Size {
  width: number;
  height: number;
}

/**
 * The scale a fit mode stands for, with pdf.js's meaning and our margins (pdf.js counts none when removePageBorders is on).
 * `stage` is the scroll container's client size; `page` is the current page's unscaled CSS size at the current rotation.
 */
export function fitScale(mode: FitMode, stage: Size, page: Size): number {
  const width = (stage.width - 2 * FIT_MARGIN) / page.width;
  const whole = Math.min(width, (stage.height - 2 * FIT_MARGIN) / page.height);
  // Auto: a landscape page takes the whole-page fit and any other the width fit, as pdf.js's does.
  const scale = mode === 'page-width' ? width : mode === 'page-fit' ? whole : Math.min(FIT_MAX_AUTO, page.width > page.height ? whole : width);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}
