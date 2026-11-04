// How tall the settings window may be. No electron import: E2E specs read the same rule.

/** Never shorter than this, whatever the display: a work area that small shows less than the first group anyway. */
const MIN_CONTENT_HEIGHT = 240;

/**
 * The height the window takes: its content's, but no taller than the display's work area leaves below the title bar (`chrome`),
 * so it fits a 1024 × 768 work area and its content scrolls (R-4). The page scrolls inside .settings-scroll.
 */
export const settingsContentHeight = (measured: number, workAreaHeight: number, chrome: number): number =>
  Math.max(MIN_CONTENT_HEIGHT, Math.min(measured, workAreaHeight - chrome));
