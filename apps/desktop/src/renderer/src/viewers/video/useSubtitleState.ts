import { useEffect, useRef } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { LibraryItem } from '@learn/domain';
import { api, unwrap } from '../../api';
import { showActionFailed, showToast, showUndoToast } from '../../ui/toasts';
import type { PositionHandle } from '../usePosition';
import { pickTrack } from './defaultTrack';
import { createSubtitleActions, type SubtitleHandle } from './subtitleActions';
import { useTracks } from './useSubtitles';
import type { VideoStore } from './videoStore';

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

  const handle = useRef<SubtitleHandle | null>(null);
  handle.current ??= createSubtitleActions({
    itemId: item.id,
    store,
    save: () => saveRef.current(),
    pick: (itemId) => unwrap(api().subtitles.pick({ itemId })),
    attach: (itemId, paths) => unwrap(api().subtitles.attach({ itemId, paths })),
    remove: (itemId, assetId) => unwrap(api().subtitles.remove({ itemId, assetId })),
    restore: (input) => unwrap(api().subtitles.restore(input)),
    toast: (data) => void showToast(data),
    undoToast: (title, undo, opts) => void showUndoToast(title, undo, opts),
    failed: showActionFailed,
  });

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
