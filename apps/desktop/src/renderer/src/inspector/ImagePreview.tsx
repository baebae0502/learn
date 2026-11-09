import { useState } from 'react';
import { Image, ImageOff } from 'lucide-react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { Icon } from '../ui/Icon';
import { previewMode } from './previewMode';

export { PREVIEW_MAX_PIXELS } from './previewMode';

/**
 * The head's picture for one image (spec 4.6): the panel's content width, the picture's own proportions up to 160 high, on
 * --bg-sunken. An icon box of the full 160 stands in where the picture is not drawn (unknown or past-50-MP size, a missing
 * original, a picture that fails to load).
 */
export function ImagePreview({ item }: { item: LibraryItem }) {
  // A failure belongs to one file: another selected item starts afresh.
  const [failed, setFailed] = useState<string | null>(null);
  const size = item.imageSize;
  if (previewMode(item) === 'picture' && size && failed !== item.assetId) {
    return (
      <div className="item-preview" data-testid="image-preview" data-state="picture" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        <img src={assetUrl(item.assetId)} loading="lazy" decoding="async" alt={item.title} draggable={false} onError={() => setFailed(item.assetId)} />
      </div>
    );
  }
  const broken = failed === item.assetId;
  return (
    <div className="item-preview icon-only" data-testid="image-preview" data-state={broken ? 'broken' : 'icon'}>
      <Icon icon={broken ? ImageOff : Image} size="xl" />
    </div>
  );
}
