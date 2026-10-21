import { useEffect, type ReactNode } from 'react';
import { SidebarToggle } from './SidebarToggle';
import { useSidebarHidden } from './useSidebar';

/**
 * Unified toolbar (design-spec 2.1): with a single tab (M3–M6) the title bar carries the view title (15/20 600),
 * a count, and the main actions; there is no tab strip and no 44 px pane header.
 */
export function Toolbar(props: {
  title: string;
  /** The window's title when it is not `title`; null keeps the previous one (a view still loading). */
  windowTitle?: string | null;
  count?: string;
  titleTestId?: string;
  leading?: ReactNode;
  actions?: ReactNode;
  trailing?: ReactNode;
}) {
  const hidden = useSidebarHidden();
  // The window is named after its view, as native windows are after their folder or document (design-spec 2.1): the
  // title shows in 윈도우, Mission Control and the full-screen reveal strip. Electron follows document.title.
  const windowTitle = props.windowTitle === undefined ? props.title || null : props.windowTitle;
  useEffect(() => {
    if (windowTitle) document.title = windowTitle;
  }, [windowTitle]);
  return (
    <header className="titlebar" data-testid="toolbar">
      {hidden && <SidebarToggle place="toolbar" />}
      {props.leading}
      <div className="tb-title">
        <h1 className="title ellipsis" title={props.title} data-testid={props.titleTestId ?? 'toolbar-title'}>
          {props.title}
        </h1>
        {props.count && (
          <span className="count num" data-testid="toolbar-count">
            {props.count}
          </span>
        )}
      </div>
      <div className="tb-actions">{props.actions}</div>
      {hidden && props.trailing}
    </header>
  );
}
