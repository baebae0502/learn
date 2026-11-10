import { t } from '../../strings';
import { ImageViewMenu } from './ImageViewMenu';
import { ImageZoomField } from './ImageZoomField';

/**
 * The image reader's 44 px toolbar: the zoom field and its menu in the middle, the 보기 menu at the right. A picture has no history, pages, find or item
 * panel, so nothing else is drawn; the two sides keep the field centred.
 */
export function ImageToolbar({ onEscape }: { onEscape(): void }) {
  return (
    <div className="reader-toolbar image-toolbar" role="toolbar" aria-label={t.reader.imageTools} data-testid="image-toolbar">
      <div className="image-toolbar-side" />
      <ImageZoomField onEscape={onEscape} />
      <div className="image-toolbar-side">
        <ImageViewMenu />
      </div>
    </div>
  );
}
