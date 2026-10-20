import { useState, type SyntheticEvent } from 'react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings';

export function VideoViewer({ item }: { item: LibraryItem }) {
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const err = e.currentTarget.error;
    setError({
      message: err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? t.videoUnsupported : t.videoError,
      detail: err?.message ?? '',
    });
  };
  return (
    <div className="video-viewer">
      <video data-testid="video" src={assetUrl(item.assetId)} controls preload="metadata" onError={onError} />
      {error && (
        <div className="error-box" role="alert" data-testid="video-error">
          <p>{error.message}</p>
          {error.detail && <p className="muted small">{error.detail}</p>}
        </div>
      )}
    </div>
  );
}
