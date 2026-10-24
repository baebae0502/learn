// Long animation frames around a drop (spec 8, the drop stall): what the page's LoAF observer saw, summarised next to
// the app's learn: marks, and the cause the fix for the stall is picked by.

/** One entry of the page's PerformanceObserver({ type: 'long-animation-frame' }) (frames of 50 ms or more). */
export interface LongFrame {
  startTime: number;
  duration: number;
  /** 0 when the frame had no rendering phase. */
  renderStart: number;
  /** 0 when the frame had no style-and-layout phase. */
  styleAndLayoutStart: number;
  blockingDuration: number;
  scripts: ReadonlyArray<{
    invoker: string;
    invokerType: string;
    sourceFunctionName: string;
    sourceURL: string;
    sourceCharPosition: number;
    startTime: number;
    duration: number;
    forcedStyleAndLayoutDuration: number;
  }>;
}
/** A User Timing mark on the page's clock (performance.now()). */
export interface Mark {
  name: string;
  at: number;
}

export interface LongFrameSummary {
  /** From the drop. */
  atMs: number;
  durationMs: number;
  scriptMs: number;
  forcedLayoutMs: number;
  /** From the frame's rendering phase (animation frames, observers, style, layout, paint) to its end. */
  renderMs: number;
  /** From its style-and-layout phase to its end. */
  styleLayoutMs: number;
  /** The learn: marks inside it, without the prefix, in time order. */
  marks: string[];
  /** Its three longest scripts (bundle file and character position: the production bundle has short names). */
  scripts: Array<{ invoker: string; type: string; fn: string; at: string; ms: number; forcedLayoutMs: number }>;
}

/** spec 8: a drop's longest frame gap on the Mac (page, drop-import.json) at most this. */
export const STALL_LIMIT_MS = 100;

const ms = (x: number) => Math.round(x);

export function summarizeLongFrames(frames: readonly LongFrame[], marks: readonly Mark[], origin: number): LongFrameSummary[] {
  return frames
    .filter((f) => f.startTime + f.duration >= origin)
    .map((f) => {
      const end = f.startTime + f.duration;
      return {
        atMs: ms(f.startTime - origin),
        durationMs: ms(f.duration),
        scriptMs: ms(f.scripts.reduce((n, s) => n + s.duration, 0)),
        forcedLayoutMs: ms(f.scripts.reduce((n, s) => n + s.forcedStyleAndLayoutDuration, 0)),
        renderMs: f.renderStart > 0 ? ms(end - f.renderStart) : 0,
        styleLayoutMs: f.styleAndLayoutStart > 0 ? ms(end - f.styleAndLayoutStart) : 0,
        marks: marks
          .filter((m) => m.at >= f.startTime && m.at <= end)
          .sort((a, b) => a.at - b.at)
          .map((m) => m.name.replace(/^learn:/, '')),
        scripts: [...f.scripts]
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 3)
          .map((s) => ({
            invoker: s.invoker,
            type: s.invokerType,
            fn: s.sourceFunctionName,
            at: `${s.sourceURL.split('/').pop() ?? ''}:${s.sourceCharPosition}`,
            ms: ms(s.duration),
            forcedLayoutMs: ms(s.forcedStyleAndLayoutDuration),
          })),
      };
    })
    .sort((a, b) => b.durationMs - a.durationMs);
}

export type StallCause = 'none' | 'unmeasured' | 'styleLayout' | 'inspector' | 'script';
export interface Stall {
  cause: StallCause;
  /** The item panel's part of the longest frame's render, 2 decimals; null without the table and panel marks in it. */
  inspectorShare: number | null;
}

/**
 * Which fix the longest frame (`frames[0]`) calls for: 'styleLayout' when style, layout and forced layout take half of
 * it or more (first-use faces and glyph runs, Intl data); else 'inspector' when scripts take half or more and the item
 * panel's part of the render — learn:inspector:render to learn:table:painted (or the frame's end), against
 * learn:table:render to the same — is 0.4 or more; else 'script'.
 */
export function stallCause(gapMs: number, frames: readonly LongFrameSummary[], marks: readonly Mark[], origin: number): Stall {
  if (gapMs <= STALL_LIMIT_MS) return { cause: 'none', inspectorShare: null };
  const longest = frames[0];
  if (!longest) return { cause: 'unmeasured', inspectorShare: null };
  const start = longest.atMs;
  const end = longest.atMs + longest.durationMs;
  const rel = marks.map((m) => ({ name: m.name.replace(/^learn:/, ''), at: m.at - origin }));
  const inFrame = (name: string, from: number) => rel.filter((m) => m.name === name && m.at >= from && m.at <= end).map((m) => m.at);
  const tableAt = inFrame('table:render', start).at(-1);
  const inspectorAt = tableAt === undefined ? undefined : inFrame('inspector:render', tableAt)[0];
  const paintedAt = inspectorAt === undefined ? end : (inFrame('table:painted', inspectorAt)[0] ?? end);
  const inspectorShare = tableAt !== undefined && inspectorAt !== undefined && paintedAt > tableAt ? Math.round(((paintedAt - inspectorAt) / (paintedAt - tableAt)) * 100) / 100 : null;
  if ((longest.styleLayoutMs + longest.forcedLayoutMs) / longest.durationMs >= 0.5) return { cause: 'styleLayout', inspectorShare };
  if (longest.scriptMs / longest.durationMs >= 0.5 && inspectorShare !== null && inspectorShare >= 0.4) return { cause: 'inspector', inspectorShare };
  return { cause: 'script', inspectorShare };
}
