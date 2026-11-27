import { describe, expect, it, vi } from 'vitest';
import type { AttachResult, RemovedTrack, SubtitleTrack } from '@learn/domain';
import type { ToastData } from '../../ui/toasts';
import { createSubtitleActions, type SubtitleActionDeps } from './subtitleActions';
import { createVideoStore, type VideoHandle } from './videoStore';

const ITEM = '0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b';
const track = (assetId: string, language: string, position: number): SubtitleTrack => ({ assetId, language, position, originalName: `${language}.srt`, cueCount: 3 });
const KO = track('a0000000-0000-4000-8000-000000000001', 'ko', 0);
const EN = track('a0000000-0000-4000-8000-000000000002', 'en', 1);
const JA = track('a0000000-0000-4000-8000-000000000003', 'ja', 2);

/** A promise the test settles by hand: main's answer that has not come yet. */
function later<T>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup() {
  const store = createVideoStore();
  store.getState().patch({ tracks: [KO, EN], trackId: KO.assetId, captionsOn: true });
  store.getState().setHandle({} as VideoHandle);
  const calls: string[] = [];
  const toasts: ToastData[] = [];
  const undos: Array<{ title: string; undo: () => Promise<void> }> = [];
  const attach = later<AttachResult>();
  const deps: SubtitleActionDeps = {
    itemId: ITEM,
    store,
    save: vi.fn(),
    pick: async () => {
      calls.push('pick');
      return attach.promise;
    },
    attach: async (_itemId, paths) => {
      calls.push(`attach ${paths.join(',')}`);
      return { added: [], already: [], failed: [] };
    },
    remove: async (_itemId, assetId): Promise<RemovedTrack> => {
      calls.push(`remove ${assetId}`);
      return { position: 0, language: 'ko' };
    },
    restore: async (input) => {
      calls.push(`restore ${input.assetId}`);
      return KO;
    },
    toast: (data) => void toasts.push(data),
    undoToast: (title, undo) => void undos.push({ title, undo }),
    failed: vi.fn(),
  };
  return { store, calls, toasts, undos, attach, deps, actions: createSubtitleActions(deps) };
}
/** Lets every settled answer's continuation run. */
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the subtitle actions run one at a time, in the order asked (M8a spec 5.4, 5.5)', () => {
  it('이 자막 제거 sent while an attach is on its way happens after it, on the track shown when it was asked', async () => {
    const { store, calls, toasts, undos, attach, deps, actions } = setup();
    actions.addSubtitles();
    await drain();
    expect(calls).toEqual(['pick']);
    actions.removeTrack('한국어');
    await drain();
    expect(calls).toEqual(['pick']); // waits for the attach
    attach.resolve({ added: [JA], already: [], failed: [] });
    await drain();
    expect(calls).toEqual(['pick', `remove ${KO.assetId}`]);
    expect(toasts.map((x) => x.testId)).toEqual(['subtitle-attached']);
    expect(undos.map((u) => u.title)).toEqual(['‘한국어’ 자막을 제거했습니다']);
    // The attach chose its new track; the removal took the one shown before and leaves that choice.
    expect(store.getState()).toMatchObject({ trackId: JA.assetId, captionsOn: true });
    expect(deps.failed).not.toHaveBeenCalled();
  });

  it('a drop during an attach is attached after it', async () => {
    const { calls, attach, actions } = setup();
    actions.addSubtitles();
    actions.attachPaths(['/v/a.en.vtt', '/v/b.mp4']);
    await drain();
    expect(calls).toEqual(['pick']);
    attach.resolve({ added: [], already: [], failed: [] });
    await drain();
    expect(calls).toEqual(['pick', 'attach /v/a.en.vtt']);
  });

  it('a removal of the shown track picks the next by the default rule; its undo waits its turn too, and brings it back shown', async () => {
    const { store, calls, undos, attach, actions } = setup();
    actions.removeTrack('한국어');
    await drain();
    expect(store.getState()).toMatchObject({ trackId: EN.assetId, captionsOn: true });
    actions.addSubtitles();
    await drain();
    void undos[0]!.undo();
    await drain();
    expect(calls).toEqual([`remove ${KO.assetId}`, 'pick']);
    attach.resolve({ added: [], already: [], failed: [] });
    await drain();
    expect(calls).toEqual([`remove ${KO.assetId}`, 'pick', `restore ${KO.assetId}`]);
    expect(store.getState()).toMatchObject({ trackId: KO.assetId, captionsOn: true });
  });

  it('a refused action says so and the next one still runs', async () => {
    const { calls, deps } = setup();
    const refused = new Error('자막을 찾지 못했습니다.');
    deps.remove = async () => {
      calls.push('remove');
      throw refused;
    };
    const after = createSubtitleActions(deps);
    after.removeTrack('한국어');
    after.attachPaths(['/v/a.en.vtt']);
    await drain();
    expect(calls).toEqual(['remove', 'attach /v/a.en.vtt']);
    expect(deps.failed).toHaveBeenCalledWith(refused);
  });
});
