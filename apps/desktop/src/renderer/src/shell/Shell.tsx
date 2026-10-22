import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { SIDEBAR, afterViewportChange, clampSidebar, sidebarHidden } from './layout';
import { SidebarToggle } from './SidebarToggle';
import { keepFocusAcross, useKeepFocusAcrossFold } from './useSidebar';
import { useViewportWidth } from './useViewportWidth';

/**
 * Layout B (design-spec 2.3): a full-height sidebar whose top 88 px (traffic lights + toggle, ⌘K launcher, 8 gap)
 * is identical in every view, a 1 px boundary with a ±4 px resize handle, and the main column (52 px toolbar + content).
 */
export function Shell(props: { sidebar: ReactNode; launcher?: ReactNode; toolbar: ReactNode; children: ReactNode; overlays?: ReactNode }) {
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const sidebar = useShell((s) => s.sidebar);
  const setSidebar = useShell((s) => s.setSidebar);
  const viewportWidth = useViewportWidth();
  const hidden = sidebarHidden(sidebar, viewportWidth);
  useKeepFocusAcrossFold(hidden);
  // Mount-time size only: a changing defaultSize re-registers the panel; later changes go through the imperative effect.
  const [initialSize] = useState(() => (hidden ? 0 : sidebar.width));

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (hidden && !panel.isCollapsed()) panel.collapse();
    else if (!hidden && panel.isCollapsed()) panel.resize(sidebar.width);
  }, [hidden, sidebar.width, panelRef]);

  useEffect(() => {
    const next = afterViewportChange(useShell.getState().sidebar, viewportWidth);
    if (next !== useShell.getState().sidebar) setSidebar(next);
  }, [viewportWidth, setSidebar]);

  /** Only drags and separator keys count as the user's choice (not window resizes or our own collapse()). */
  const onLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    const panel = panelRef.current;
    const group = groupRef.current;
    if (!meta.isUserInteraction || !panel || !group) return;
    const current = useShell.getState().sidebar;
    if (panel.isCollapsed()) {
      if (sidebarHidden(current, innerWidth)) return;
      keepFocusAcross(true); // dragged or keyed shut from the separator, which disappears with the sidebar
      // Shown on demand in a narrow window: shutting it hands it back to the automatic fold (M-5), as ⌃⌘S does.
      setSidebar(current.forceShown ? { ...current, forceShown: false } : { ...current, collapsed: true });
    } else {
      // From the new layout (percent of the group): getSize().inPixels reads the DOM, which a keyboard step has not re-rendered yet.
      const percent = layout['sidebar'] ?? panel.getSize().asPercentage;
      setSidebar({ ...current, width: clampSidebar((percent / 100) * group.offsetWidth), collapsed: false });
    }
  };

  return (
    <div className="window" data-testid="shell" data-sidebar={hidden ? 'hidden' : 'shown'}>
      <Group
        orientation="horizontal"
        className="window-panes"
        elementRef={groupRef}
        onLayoutChanged={onLayoutChanged}
        resizeTargetMinimumSize={{ fine: 9, coarse: 20 }}
      >
        <Panel
          id="sidebar"
          panelRef={panelRef}
          className="sidebar"
          defaultSize={initialSize}
          minSize={SIDEBAR.min}
          maxSize={SIDEBAR.max}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
        >
          {/* inert while folded: nothing in a 0 px panel may take focus or be read out. */}
          <nav className="sidebar-inner" aria-label={t.shell.sidebar} inert={hidden}>
            <div className="sidebar-top" data-testid="sidebar-top">
              <SidebarToggle place="sidebar" />
            </div>
            <div className="launcher-wrap">{hidden ? null : props.launcher}</div>
            <div className="sidebar-scroll" data-pane="sidebar">
              {props.sidebar}
            </div>
          </nav>
        </Panel>
        {/* Window-splitter pattern: the focusable handle is named after the pane it resizes. */}
        <Separator className="pane-separator" id="pane-separator" aria-label={t.shell.sidebar} />
        <Panel id="main" className="main-column">
          {props.toolbar}
          <main className="content" data-testid="content" data-pane="content">
            {props.children}
          </main>
        </Panel>
      </Group>
      {props.overlays}
    </div>
  );
}
