import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { LibraryItem } from '@learn/domain';
import { api, unwrap } from '../../api';
import { t } from '../../strings';
import { showActionFailed, showToast, showUndoToast } from '../../ui/toasts';
import type { PositionHandle } from '../usePosition';
import { pickTrack } from './defaultTrack';
import { attachInChunks, splitDroppedPaths } from '../../shell/subtitleDrop';
import { attachToasts } from './subtitleToasts';
import { useTracks } from './useSubtitles';
import type { VideoHandle, VideoStore } from './videoStore';

type SubtitleHandle = Pick<VideoHandle, 'toggleCaptions' | 'selectTrack' | 'captionsOff' | 'addSubtitles' | 'attachPaths' | 'removeTrack'>;

/**
 * Which track the video shows and whether it is on (spec 4.4, 5.5, 6.5). The tracks come from main; the remembered choice is the saved
 * locator's `captions`. The first time both are known the default is picked (the remembered track if it is still there, else Korean, else
 * the first); a track that goes while it is chosen gives way to the default again. A choice made by the person is saved at once (`save`).
 * Returns what the locator carries and the handle's part.
 */
export function useSubtitleState(item: LibraryItem, store: StoreApi<VideoStore>, pos: PositionHandle, save: () => void): { captions(): { assetId: string; on: boolean } | undefined; handle: SubtitleHandle } {
  const tracks = useTracks(item.id);
  const reconciled = useRef(false);
  const saved = pos.saved?.locator.kind === 'video' ? pos.saved.locator.captions : undefined;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!tracks || !pos.loaded) return;
    const cur = store.getState();
    if (cur.tracks !== tracks) cur.patch({ tracks });
    if (!reconciled.current) {
      reconciled.current = true;
      const pick = pickTrack(tracks, saved);
      cur.patch({ trackId: pick.trackId, captionsOn: pick.on });
      return;
    }
    if (cur.trackId === null ? tracks.length === 0 : tracks.some((track) => track.assetId === cur.trackId)) return;
    const pick = pickTrack(tracks, undefined);
    cur.patch({ trackId: pick.trackId, captionsOn: pick.on });
    saveRef.current();
  }, [tracks, pos.loaded, saved, store]);

  const itemId = item.id;
  const busy = useRef(false);
  const handle = useRef<SubtitleHandle | null>(null);
  handle.current ??= (() => {
    const select = (assetId: string): void => {
      // A reader that has gone (its handle is cleared on unmount) has no choice to make: an undo after it is a no-op here.
      if (store.getState().handle === null) return;
      store.getState().patch({ trackId: assetId, captionsOn: true });
      saveRef.current();
    };
    const guarded = (fn: () => Promise<void>): void => {
      if (busy.current) return;
      busy.current = true;
      void fn()
        .catch((e: unknown) => showActionFailed(e))
        .finally(() => {
          busy.current = false;
        });
    };
    return {
      toggleCaptions: () => {
        const s = store.getState();
        if (s.trackId === null) return;
        s.patch({ captionsOn: !s.captionsOn });
        saveRef.current();
      },
      selectTrack: select,
      captionsOff: () => {
        const s = store.getState();
        if (s.trackId === null || !s.captionsOn) return;
        s.patch({ captionsOn: false });
        saveRef.current();
      },
      addSubtitles: () =>
        guarded(async () => {
          const result = await unwrap(api().subtitles.pick({ itemId }));
          for (const toast of attachToasts(result)) showToast(toast);
          const first = result.added[0];
          if (first) select(first.assetId);
        }),
      attachPaths: (paths) =>
        guarded(async () => {
          const { subtitles, rejected } = splitDroppedPaths(paths);
          const attached = await attachInChunks(subtitles, (chunk) => unwrap(api().subtitles.attach({ itemId, paths: chunk })));
          for (const toast of attachToasts({ ...attached, failed: [...rejected, ...attached.failed] })) showToast(toast);
          const first = attached.added[0];
          if (first) select(first.assetId);
        }),
      removeTrack: (name) =>
        guarded(async () => {
          const assetId = store.getState().trackId;
          if (assetId === null) return;
          const removed = await unwrap(api().subtitles.remove({ itemId, assetId }));
          // The next track by the default rule, at once: the list read again after main's notice would find the same.
          const rest = store.getState().tracks.filter((track) => track.assetId !== assetId);
          const pick = pickTrack(rest, undefined);
          store.getState().patch({ trackId: pick.trackId, captionsOn: pick.on });
          saveRef.current();
          showUndoToast(
            t.video.removed(name),
            async () => select((await unwrap(api().subtitles.restore({ itemId, assetId, position: removed.position, language: removed.language }))).assetId),
            { testId: 'subtitle-removed' },
          );
        }),
    };
  })();

  return {
    captions: () => {
      const s = store.getState();
      if (s.trackId !== null) return { assetId: s.trackId, on: s.captionsOn };
      // Before the tracks are known the remembered choice stays as it was: closing early must not forget it.
      return reconciled.current ? undefined : savedRef.current;
    },
    handle: handle.current,
  };
}
