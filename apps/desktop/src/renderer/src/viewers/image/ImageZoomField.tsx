import { useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../strings';
import { isComposingKey } from '../../ui/ime';
import { useReader } from '../pdf/readerStore';
import { zoomPercent } from '../pdf/zoom';
import { parseImageZoomInput } from './imageFit';
import { ImageZoomMenu } from './ImageZoomMenu';

/**
 * The picture's scale in percent, as a field (↩ zooms to a typed percent within 5–800 %, esc gives the value back and the focus to the
 * stage), with the zoom menu beside it. A fit shows the percent it comes to; "…" while the picture opens.
 */
export function ImageZoomField({ onEscape }: { onEscape(): void }) {
  const image = useReader((s) => s.image);
  const handle = useReader((s) => s.imageHandle);
  const [draft, setDraft] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const ready = image?.status === 'shown' && handle !== null;
  const shown = draft ?? (ready ? zoomPercent(image.scale) : '');
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const zoom = parseImageZoomInput(draft ?? '');
      if (zoom !== null) handle?.setZoom(zoom);
      setDraft(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(null);
      onEscape();
    }
  };
  return (
    <div ref={group} className="zoom-field">
      <input
        className="zoom-input num"
        autoComplete="off"
        spellCheck={false}
        aria-label={t.reader.zoomField}
        placeholder="…"
        disabled={!ready}
        value={shown}
        data-testid="image-zoom-field"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
      <ImageZoomMenu zoom={image?.zoom ?? 'fit'} anchorRef={group} isDisabled={!ready} />
    </div>
  );
}
