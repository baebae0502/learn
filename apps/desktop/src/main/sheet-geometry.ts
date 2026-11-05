// Where a sheet sits and how tall it may grow. No electron import: E2E specs read the same rule.

/**
 * Off macOS: 8 px under the 52 px toolbar, centred across the window (design-spec 6 시트). macOS places a sheet itself:
 * centred over the parent window, which it dims (Big Sur and later — every macOS Electron 44 runs on).
 */
export const SHEET_TOP = 60;
/** Room kept at each free end of a sheet: below it off macOS, above and below the centred macOS sheet. */
export const SHEET_MARGIN = 16;

/**
 * The tallest a sheet may be over a parent `roomHeight` tall before its body scrolls (design-spec 6 시트: as tall as
 * its content). macOS centres the sheet itself (we set no sheet offset), so only a margin at each end is kept there;
 * elsewhere the sheet hangs SHEET_TOP down. Critic T12-m1: the ⌘/ sheet (743) fits the default window of a
 * 1440 × 900 Mac with the Dock (about 806 tall).
 */
export function sheetMaxHeight(roomHeight: number, platform: NodeJS.Platform): number {
  return Math.max(160, roomHeight - (platform === 'darwin' ? 2 * SHEET_MARGIN : SHEET_TOP + SHEET_MARGIN));
}
