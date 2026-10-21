import { layout } from '../renderer/src/design/tokens';

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** design-spec 2.1: 1440 × 900 by default. */
export const DEFAULT_SIZE = { width: 1440, height: 900 } as const;
const MIN_SIZE = { width: layout.windowMinWidth, height: layout.windowMinHeight } as const;

/**
 * The first frame of a main window with no saved state: the default size shrunk to the display's work area and centred
 * on it. The window's minimum size wins over a work area smaller than it (Task 8 R3-1: a 1440-wide frame asked for on
 * a 1024-pt screen came back 1440 wide, 416 pt off screen, after a full-screen round trip).
 */
export function defaultFrame(workArea: Frame, size: { width: number; height: number } = DEFAULT_SIZE, min: { width: number; height: number } = MIN_SIZE): Frame {
  const width = Math.max(min.width, Math.min(size.width, workArea.width));
  const height = Math.max(min.height, Math.min(size.height, workArea.height));
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

const same = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * After leaving full screen: the frame to put back when the restored one differs from the frame the window had before
 * it entered full screen (kept inside the work area), or null when nothing needs fixing.
 */
export function frameAfterFullScreen(before: Frame | null, now: Frame, workArea: Frame): Frame | null {
  if (!before) return null;
  const width = Math.min(before.width, Math.max(workArea.width, MIN_SIZE.width));
  const height = Math.min(before.height, Math.max(workArea.height, MIN_SIZE.height));
  const want = {
    width,
    height,
    x: Math.min(Math.max(before.x, workArea.x), workArea.x + Math.max(0, workArea.width - width)),
    y: Math.min(Math.max(before.y, workArea.y), workArea.y + Math.max(0, workArea.height - height)),
  };
  return same(want, now) ? null : want;
}
