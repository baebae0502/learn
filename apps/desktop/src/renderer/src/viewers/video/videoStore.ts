import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PlaybackRate, SubtitleTrack } from '@learn/domain';

/** opening: before the first frame; ready: it plays; unplayable: the engine cannot decode it; failed: it did not open for another reason. */
export type VideoStatus = 'opening' | 'ready' | 'unplayable' | 'failed';

/** What the commands and the controls do to the shown video, whoever presses. */
export interface VideoHandle {
  togglePlay(): void;
  seekBy(ms: number): void;
  seekTo(ms: number): void;
  frame(dir: -1 | 1): void;
  setRate(rate: PlaybackRate): void;
  nudgeRate(dir: -1 | 1): void;
  toggleMute(): void;
  setVolume(v: number): void;
  /** C: the shown track on or off (nothing without a track). */
  toggleCaptions(): void;
  /** The menu's choice of a track: it is shown from now on, and remembered. */
  selectTrack(assetId: string): void;
  captionsOff(): void;
  /** 자막 파일 추가…: the open panel, then the toasts and the new track on. */
  addSubtitles(): void;
  /** 이 자막 제거: takes the shown track off, with a toast that brings it back. `name` is how the screen calls it. */
  removeTrack(name: string): void;
}

export interface VideoStore {
  status: VideoStatus;
  playing: boolean;
  timeMs: number;
  durationMs: number;
  bufferedMs: number;
  /** One frame in ms, as far as the player has shown it (frameStep.ts). */
  frameMs: number;
  /** The volume bar's value while it is being dragged: the sound follows it at once, the setting is written when the drag ends. */
  volumeDraft: number | null;
  /** The video's subtitle tracks in their order (read by the reader), the one chosen, whether it shows, and the overlay's text (for tests). */
  tracks: SubtitleTrack[];
  trackId: string | null;
  captionsOn: boolean;
  cueText: string | null;
  handle: VideoHandle | null;
  patch(p: Partial<Omit<VideoStore, 'patch' | 'setHandle'>>): void;
  setHandle(h: VideoHandle | null): void;
}

/** One video reader's state; the store of each document is made with its scope (viewers/readerScope). */
export function createVideoStore(): StoreApi<VideoStore> {
  return createStore<VideoStore>()((set) => ({
    status: 'opening',
    playing: false,
    timeMs: 0,
    durationMs: 0,
    bufferedMs: 0,
    frameMs: 1000 / 30,
    volumeDraft: null,
    tracks: [],
    trackId: null,
    captionsOn: false,
    cueText: null,
    handle: null,
    patch: (p) => set(p),
    setHandle: (handle) => set({ handle }),
  }));
}

/** The shown reader's video state (the scope's, like useReader). */
export { useVideoScoped as useVideo } from '../readerScope';

/** What a test reads of the video: the element's own values beside the store's (E2E only, window.__learnVideo). */
export interface VideoProbe {
  status: VideoStatus;
  timeMs: number;
  paused: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  frameMs: number;
  trackId: string | null;
  captionsOn: boolean;
  /** The text the overlay shows (the cues on, one line each), null while it shows nothing. */
  cueText: string | null;
}
