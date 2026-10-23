import { describe, expect, it } from 'vitest';
import { busyReducer, busyScreen, type BusyEvent, type BusyState } from './busyScreen';

const run = (...events: BusyEvent[]) => events.reduce<BusyState | null>(busyReducer, null);

describe('the busy screen of a drop into the empty library (design-spec 6; Mac run 3, critique n6)', () => {
  it('shows nothing for the first 300 ms: an import that ends sooner never shows the text', () => {
    const s = run({ type: 'start', count: 8 });
    expect(busyScreen(s)).toEqual({ count: 8, text: false, holding: false });
    expect(busyScreen(busyReducer(s, { type: 'end' }))).toBeNull();
  });

  it('shows the text once the import is still running 300 ms after the first frame', () => {
    expect(busyScreen(run({ type: 'start', count: 8 }, { type: 'delayDone' }))).toEqual({ count: 8, text: true, holding: true });
  });

  it('once painted, the text stays its minimum time even when the import ends or the rows come at once', () => {
    const shown = run({ type: 'start', count: 8 }, { type: 'delayDone' }, { type: 'textPainted', at: 1000 });
    const ended = busyReducer(shown, { type: 'end' });
    expect(busyScreen(ended)).toEqual({ count: 8, text: true, holding: true });
    expect(busyReducer(ended, { type: 'minDone' })).toBeNull();
  });

  it('a text up for its minimum time ends with the import; while the import runs it stays, no longer holding', () => {
    const done = run({ type: 'start', count: 2 }, { type: 'delayDone' }, { type: 'textPainted', at: 1000 }, { type: 'minDone' });
    expect(busyScreen(done)).toEqual({ count: 2, text: true, holding: false });
    expect(busyReducer(done, { type: 'end' })).toBeNull();
  });

  it('a late delay after the end shows nothing, and only the first painted frame counts', () => {
    expect(run({ type: 'start', count: 2 }, { type: 'end' }, { type: 'delayDone' })).toBeNull();
    const twice = run({ type: 'start', count: 2 }, { type: 'delayDone' }, { type: 'textPainted', at: 1000 }, { type: 'textPainted', at: 2000 });
    expect(twice?.textAt).toBe(1000);
  });
});
