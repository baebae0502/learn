import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PlaybackRate, SubtitleTrack } from '@learn/domain';
import type { CueHit } from './transcriptSearch';

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
  /** Files dropped on the tab: the ones that are no subtitle are failure rows, the rest are attached as the panel's pick is. */
  attachPaths(paths: readonly string[]): void;
  /** 이 자막 제거: takes the shown track off, with a toast that brings it back. `name` is how the screen calls it. */
  removeTrack(name: string): void;
}

/**
 * The transcript pane's state (spec 7), kept with the video so a tab that leaves the sidebar and comes back finds its search as it was.
 * `follow` is on whenever a tab opens (never saved); `query` is the field's text and `hits` the cues it found at the last search; `hit` is
 * the match marked current (the last ↩'s, or before one the first on or after the playhead; -1: none); `cursor` is the keyboard row of the list (-1: none); `wrapped` says the last ↩ came round from the end.
 */
export interface TranscriptState {
  follow: boolean;
  query: string;
  hits: CueHit[];
  hit: number;
  /** The last ↩ has gone to `hit`: until then `hit` is only the match marked on the playhead's side, and the first ↩ starts from the playhead. */
  arrived: boolean;
  cursor: number;
  wrapped: boolean;
}

export const INITIAL_TRANSCRIPT: TranscriptState = { follow: true, query: '', hits: [], hit: -1, arrived: false, cursor: -1, wrapped: false };

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
  transcript: TranscriptState;
  /** ⌘F: counted up to take the transcript search field's focus (the pane answers when it is shown). */
  transcriptFocus: number;
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
    transcript: INITIAL_TRANSCRIPT,
    transcriptFocus: 0,
    handle: null,
    patch: (p) => set(p),
    setHandle: (handle) => set({ handle }),
  }));
}

/** Changes some of the transcript's fields. */
export function patchTranscript(store: StoreApi<VideoStore>, p: Partial<TranscriptState>): void {
  store.getState().patch({ transcript: { ...store.getState().transcript, ...p } });
}

/** The shown reader's video state (the scope's, like useReader). */
export { useVideoScoped as useVideo } from '../readerScope';

/** What a test reads of the video: the element's own values beside the store's (E2E only, window.__learnVideo). */
export interface VideoProbe {
  status: VideoStatus;
  timeMs: number;
  paused: boolean;
  /** The store's play state, which the keys' rules read (videoPlaying): it follows the element's play and pause events. */
  playing: boolean;
  rate: number;
  volume: number;
  muted: boolean;
  frameMs: number;
  trackId: string | null;
  captionsOn: boolean;
  /** The text the overlay shows (the cues on, one line each), null while it shows nothing. */
  cueText: string | null;
}
