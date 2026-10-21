import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { ratio, restoreVideoSeconds } from './positionSaver';
import { usePosition, type PositionHandle } from './usePosition';

const TIME_SAVE = { kind: 'throttle', ms: 2000 } as const;

export function VideoViewer({ item }: { item: LibraryItem }) {
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posRef = useRef<PositionHandle | null>(null);
  const restored = useRef(false);

  // Declared before usePosition so its cleanup runs first: record the true final time, then flush.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (video && restored.current) {
        posRef.current?.update({ kind: 'video', timeMs: Math.round(video.currentTime * 1000) }, ratio(video.currentTime, video.duration));
        posRef.current?.flush();
      }
    };
  }, []);

  const pos = usePosition(item, TIME_SAVE);
  posRef.current = pos;

  const record = (v: HTMLVideoElement, immediate: boolean) => {
    if (!restored.current) return;
    pos.update({ kind: 'video', timeMs: Math.round(v.currentTime * 1000) }, ratio(v.currentTime, v.duration));
    if (immediate) pos.flush();
  };

  const tryRestore = (v: HTMLVideoElement) => {
    if (restored.current || !pos.loaded || v.readyState < 1) return;
    const seconds = restoreVideoSeconds(pos.saved?.locator, v.duration);
    if (seconds > 0) v.currentTime = seconds;
    pos.markRestored({ kind: 'video', timeMs: Math.round(seconds * 1000) });
    restored.current = true;
  };

  // Metadata can arrive before the saved position does (or the other way round).
  useEffect(() => {
    if (videoRef.current) tryRestore(videoRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.loaded]);

  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const err = e.currentTarget.error;
    setError({
      message: err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? t.videoUnsupported : t.videoError,
      detail: err?.message ?? '',
    });
  };
  return (
    <div className="video-viewer">
      <video
        ref={videoRef}
        data-testid="video"
        src={assetUrl(item.assetId)}
        controls
        preload="metadata"
        onError={onError}
        onLoadedMetadata={(e) => tryRestore(e.currentTarget)}
        onTimeUpdate={(e) => record(e.currentTarget, false)}
        onPause={(e) => record(e.currentTarget, true)}
        onSeeked={(e) => record(e.currentTarget, true)}
      />
      {error && (
        <div className="error-box" role="alert" data-testid="video-error">
          <p>{error.message}</p>
          {error.detail && <p className="muted small">{error.detail}</p>}
        </div>
      )}
    </div>
  );
}
