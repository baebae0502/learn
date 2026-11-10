import { describe, expect, it } from 'vitest';
import { describeTextState, jobCounts, type TextStateSnapshot } from './text-state';

describe('jobCounts', () => {
  it('counts the jobs by state and attempts, in key order', () => {
    const jobs = [
      ...Array.from({ length: 3 }, () => ({ state: 'queued', attempts: 0 })),
      { state: 'done', attempts: 1 },
      { state: 'queued', attempts: 1 },
      { state: 'done', attempts: 1 },
    ];
    expect(jobCounts(jobs)).toEqual({ 'done/1': 2, 'queued/0': 3, 'queued/1': 1 });
    expect(Object.keys(jobCounts(jobs))).toEqual(['done/1', 'queued/0', 'queued/1']);
    expect(jobCounts([])).toEqual({});
  });
});

describe('describeTextState', () => {
  const at = Date.parse('2026-11-09T23:17:59.870Z');
  const snapshot: TextStateSnapshot = {
    scheduler: {
      live: false, paused: false, looping: false, disposed: false, sawFirstIdle: true, sawChecked: false, skipDelay: true,
      delayStarted: false, delayDone: false, dirty: true, current: null, unavailable: 0, laneBusy: false, idleWaiters: 1, held: 0, holdAfter: null,
      lastError: null,
      events: [
        { at, what: 'control', detail: 'now' },
        { at, what: 'start-waits', detail: 'startupChecked' },
        { at: at + 2500, what: 'idle-wait' },
      ],
    },
    main: { firstIdle: { at: at - 17000, screen: 'ok', text: 'ok', settings: 'ok', sheets: 'ok' }, checkStart: at - 19000, checkEnd: 0, auto: 'pending', lane: null, imports: 'idle' },
  };

  it('the flags on one line, main\'s steps with ISO times on the next, then the trail one step a line', () => {
    const lines = describeTextState(snapshot).split('\n');
    expect(lines[0]).toBe(
      'scheduler: {"live":false,"paused":false,"looping":false,"disposed":false,"sawFirstIdle":true,"sawChecked":false,"skipDelay":true,'
        + '"delayStarted":false,"delayDone":false,"dirty":true,"current":null,"unavailable":0,"laneBusy":false,"idleWaiters":1,"held":0,"holdAfter":null,'
        + '"lastError":null}',
    );
    expect(JSON.parse(lines[1]!.slice('main: '.length))).toEqual({
      firstIdle: { at: '2026-11-09T23:17:42.870Z', screen: 'ok', text: 'ok', settings: 'ok', sheets: 'ok' },
      checkStart: '2026-11-09T23:17:40.870Z',
      checkEnd: '-',
      auto: 'pending',
      lane: null,
      imports: 'idle',
    });
    expect(lines.slice(2)).toEqual([
      'events (oldest first, 3):',
      '  2026-11-09T23:17:59.870Z control now',
      '  2026-11-09T23:17:59.870Z start-waits startupChecked',
      '  2026-11-09T23:18:02.370Z idle-wait',
    ]);
  });

  it('main is null when the app gave none', () => {
    expect(describeTextState({ ...snapshot, main: null }).split('\n')[1]).toBe('main: null');
  });
});
