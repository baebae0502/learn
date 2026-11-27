import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { PLAYBACK_RATES, RATE_STEP, assetUrl, isPlaybackRate, type LibraryItem, type PlaybackRate, type ReadingLocator } from '@learn/domain';
import { t } from '../../strings';
import { Spinner } from '../../ui/Spinner';
import { ratio, restoreVideoSeconds } from '../positionSaver';
import { CodecNotice } from '../ReaderNotices';
import { useReaderScope, useReaderShown } from '../readerScope';
import { keepsPendingJump, useReader } from '../pdf/readerStore';
import { usePosition } from '../usePosition';
import { useVideoStage } from '../../shell/videoStage';
import { SubtitleOverlay } from './SubtitleOverlay';
import { jumpSearch } from './timeJump';
import { useCues, useTracks } from './useSubtitles';
import { useStageToasts } from './useStageToasts';
import { useSubtitleState } from './useSubtitleState';
import { frameDurationMs } from './frameStep';
import { useIdleControls } from './useIdleControls';
import { useVideoSettings } from './useVideoSettings';
import { VideoControls } from './VideoControls';
import { VideoToolbar } from './VideoToolbar';
import { INITIAL_TRANSCRIPT, patchTranscript, useVideo, type VideoHandle } from './videoStore';

const TIME_SAVE = { kind: 'throttle', ms: 2000 } as const;
/** A first frame later than this shows the spinner: a quick open never flashes it (design-spec 6, 잠시 지나가는 상태). */
const SPINNER_AFTER_MS = 300;
/** How many shown frames the frame length is read from. */
const FRAME_SAMPLES = 12;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * The video reader (spec 6): the 44 px strip, the stage with the picture, and our own controls under it. The <video> has no controls
 * of its own; the stage takes the focus (F6 reaches it), a press on it plays or pauses, and the keys are the registry's. The controls
 * and the strip are drawn disabled until the first frame; a file the engine cannot play is a final state: the notice alone.
 */
export function VideoReader({ item }: { item: LibraryItem }) {
  const scope = useReaderScope();
  const store = scope.video;
  const status = useVideo((s) => s.status);
  const settings = useVideoSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [error, setError] = useState<{ unsupported: boolean } | null>(null);
  /**
   * A frame is decoded (loadeddata): only then is the player shown, so a file that turns out unplayable never shows a
   * bare grey player with its controls before the notice (T13-m6). If a platform gave metadata but no frame without
   * playing, the player still shows a second after the metadata.
   */
  const [frame, setFrame] = useState(false);
  const [slow, setSlow] = useState(false);
  const metadataAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null); // kept after unmount so the final time can still be read
  const restored = useRef(false);
  const [placed, setPlaced] = useState(false);
  const hintId = useId();
  const readerRef = useRef<HTMLDivElement>(null);
  const frames = useRef<number[]>([]);
  // A kept tab that is not shown does not play on behind the one that is (the pause also saves the place: onPause).
  const shown = useReaderShown();
  useEffect(() => {
    if (!shown) videoRef.current?.pause();
  }, [shown]);

  // The saved place carries the subtitle choice (spec 4.4): the track and whether it shows, once the video has tracks.
  const captionsRef = useRef<() => { assetId: string; on: boolean } | undefined>(() => undefined);
  const locatorAt = (v: HTMLVideoElement): ReadingLocator => {
    const captions = captionsRef.current();
    return { kind: 'video', timeMs: Math.round(v.currentTime * 1000), ...(captions ? { captions } : {}) };
  };
  const pos = usePosition(item, TIME_SAVE, () => {
    const v = videoRef.current;
    if (!v || !restored.current) return null;
    return { locator: locatorAt(v), progress: ratio(v.currentTime, v.duration) };
  });

  const record = (v: HTMLVideoElement, immediate: boolean) => {
    if (!restored.current) return;
    pos.update(locatorAt(v), ratio(v.currentTime, v.duration));
    if (immediate) pos.flush();
  };
  const subtitles = useSubtitleState(item, store, pos, () => {
    if (videoRef.current) record(videoRef.current, true);
  });
  captionsRef.current = subtitles.captions;
  const subtitleHandle = useRef(subtitles.handle);
  subtitleHandle.current = subtitles.handle;
  const trackId = useVideo((s) => s.trackId);
  const cues = useCues(item.id, trackId);

  const tryRestore = (v: HTMLVideoElement) => {
    if (restored.current || !pos.loaded || v.readyState < 1) return;
    // A 본문 일치 time row opened this reader: it is placed at that sentence, never first at the saved place.
    const pending = scope.reader.getState().pendingJump;
    const seconds = pending?.kind === 'time' && Number.isFinite(v.duration) ? clamp(pending.startMs / 1000, 0, v.duration) : restoreVideoSeconds(pos.saved?.locator, v.duration);
    if (seconds > 0) v.currentTime = seconds;
    const savedCaptions = pos.saved?.locator.kind === 'video' ? pos.saved.locator.captions : undefined;
    pos.markRestored({ kind: 'video', timeMs: Math.round(seconds * 1000), ...(savedCaptions ? { captions: savedCaptions } : {}) });
    restored.current = true;
    store.getState().patch({ timeMs: Math.round(seconds * 1000) });
    setPlaced(true);
  };

  // A 본문 일치 time row (spec 8.3): once the reader is placed and its tracks are settled, the row's track is shown and on, the video stands at
  // the sentence's start (paused: the row never starts playback), and the transcript search holds the query with that sentence marked,
  // following on. A reader that cannot show its file drops the row, as the PDF reader does.
  const jump = useReader((s) => (s.pendingJump?.kind === 'time' ? s.pendingJump : null));
  const listed = useTracks(item.id);
  const shownTracks = useVideo((s) => s.tracks);
  useEffect(() => {
    if (!jump) return;
    const reader = scope.reader.getState();
    if (!keepsPendingJump(error ? 'failed' : 'ready', false)) {
      reader.setPendingJump(null);
      return;
    }
    if (!placed || !listed || shownTracks !== listed) return;
    const want = jump.track !== null && listed.some((track) => track.assetId === jump.track) ? jump.track : store.getState().trackId;
    if (want !== null) {
      if (trackId !== want) {
        // The cues of that track come with the next render; the search is made then.
        subtitleHandle.current.selectTrack(want);
        return;
      }
      if (!store.getState().captionsOn) subtitleHandle.current.selectTrack(want);
      if (!cues) return;
    }
    store.getState().handle?.seekTo(jump.startMs);
    videoRef.current?.pause();
    const found = want !== null && cues ? jumpSearch(cues, jump.query, jump.startMs) : { hits: [], hit: -1 };
    patchTranscript(store, { query: jump.query, hits: found.hits, hit: found.hit, arrived: false, wrapped: false, follow: true, cursor: -1 });
    reader.setPendingJump(null);
  }, [jump, placed, listed, shownTracks, trackId, cues, error, scope, store]);

  // Metadata can arrive before the saved position does (or the other way round).
  useEffect(() => {
    if (videoRef.current) tryRestore(videoRef.current);
  }, [pos.loaded]);

  /** The element takes the remembered speed, volume and mute: once the settings are read, and again whenever one changes. */
  const apply = useCallback(() => {
    const v = videoRef.current;
    const s = settingsRef.current;
    if (!v || !s.loaded) return;
    v.defaultPlaybackRate = s.rate;
    v.playbackRate = s.rate;
    const draft = store.getState().volumeDraft;
    v.volume = draft ?? s.volume;
    v.muted = draft !== null && draft > 0 ? false : s.muted;
  }, [store]);
  const volumeDraft = useVideo((s) => s.volumeDraft);
  useEffect(apply, [apply, settings.loaded, settings.rate, settings.volume, settings.muted, volumeDraft]);

  const syncTime = (v: HTMLVideoElement) => store.getState().patch({ timeMs: Math.round(v.currentTime * 1000) });

  // One handle for the commands and the controls; it reads the element and the settings as they are when it is called.
  useEffect(() => {
    const el = () => videoRef.current;
    const handle: VideoHandle = {
      togglePlay: () => {
        const v = el();
        if (!v) return;
        if (v.paused) void v.play().catch(() => undefined);
        else v.pause();
      },
      seekBy: (ms) => {
        const v = el();
        if (v) handle.seekTo(v.currentTime * 1000 + ms);
      },
      seekTo: (ms) => {
        const v = el();
        if (!v || !Number.isFinite(v.duration)) return;
        v.currentTime = clamp(ms / 1000, 0, v.duration);
        syncTime(v);
      },
      frame: (dir) => {
        const v = el();
        if (!v || !v.paused || !Number.isFinite(v.duration)) return;
        v.currentTime = clamp(v.currentTime + (dir * store.getState().frameMs) / 1000, 0, v.duration);
        syncTime(v);
      },
      setRate: (rate) => settingsRef.current.setRate(rate),
      nudgeRate: (dir) => {
        const next = Math.round((settingsRef.current.rate + dir * RATE_STEP) / RATE_STEP) * RATE_STEP;
        if (isPlaybackRate(next)) settingsRef.current.setRate(next);
        else settingsRef.current.setRate(dir > 0 ? PLAYBACK_RATES[PLAYBACK_RATES.length - 1]! : PLAYBACK_RATES[0]!);
      },
      toggleMute: () => settingsRef.current.setMuted(!settingsRef.current.muted),
      setVolume: (v) => settingsRef.current.setVolume(v),
      toggleCaptions: () => subtitleHandle.current.toggleCaptions(),
      selectTrack: (assetId) => subtitleHandle.current.selectTrack(assetId),
      captionsOff: () => subtitleHandle.current.captionsOff(),
      addSubtitles: () => subtitleHandle.current.addSubtitles(),
      attachPaths: (paths) => subtitleHandle.current.attachPaths(paths),
      removeTrack: (name) => subtitleHandle.current.removeTrack(name),
    };
    store.getState().setHandle(handle);
    scope.videoProbe.current = () => {
      const v = el();
      return {
        status: store.getState().status,
        timeMs: v ? Math.round(v.currentTime * 1000) : 0,
        paused: v ? v.paused : true,
        rate: v ? v.playbackRate : 1,
        volume: v ? v.volume : 1,
        muted: v ? v.muted : false,
        frameMs: store.getState().frameMs,
        trackId: store.getState().trackId,
        captionsOn: store.getState().captionsOn,
        cueText: store.getState().cueText,
      };
    };
    return () => {
      store.getState().setHandle(null);
      scope.videoProbe.current = null;
      clearTimeout(metadataAt.current ?? undefined);
      store.getState().patch({ status: 'opening', playing: false, timeMs: 0, durationMs: 0, bufferedMs: 0, tracks: [], trackId: null, captionsOn: false, cueText: null, transcript: INITIAL_TRANSCRIPT });
    };
  }, [scope, store]);

  // Opening for longer than a blink shows the spinner.
  useEffect(() => {
    if (status !== 'opening') {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), SPINNER_AFTER_MS);
    return () => clearTimeout(id);
  }, [status]);

  // While it plays the shown frames say how long a frame is, and the clock follows them smoothly (timeupdate comes four times a second).
  const playing = useVideo((s) => s.playing);
  const stage = useVideoStage((s) => s.on);
  // Only the shown tab's reader hides its controls: a kept tab behind it is not on the stage.
  const idle = useIdleControls(readerRef, stage && playing && shown && status === 'ready');
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !v || typeof v.requestVideoFrameCallback !== 'function') return;
    let id = 0;
    const on = (_now: number, meta: VideoFrameCallbackMetadata) => {
      const times = frames.current;
      if (times[times.length - 1] !== meta.mediaTime) times.push(meta.mediaTime);
      if (times.length > FRAME_SAMPLES) times.shift();
      const ms = frameDurationMs(times);
      const cur = store.getState();
      cur.patch({ timeMs: Math.round(meta.mediaTime * 1000), ...(Math.abs(ms - cur.frameMs) > 0.5 ? { frameMs: ms } : {}) });
      id = v.requestVideoFrameCallback(on);
    };
    id = v.requestVideoFrameCallback(on);
    return () => v.cancelVideoFrameCallback(id);
  }, [playing, store]);

  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const err = e.currentTarget.error;
    // MediaError.message is engine text (English, technical): the code goes to the log, the user gets our notice.
    console.warn(`[video] playback error code ${err?.code ?? 0}`);
    const unsupported = err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
    setError({ unsupported });
    store.getState().patch({ status: unsupported ? 'unplayable' : 'failed', playing: false });
  };
  const showFrame = () => {
    setFrame(true);
    if (store.getState().status === 'opening') store.getState().patch({ status: 'ready' });
  };
  const final = error !== null;
  const stageRef = useRef<HTMLDivElement>(null);
  useStageToasts(stageRef, shown);
  // The sidebar says there is no transcript for a file that cannot be shown (spec 6.7).
  useEffect(() => {
    if (!final) return;
    scope.reader.getState().setNoPages('reader', 'noVideo');
    return () => scope.reader.getState().setNoPages('reader', null);
  }, [final, scope]);

  const buffered = (v: HTMLVideoElement): number => {
    const r = v.buffered;
    for (let i = 0; i < r.length; i++) if (v.currentTime >= r.start(i) && v.currentTime <= r.end(i)) return Math.round(r.end(i) * 1000);
    return 0;
  };

  // The <video> keeps its place (hidden, not unmounted) so the evidence harness can still read video.error; the notice
  // takes the same stage, which never moves (no row is inserted when the error arrives).
  return (
    <div ref={readerRef} className="reader video-reader" data-idle={idle ? '' : undefined}>
      {!final && <VideoToolbar disabled={status !== 'ready'} />}
      <div
        ref={stageRef}
        className="video-stage"
        data-testid="video-stage"
        // F6 lands on the stage, not on the subtitle menu that stands before it in the strip.
        {...(final ? {} : { role: 'region', tabIndex: 0, 'aria-label': item.title, 'aria-describedby': hintId, 'data-pane-landing': '' })}
        aria-busy={status === 'opening' || undefined}
        onClick={() => {
          if (status === 'ready') store.getState().handle?.togglePlay();
        }}
      >
        <video
          ref={(el) => { if (el) videoRef.current = el; }}
          data-testid="video"
          src={assetUrl(item.assetId)}
          preload="metadata"
          hidden={final}
          onError={onError}
          data-frame={frame || undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            apply();
            tryRestore(v);
            store.getState().patch({ durationMs: Math.round(v.duration * 1000) });
            metadataAt.current ??= setTimeout(showFrame, 1000);
          }}
          onLoadedData={showFrame}
          onDurationChange={(e) => store.getState().patch({ durationMs: Number.isFinite(e.currentTarget.duration) ? Math.round(e.currentTarget.duration * 1000) : 0 })}
          onProgress={(e) => store.getState().patch({ bufferedMs: buffered(e.currentTarget) })}
          onPlay={() => store.getState().patch({ playing: true })}
          onPlaying={() => store.getState().patch({ playing: true })}
          onTimeUpdate={(e) => {
            syncTime(e.currentTarget);
            store.getState().patch({ bufferedMs: buffered(e.currentTarget) });
            record(e.currentTarget, false);
          }}
          onPause={(e) => {
            store.getState().patch({ playing: false });
            syncTime(e.currentTarget);
            record(e.currentTarget, true);
          }}
          onEnded={() => store.getState().patch({ playing: false })}
          onSeeked={(e) => {
            syncTime(e.currentTarget);
            record(e.currentTarget, true);
          }}
        />
        {!final && <SubtitleOverlay stage={stageRef} video={videoRef} cues={cues} />}
        {!final && <span id={hintId} className="visually-hidden">{t.video.stageHint}</span>}
        {!final && status === 'opening' && slow && (
          <div className="stage-center">
            <div className="loading on-stage" role="status">
              <Spinner />
              {t.video.opening}
            </div>
          </div>
        )}
        {final && (
          <div className="stage-center">
            <CodecNotice item={item} unsupported={error.unsupported} />
          </div>
        )}
      </div>
      {!final && <VideoControls />}
    </div>
  );
}
