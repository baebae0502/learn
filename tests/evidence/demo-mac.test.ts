import { describe, expect, it } from 'vitest';
import { dragScript, glideScript } from './demo-mac';

interface Post {
  type: string;
  x: number;
  y: number;
  at: number;
}

/**
 * Runs a cursor script against a simulated CoreGraphics and clock: posted moves (unless refused) and warps move the
 * cursor; each post costs `postMs` of wall time (the overhead that stretched the old 20-step glides); NSThread sleeps
 * advance the clock exactly.
 */
function run(script: string, opts: { refusePosts?: boolean; postMs?: number; start?: { x: number; y: number } } = {}) {
  let now = 1_000_000;
  let cursor = { ...(opts.start ?? { x: 0, y: 0 }) };
  const posts: Post[] = [];
  let naps = 0;
  const warps: Post[] = [];
  const $ = {
    kCGEventMouseMoved: 'moved',
    kCGEventLeftMouseDown: 'down',
    kCGEventLeftMouseDragged: 'dragged',
    kCGEventLeftMouseUp: 'up',
    kCGHIDEventTap: 'hid',
    kCGMouseButtonLeft: 0,
    CGEventCreate: () => ({}),
    CGEventGetLocation: () => ({ ...cursor }),
    CGEventCreateMouseEvent: (_s: unknown, type: string, p: { x: number; y: number }) => ({ type, p }),
    CGEventPost: (_tap: unknown, e: { type: string; p: { x: number; y: number } }) => {
      now += opts.postMs ?? 1;
      posts.push({ type: e.type, ...e.p, at: now });
      if (!opts.refusePosts) cursor = { ...e.p };
    },
    CGWarpMouseCursorPosition: (p: { x: number; y: number }) => {
      warps.push({ type: 'warp', ...p, at: now });
      cursor = { ...p };
    },
    NSThread: {
      sleepForTimeInterval: (s: number) => {
        if (++naps > 10_000) throw new Error(`runaway: ${naps} sleeps, last ${s}`);
        now += s * 1000;
      },
    },
  };
  const ObjC = { import: () => {} };
  const FakeDate = { now: () => now };
  const started = now;
  const out = new Function('$', 'ObjC', 'Date', `return eval(${JSON.stringify(script)});`)($, ObjC, FakeDate) as string;
  return { result: JSON.parse(out) as Record<string, boolean>, posts, warps, elapsed: now - started, cursor };
}

describe('the macOS cursor scripts (critique mac1 m1, round 3 n4)', () => {
  it('glide on a wall-clock schedule: about 420 ms of travel however slow a post is, at about 120 Hz', () => {
    for (const postMs of [1, 6]) {
      const r = run(glideScript({ x: 600, y: 400 }), { postMs, start: { x: 100, y: 100 } });
      expect(r.result).toEqual({ moved: true, warped: false });
      // 420 ms of travel, then the 50 ms arrival wait (and at most a tick and a post late).
      expect(r.elapsed).toBeGreaterThanOrEqual(470);
      expect(r.elapsed).toBeLessThan(470 + 10 + 2 * postMs);
      const moves = r.posts.filter((p) => p.type === 'moved');
      expect(moves.at(-1)).toMatchObject({ x: 600, y: 400 });
      // About 120 a second while posting is cheap; fewer, never longer, when it is not.
      if (postMs === 1) expect(moves.length).toBeGreaterThanOrEqual(45);
      for (let i = 1; i < moves.length; i++) expect(moves[i]!.at - moves[i - 1]!.at).toBeLessThan(10 + postMs);
    }
  });

  it('a refused post goes the same eased way by warps, and warpOnly does not try posting first', () => {
    const refused = run(glideScript({ x: 300, y: 200 }), { refusePosts: true });
    expect(refused.result).toEqual({ moved: false, warped: true });
    expect(refused.elapsed).toBeGreaterThan(2 * 470 - 1); // the refused glide, then the warps
    const warpOnly = run(glideScript({ x: 300, y: 200 }, { warpOnly: true }), { refusePosts: true });
    expect(warpOnly.result).toEqual({ moved: false, warped: true });
    expect(warpOnly.posts).toHaveLength(0);
    expect(warpOnly.elapsed).toBeLessThan(470 + 12);
    expect(warpOnly.warps.at(-1)).toMatchObject({ x: 300, y: 200 });
  });

  it('a drag presses, drags on the same schedule, releases, and checks the arrival 50 ms after', () => {
    const r = run(dragScript({ x: 100, y: 300 }, { x: 180, y: 300 }), { start: { x: 100, y: 300 } });
    expect(r.result).toEqual({ moved: true });
    expect(r.posts[0]).toMatchObject({ type: 'down', x: 100, y: 300 });
    expect(r.posts.at(-1)).toMatchObject({ type: 'up', x: 180, y: 300 });
    expect(r.posts.filter((p) => p.type === 'dragged').length).toBeGreaterThan(60);
    expect(r.elapsed).toBeGreaterThanOrEqual(80 + 600 + 50);
  });
});
