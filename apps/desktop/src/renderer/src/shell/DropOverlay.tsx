import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Copy, Download, Link } from 'lucide-react';
import { api } from '../api';
import { closePalette } from '../palette/Palette';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { dropSummaryText, windowDropTarget, type DropState, type WindowDropHandler } from './drop';

/** The sidebar column (Shell marks it): a file drag inside it is the tree's to take or refuse, not the overlay's. */
const inSidebar = (e: DragEvent) => e.target instanceof Element && e.target.closest('[data-sidebar-area]') !== null;
/** Where the overlay starts: the sidebar's right edge, 0 when it is folded (the folded column keeps its 1 px boundary padding, and is inert). */
function sidebarRight(): number {
  const area = document.querySelector('[data-sidebar-area]');
  return area && !area.hasAttribute('inert') ? Math.max(0, Math.round(area.getBoundingClientRect().right)) : 0;
}

/**
 * Finder → window (design-spec 6 드롭 오버레이, 7.2; M5 spec 8.4): while files are dragged over the window, everything under
 * the 52 px bar and right of the sidebar is covered (the traffic lights and the whole sidebar column stay — its rows take
 * files themselves, and the rest of it takes none). With the sidebar hidden that is all of it, as before. Copy by default,
 * link while ⌥ is held; the two cards switch at once. Unsupported files are reported after the drop (the import's toast).
 *
 * `enabled`: the window takes drops (the library, nothing holding the window). A file drag that comes in while the ⌘K
 * palette is open closes it first, as a menu command does. While disabled a drop does nothing (main.tsx cancels
 * every dragover and drop, so the window never navigates). The ring, tile and current card are drop-target marks, not
 * focus rings: they stay at full strength while the window is not key (Finder's drop target in a background window).
 * The overlay is opaque over the whole window, so it never outlives the drag: it also goes on blur, on dragend and
 * after a second without a dragover (shell/drop.ts).
 *
 * `intoName`: the collection being viewed, which the files go into (spec 3.7) — the title says so.
 */
export function DropOverlay({ enabled, onDrop, intoName }: { enabled: boolean; onDrop: WindowDropHandler; intoName?: string }) {
  const [state, setState] = useState<DropState | null>(null);
  const [left, setLeft] = useState(0);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });
  // While it covers the window it owns the keyboard: the keymap's F6 does nothing (MainWindow, commands/keymap.ts).
  const shown = state !== null;
  useLayoutEffect(() => {
    useShell.getState().setDropOverlay(shown);
    return () => useShell.getState().setDropOverlay(false);
  }, [shown]);
  useEffect(() => {
    if (!enabled) return;
    const target = windowDropTarget({
      show: (next) => {
        if (next !== null) setLeft(sidebarRight());
        setState(next);
      },
      entered: () => {
        if (useShell.getState().paletteOpen) closePalette();
      },
      drop: (paths, mode, unresolved) => onDropRef.current(paths, mode, unresolved),
      pathForFile: (f) => api().pathForFile(f),
    });
    const enter = (e: DragEvent) => (inSidebar(e) ? target.reset() : target.enter(e));
    const over = (e: DragEvent) => (inSidebar(e) ? target.reset() : target.over(e));
    const leave = (e: DragEvent) => target.leave(e);
    const drop = (e: DragEvent) => (inSidebar(e) ? target.reset() : target.drop(e));
    // The safety net: the window lost the focus, or a drag that began here ended. A drag still over the window brings
    // the overlay back with its next dragover; besides, it goes after DROP_IDLE_MS without one.
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

  if (!state) return null;
  return (
    <div className="drop-overlay" role="dialog" aria-label={t.drop.label} data-testid="drop-overlay" data-mode={state.link ? 'link' : 'copy'} style={{ '--drop-left': `${left}px` } as CSSProperties}>
      <div className="frame" />
      <div className="drop-panel">
        <div className="glyph">
          <Icon icon={Download} size="xl" />
        </div>
        <h2 className="ui-balance">{intoName === undefined ? t.drop.title : t.drop.titleInto(intoName)}</h2>
        <div className="files" data-testid="drop-summary">
          {dropSummaryText(state.summary)}
        </div>
        <div className="drop-modes">
          <div className="drop-mode" data-on={state.link ? undefined : ''} data-testid="drop-copy">
            <Icon icon={Copy} />
            <span className="dm-title">{t.drop.copyTitle}</span>
            <span className="dm-text ui-prose">{t.drop.copyBody}</span>
          </div>
          <div className="drop-mode" data-on={state.link ? '' : undefined} data-testid="drop-link">
            <Icon icon={Link} />
            <span className="dm-title">
              {t.drop.linkTitle}
              {/* ⌥ on macOS, Alt elsewhere: the key that switches to this card. */}
              <Kbd accelerator="Alt" />
            </span>
            <span className="dm-text ui-prose">{t.drop.linkBody}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
