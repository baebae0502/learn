import { afterEach, describe, expect, it } from 'vitest';
import { showUndoToast, toastQueue, type ToastData } from './toasts';

/** The queue lists the newest toast first. */
const last = (): ToastData => toastQueue.visibleToasts[0]!.content;
afterEach(() => {
  for (const toast of [...toastQueue.visibleToasts]) toastQueue.close(toast.key);
});

describe('showUndoToast (spec 3.4, 8.2)', () => {
  it('is a success toast with one verb, 실행 취소, that runs the undo', async () => {
    let undone = 0;
    showUndoToast('‘학회 준비’\u2060를 삭제했습니다', async () => void undone++);
    expect(last()).toMatchObject({ kind: 'success', title: '‘학회 준비’\u2060를 삭제했습니다', testId: 'undo-toast', action: { label: '실행 취소', testId: 'undo-action' } });
    last().action!.onAction();
    await Promise.resolve();
    expect(undone).toBe(1);
  });
  it('a refused undo is told as an error with main\'s words, not swallowed', async () => {
    showUndoToast('x', async () => {
      throw new Error('컬렉션을 찾을 수 없습니다.');
    });
    last().action!.onAction();
    await new Promise((r) => setTimeout(r, 0));
    expect(last()).toMatchObject({ kind: 'error', title: '되돌리지 못했습니다', body: '컬렉션을 찾을 수 없습니다.', testId: 'undo-failed' });
  });
});
