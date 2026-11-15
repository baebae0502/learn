import { describe, expect, it } from 'vitest';
import { pressAndDrag, type PressMouse } from './demo-drag';

/** Playwright's mouse as a record: where it is, whether its button is down, and each press and release with its place. */
function fakeMouse(at: { x: number; y: number }) {
  const events: string[] = [];
  let down = false;
  const mouse: PressMouse = {
    move: async (x, y) => {
      at = { x, y };
      events.push(`${down ? 'drag' : 'move'} ${x},${y}`);
    },
    down: async () => {
      down = true;
      events.push(`down ${at.x},${at.y}`);
    },
    up: async () => {
      down = false;
      events.push(`up ${at.x},${at.y}`);
    },
  };
  return { mouse, events, isDown: () => down };
}

describe('the demo\'s press-and-drag', () => {
  it('presses where the drag starts, not where Playwright\'s mouse was parked (the system arrow\'s glide leaves it there)', async () => {
    const { mouse, events } = fakeMouse({ x: 700, y: 60 }); // the park spot: the reader toolbar's empty stretch
    await pressAndDrag(mouse, { x: 120, y: 348 }, async () => {
      await mouse.move(300, 348);
      await mouse.move(480, 348);
    });
    expect(events).toEqual(['move 120,348', 'down 120,348', 'drag 300,348', 'drag 480,348', 'up 480,348']);
  });

  it('lets the button go when the drag fails', async () => {
    const { mouse, isDown } = fakeMouse({ x: 0, y: 0 });
    await expect(pressAndDrag(mouse, { x: 10, y: 10 }, async () => Promise.reject(new Error('lost')))).rejects.toThrow('lost');
    expect(isDown()).toBe(false);
  });
});
