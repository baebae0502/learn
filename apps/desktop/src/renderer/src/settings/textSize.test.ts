import { describe, expect, it, vi } from 'vitest';
import { createTextSizeSetter, type TextSize } from './textSize';

/** A prefs store that answers when told: writes resolve in order, and the known size follows each confirmed write. */
function fakeStore(initial: TextSize) {
  let known = initial;
  const writes: Array<{ size: TextSize; done(ok: boolean): void }> = [];
  return {
    known: () => known,
    writes,
    write: (size: TextSize) =>
      new Promise<void>((resolve, reject) => {
        writes.push({
          size,
          done: (ok) => {
            if (ok) {
              known = size; // prefsChanged lands before the invoke's answer
              resolve();
            } else reject(new Error('환경설정을 저장하지 못했습니다.'));
          },
        });
      }),
  };
}
const bigger = (s: TextSize) => Math.min(15, s + 1) as TextSize;
const smaller = (s: TextSize) => Math.max(12, s - 1) as TextSize;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('text size steps from the latest size asked for (review minor 6)', () => {
  it('two quick ⌘+ before prefsChanged comes back ask for 14, then 15 (not 14 twice)', async () => {
    const store = fakeStore(13);
    const set = createTextSizeSetter({ known: store.known, write: store.write, failed: vi.fn() });
    set(bigger);
    set(bigger);
    expect(store.writes.map((w) => w.size)).toEqual([14, 15]);
    store.writes[0]!.done(true);
    store.writes[1]!.done(true);
    await flush();
    set(smaller); // from the confirmed 15
    expect(store.writes.map((w) => w.size)).toEqual([14, 15, 14]);
  });
  it('an answer for an older step does not drop the newer one; a failed step falls back to the confirmed size', async () => {
    const store = fakeStore(13);
    const failed = vi.fn();
    const set = createTextSizeSetter({ known: store.known, write: store.write, failed });
    set(bigger); // 14
    set(bigger); // 15
    store.writes[0]!.done(true); // 14 confirmed while 15 is still on its way
    await flush();
    set(smaller); // from 15, the newest asked for
    expect(store.writes.at(-1)!.size).toBe(14);
    store.writes[1]!.done(false); // 15 refused
    store.writes[2]!.done(false); // and the 14 after it
    await flush();
    expect(failed).toHaveBeenCalledTimes(2);
    set(bigger); // from the confirmed 14
    expect(store.writes.at(-1)!.size).toBe(15);
  });
  it('writes nothing when the step changes nothing (already at the end of the range)', () => {
    const store = fakeStore(15);
    const set = createTextSizeSetter({ known: store.known, write: store.write, failed: vi.fn() });
    set(bigger);
    set(() => 15);
    expect(store.writes).toEqual([]);
  });
});
