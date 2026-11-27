import type { StoreApi } from 'zustand/vanilla';
import type { AttachResult, RemovedTrack, SubtitleTrack } from '@learn/domain';
import { attachInChunks, splitDroppedPaths } from '../../shell/subtitleDrop';
import { t } from '../../strings';
import type { ToastData } from '../../ui/toasts';
import { pickTrack } from './defaultTrack';
import { attachToasts } from './subtitleToasts';
import type { VideoHandle, VideoStore } from './videoStore';

export type SubtitleHandle = Pick<VideoHandle, 'toggleCaptions' | 'selectTrack' | 'captionsOff' | 'addSubtitles' | 'attachPaths' | 'removeTrack'>;

/** What the subtitle actions ask of main and of the screen: the app's api and toasts, or a test's. */
export interface SubtitleActionDeps {
  itemId: string;
  store: StoreApi<VideoStore>;
  /** A choice the person made is saved at once. */
  save(): void;
  pick(itemId: string): Promise<AttachResult>;
  attach(itemId: string, paths: string[]): Promise<AttachResult>;
  remove(itemId: string, assetId: string): Promise<RemovedTrack>;
  restore(input: { itemId: string; assetId: string; position: number; language: string | null }): Promise<SubtitleTrack>;
  toast(data: ToastData): void;
  undoToast(title: string, undo: () => Promise<void>, opts: { testId: string }): void;
  failed(e: unknown): void;
}

/**
 * The video's subtitle actions (spec 5.4, 5.5, 6.5). Those that ask main run one at a time in the order they were asked: a drop or
 * 이 자막 제거 while an attach runs waits for it and then happens, rather than being lost.
 */
export function createSubtitleActions(d: SubtitleActionDeps): SubtitleHandle {
  const { itemId, store } = d;
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = last.then(fn);
    last = run.catch(() => {});
    return run;
  };
  const queued = (fn: () => Promise<void>): void => void inTurn(fn).catch((e: unknown) => d.failed(e));
  const select = (assetId: string): void => {
    // A reader that has gone (its handle is cleared on unmount) has no choice to make: an undo after it is a no-op here.
    if (store.getState().handle === null) return;
    store.getState().patch({ trackId: assetId, captionsOn: true });
    d.save();
  };
  const announce = (result: AttachResult): void => {
    for (const toast of attachToasts(result)) d.toast(toast);
    const first = result.added[0];
    if (first) select(first.assetId);
  };
  return {
    toggleCaptions: () => {
      const s = store.getState();
      if (s.trackId === null) return;
      s.patch({ captionsOn: !s.captionsOn });
      d.save();
    },
    selectTrack: select,
    captionsOff: () => {
      const s = store.getState();
      if (s.trackId === null || !s.captionsOn) return;
      s.patch({ captionsOn: false });
      d.save();
    },
    addSubtitles: () => queued(async () => announce(await d.pick(itemId))),
    attachPaths: (paths) =>
      queued(async () => {
        const { subtitles, rejected } = splitDroppedPaths(paths);
        const attached = await attachInChunks(subtitles, (chunk) => d.attach(itemId, chunk));
        announce({ ...attached, failed: [...rejected, ...attached.failed] });
      }),
    removeTrack: (name) => {
      // The track shown when the person asked, whatever an action before this one shows by the time it runs.
      const assetId = store.getState().trackId;
      if (assetId === null) return;
      queued(async () => {
        const removed = await d.remove(itemId, assetId);
        // Still shown: the next track by the default rule, at once (the list read again after main's notice would find the same).
        if (store.getState().trackId === assetId) {
          const pick = pickTrack(store.getState().tracks.filter((track) => track.assetId !== assetId), undefined);
          store.getState().patch({ trackId: pick.trackId, captionsOn: pick.on });
          d.save();
        }
        d.undoToast(t.video.removed(name), () => inTurn(async () => select((await d.restore({ itemId, assetId, position: removed.position, language: removed.language })).assetId)), {
          testId: 'subtitle-removed',
        });
      });
    },
  };
}
