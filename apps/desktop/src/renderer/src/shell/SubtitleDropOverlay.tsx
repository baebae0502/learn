import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Captions } from 'lucide-react';
import { api } from '../api';
import { closePalette } from '../palette/Palette';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { windowDropTarget, type FileDrag } from './drop';
import { sidebarRight } from './DropOverlay';
import { acceptsSubtitleDrag } from './subtitleDrop';

/**
 * Finder → a video tab (spec 5.3): the window's second drop gate. While the shown tab is a playable video, a drag whose files could all be
 * subtitles (by MIME: the names are hidden until the drop) covers the reader, right of the sidebar, with the overlay; any other drag keeps
 * the no-drop cursor main.tsx gives. Subtitles are never linked, so ⌥ means nothing here and the drop is always a copy.
 *
 * `onDrop` gets the dropped files' paths (the drop filters them by extension again) and the count of files with no location on disk.
 */
export function SubtitleDropOverlay({ enabled, onDrop }: { enabled: boolean; onDrop: (paths: string[], unresolved: number) => void }) {
  const [shown, setShown] = useState(false);
  const [left, setLeft] = useState(0);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });
  // Like the window's overlay it owns the keyboard while it covers the reader.
  useLayoutEffect(() => {
    useShell.getState().setDropOverlay(shown);
    return () => useShell.getState().setDropOverlay(false);
  }, [shown]);
  useEffect(() => {
    if (!enabled) return;
    const target = windowDropTarget({
      show: (next) => {
        if (next !== null) setLeft(sidebarRight());
        setShown(next !== null);
      },
      entered: () => {
        if (useShell.getState().paletteOpen) closePalette();
      },
      drop: (paths, _mode, unresolved) => onDropRef.current(paths, unresolved),
      pathForFile: (f) => api().pathForFile(f),
    });
    /** The drag as the target reads it: never ⌥ (no link for subtitles); null when the drag is not one this gate takes. The video tab's sidebar takes it too (its transcript pane has no drop targets of its own). */
    const taken = (e: DragEvent): FileDrag | null => {
      if (!e.dataTransfer || !acceptsSubtitleDrag(Array.from(e.dataTransfer.items))) return null;
      return { altKey: false, target: e.target, dataTransfer: e.dataTransfer, preventDefault: () => e.preventDefault() };
    };
    const on = (fn: (d: FileDrag) => void) => (e: DragEvent) => {
      const d = taken(e);
      if (d) fn(d);
      else target.reset();
    };
    const enter = on((d) => target.enter(d));
    const over = on((d) => target.over(d));
    const drop = on((d) => target.drop(d));
    const leave = (e: DragEvent) => {
      if (e.dataTransfer) target.leave({ altKey: false, target: e.target, dataTransfer: e.dataTransfer, preventDefault: () => e.preventDefault() });
    };
    const end = () => target.reset();
    addEventListener('dragenter', enter);
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    addEventListener('blur', end);
    addEventListener('dragend', end);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
      removeEventListener('blur', end);
      removeEventListener('dragend', end);
      target.reset();
    };
  }, [enabled]);

  if (!shown) return null;
  return (
    <div className="drop-overlay" role="dialog" aria-label={t.drop.subtitlesLabel} data-testid="subtitle-drop-overlay" style={{ '--drop-left': `${left}px` } as CSSProperties}>
      <div className="frame" />
      <div className="drop-panel">
        <div className="glyph">
          <Icon icon={Captions} size="xl" />
        </div>
        <h2 className="ui-balance">{t.drop.subtitlesTitle}</h2>
        <div className="files">{t.drop.subtitlesBody}</div>
      </div>
    </div>
  );
}
