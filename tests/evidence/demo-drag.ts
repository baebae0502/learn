// The demo's press-and-drag (demo.evidence.ts), apart so a unit test can check where the press lands.

/** The part of Playwright's mouse a press-and-drag uses. */
export interface PressMouse {
  move(x: number, y: number): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
}

/**
 * A press at `from`, the drag `drag` makes with the button down, and the release. Playwright's mouse goes to `from` first: where the
 * system's arrow is the pointer (macOS) a glide moves only the arrow, and Playwright's mouse is still at the park spot, where a press
 * would land on the reader's toolbar and the drag would select nothing.
 */
export async function pressAndDrag(mouse: PressMouse, from: { x: number; y: number }, drag: () => Promise<void>): Promise<void> {
  await mouse.move(from.x, from.y);
  await mouse.down();
  try {
    await drag();
  } finally {
    await mouse.up();
  }
}
