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

/** What a settled move or resize reports (window.ts reads it from the window). */
export interface SettledFrame {
  bounds: Frame;
  /** Maximized: zoomed on macOS (the green button or a title-bar double click). */
  zoomed: boolean;
  fullscreen: boolean;
  minimized?: boolean;
}

/**
 * The window's frame across full screen (Task 8 R3-1 and the polish round's minors 2 and 4), free of Electron so it
 * can be unit-tested. window.ts feeds it the window's events and does what it answers.
 * - The windowed frame is noted only while the window is neither zoomed, full screen nor minimized.
 * - Entering full screen remembers that frame and whether the window was zoomed.
 * - On leaving, a zoomed window is left to AppKit, which restores the zoom; nothing is re-applied.
 * - Otherwise the remembered frame is re-applied a moment later (`due`), unless a move or resize that the keeper did
 *   not cause comes first: the user's frame wins (`moved`).
 */
export class FullScreenFrameKeeper {
  private windowed: Frame | null = null;
  private zoomed = false;
  private entered: { frame: Frame | null; zoomed: boolean } | null = null;
  private pending: { want: Frame; atLeave: Frame } | null = null;

  /** A move or resize has settled, or the window was shown, maximized or unmaximized. */
  settled(f: SettledFrame): void {
    if (f.fullscreen || f.minimized) return;
    this.zoomed = f.zoomed;
    if (!f.zoomed) this.windowed = { ...f.bounds };
  }

  /** `enter-full-screen`. `fallback`: the normal bounds, when no frame has settled yet. */
  enter(fallback: Frame): void {
    this.entered = { frame: this.windowed ?? fallback, zoomed: this.zoomed };
    this.pending = null;
  }

  /** `leave-full-screen`, with the frame AppKit restored. True when a re-apply is pending (schedule `due`). */
  leave(restored: Frame): boolean {
    const e = this.entered;
    this.entered = null;
    this.pending = e && !e.zoomed && e.frame ? { want: e.frame, atLeave: { ...restored } } : null;
    return this.pending !== null;
  }

  /** A move or resize while the re-apply is pending: when it changed the frame, the user moved it, and that wins. */
  moved(now: Frame): void {
    if (this.pending && !same(now, this.pending.atLeave)) this.pending = null;
  }

  /** The frame the pending re-apply aims for (its display's work area clamps it), or null. */
  get target(): Frame | null {
    return this.pending?.want ?? null;
  }

  /** The re-apply's moment: the frame to set, or null (nothing pending, or the frame is already right). */
  due(now: Frame, workArea: Frame): Frame | null {
    const p = this.pending;
    this.pending = null;
    return p ? frameAfterFullScreen(p.want, now, workArea) : null;
  }
}
