import { afterEach, describe, expect, it } from 'vitest';
import { closeToast, showJobToast, showToast, toastQueue } from './toasts';

afterEach(() => {
  for (const toast of [...toastQueue.visibleToasts]) toastQueue.close(toast.key);
});

describe('which toasts are on screen (M6 m-3)', () => {
  it('keeps a job toast visible under three newer ordinary ones, the rest newest first', () => {
    const job = showJobToast('import');
    const keys = ['a', 'b', 'c'].map((title) => showToast({ kind: 'info', title }));
    const shown = toastQueue.visibleToasts.map((t) => t.key);
    expect(shown).toHaveLength(3);
    expect(shown).toContain(job);
    expect(shown).toEqual([keys[2], keys[1], job]);
    closeToast(job);
    expect(toastQueue.visibleToasts.map((t) => t.key)).toEqual([keys[2], keys[1], keys[0]]);
  });
});
