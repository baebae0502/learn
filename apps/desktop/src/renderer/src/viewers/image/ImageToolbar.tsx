import { t } from '../../strings';
import { ImageZoomField } from './ImageZoomField';

/**
 * The image reader's 44 px toolbar: the zoom field and its menu in the middle. A picture has no history, pages, find or item
 * panel, so nothing else is drawn; the two sides keep the field centred whatever later joins the right one.
 */
export function ImageToolbar({ onEscape }: { onEscape(): void }) {
  return (
    <div className="reader-toolbar image-toolbar" role="toolbar" aria-label={t.reader.imageTools} data-testid="image-toolbar">
      <div className="image-toolbar-side" />
      <ImageZoomField onEscape={onEscape} />
      <div className="image-toolbar-side" />
    </div>
  );
}
