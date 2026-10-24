import { describe, expect, it } from 'vitest';
import { STALL_LIMIT_MS, stallCause, summarizeLongFrames, type LongFrame } from './long-frames';

const frame = (over: Partial<LongFrame> = {}): LongFrame => ({ startTime: 1100, duration: 200, renderStart: 1250, styleAndLayoutStart: 1260, blockingDuration: 150, scripts: [], ...over });
const script = (duration: number, forced = 0, fn = 'a') => ({
  invoker: 'MessagePort.onmessage', invokerType: 'event-listener', sourceFunctionName: fn, sourceURL: 'learn://app/assets/App-x.js', sourceCharPosition: 10,
  startTime: 1100, duration, forcedStyleAndLayoutDuration: forced,
});
const at = (name: string, t: number) => ({ name: `learn:${name}`, at: t });

describe('long animation frames after a drop (spec 8: the drop stall)', () => {
  it('summarises a frame: its phases, the learn: marks inside it, its longest scripts first', () => {
    const marks = [at('drop', 1000), at('table:render', 1120), at('table:painted', 1255), at('toast:import-done', 1400)];
    const [s] = summarizeLongFrames([frame({ scripts: [script(30, 0, 'b'), script(120, 20, 'c'), script(10)] })], marks, 1000);
    expect(s).toEqual({
      atMs: 100, durationMs: 200, scriptMs: 160, forcedLayoutMs: 20, renderMs: 50, styleLayoutMs: 40,
      marks: ['table:render', 'table:painted'],
      scripts: [
        { invoker: 'MessagePort.onmessage', type: 'event-listener', fn: 'c', at: 'App-x.js:10', ms: 120, forcedLayoutMs: 20 },
        { invoker: 'MessagePort.onmessage', type: 'event-listener', fn: 'b', at: 'App-x.js:10', ms: 30, forcedLayoutMs: 0 },
        { invoker: 'MessagePort.onmessage', type: 'event-listener', fn: 'a', at: 'App-x.js:10', ms: 10, forcedLayoutMs: 0 },
      ],
    });
  });

  it('leaves out frames that ended before the drop and puts the longest first', () => {
    const s = summarizeLongFrames([frame({ startTime: 500, duration: 300 }), frame({ startTime: 1100, duration: 60 }), frame({ startTime: 1300, duration: 90 })], [], 1000);
    expect(s.map((f) => f.durationMs)).toEqual([90, 60]);
  });
});

describe("Step 9's rule: which fix a drop's longest frame calls for", () => {
  const marks = (inspectorAt: number) => [at('table:render', 1110), at('inspector:render', inspectorAt), at('table:painted', 1250)];
  const summary = (over: Partial<LongFrame>, m = marks(1150)) => summarizeLongFrames([frame(over)], m, 1000);

  it('none within the limit; unmeasured without long-frame entries', () => {
    expect(STALL_LIMIT_MS).toBe(100);
    expect(stallCause(90, summary({}), [], 1000).cause).toBe('none');
    expect(stallCause(300, [], [], 1000).cause).toBe('unmeasured');
  });
  it('styleLayout when style, layout and forced layout take half the frame or more', () => {
    expect(stallCause(300, summary({ styleAndLayoutStart: 1200, scripts: [script(80, 10)] }), [], 1000).cause).toBe('styleLayout');
  });
  it("inspector when scripts dominate and the item panel's part of the render is 0.4 or more", () => {
    const m = marks(1150);
    expect(stallCause(300, summary({ styleAndLayoutStart: 1290, scripts: [script(150)] }, m), m, 1000)).toEqual({ cause: 'inspector', inspectorShare: 0.71 });
  });
  it('script otherwise', () => {
    const m = marks(1230);
    expect(stallCause(300, summary({ styleAndLayoutStart: 1290, scripts: [script(150)] }, m), m, 1000)).toEqual({ cause: 'script', inspectorShare: 0.14 });
  });
});
