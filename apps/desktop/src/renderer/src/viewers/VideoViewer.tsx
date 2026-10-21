import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { ratio, restoreVideoSeconds } from './positionSaver';
import { CodecNotice, ReaderTitleRow } from './ReaderNotices';
import { usePosition } from './usePosition';

const TIME_SAVE = { kind: 'throttle', ms: 2000 } as const;

export function VideoViewer({ item }: { item: LibraryItem }) {
  const [error, setError] = useState<{ unsupported: boolean } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null); // kept after unmount so the final time can still be read
  const restored = useRef(false);

  const pos = usePosition(item, TIME_SAVE, () => {
    const v = videoRef.current;
    if (!v || !restored.current) return null;
    return { locator: { kind: 'video', timeMs: Math.round(v.currentTime * 1000) }, progress: ratio(v.currentTime, v.duration) };
  });

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
  }, [pos.loaded]);

  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const err = e.currentTarget.error;
    // MediaError.message is engine text (English, technical): the code goes to the log, the user gets our notice.
    console.warn(`[video] playback error code ${err?.code ?? 0}`);
    setError({ unsupported: err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED });
  };
  // The 44 px title row appears only in the final state (design-spec 6, dialogs.html?scene=codec); the <video> keeps
  // its place in the tree (hidden, not unmounted) so the evidence harness can still read video.error.
  return (
    <div className="reader">
      {error && <ReaderTitleRow item={item} />}
      <div className="video-stage">
        <video
          ref={(el) => { if (el) videoRef.current = el; }}
          data-testid="video"
          src={assetUrl(item.assetId)}
          controls
          preload="metadata"
          hidden={error !== null}
          onError={onError}
          onLoadedMetadata={(e) => tryRestore(e.currentTarget)}
          onTimeUpdate={(e) => record(e.currentTarget, false)}
          onPause={(e) => record(e.currentTarget, true)}
          onSeeked={(e) => record(e.currentTarget, true)}
        />
        {error && <CodecNotice item={item} unsupported={error.unsupported} />}
      </div>
    </div>
  );
}
