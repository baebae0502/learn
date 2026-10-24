import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout, type LayoutChangedMeta, type PanelImperativeHandle } from 'react-resizable-panels';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { INSPECTOR, SIDEBAR, afterViewportChange, clampSidebar, draggedInspectorWidth, hiddenPanes, inspectorAfterViewportChange, sidebarHidden } from './layout';
import { SidebarToggle } from './SidebarToggle';
import { useKeepFocusOnInspectorFold } from './useInspector';
import { keepFocusAcross, useKeepFocusAcrossFold } from './useSidebar';
import { useViewportWidth } from './useViewportWidth';

/** The content and item panels' boxes clip: what scrolls is inside them (the table body, the panel body). */
const CLIP = { overflow: 'hidden' } as const;

/**
 * Layout B (design-spec 2.3): a full-height sidebar whose top 88 px (traffic lights + toggle, ⌘K launcher, 8 gap)
 * is identical in every view, a 1 px boundary with a ±4 px resize handle, and the main column: the 52 px toolbar over
 * the content and, in the library, the item panel (design-spec 2.5) — a nested group whose boundary works as the
 * sidebar's does, so the toolbar spans both.
 */
export function Shell(props: { sidebar: ReactNode; launcher?: ReactNode; toolbar: ReactNode; children: ReactNode; inspector?: ReactNode; overlays?: ReactNode }) {
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const inspectorRef = usePanelRef();
  const mainGroupRef = useRef<HTMLDivElement>(null);
  const sidebar = useShell((s) => s.sidebar);
  const setSidebar = useShell((s) => s.setSidebar);
  const inspector = useShell((s) => s.inspector);
  const setInspector = useShell((s) => s.setInspector);
  const viewportWidth = useViewportWidth();
  const hidden = sidebarHidden(sidebar, viewportWidth);
  const present = props.inspector !== undefined;
  const inspectorHidden = hiddenPanes({ sidebar, inspector }, viewportWidth, present).inspector;
  useKeepFocusAcrossFold(hidden);
  useKeepFocusOnInspectorFold(inspectorHidden);
  // Mount-time size only: a changing defaultSize re-registers the panel; later changes go through the imperative effect.
  const [initialSize] = useState(() => (hidden ? 0 : sidebar.width));

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (hidden && !panel.isCollapsed()) panel.collapse();
    else if (!hidden && panel.isCollapsed()) panel.resize(sidebar.width);
  }, [hidden, sidebar.width, panelRef]);

  useEffect(() => {
    const s = useShell.getState();
    const next = afterViewportChange(s.sidebar, viewportWidth);
    if (next !== s.sidebar) setSidebar(next);
    const nextInspector = inspectorAfterViewportChange({ sidebar: next, inspector: s.inspector }, viewportWidth);
    if (nextInspector !== s.inspector) setInspector(nextInspector);
  }, [viewportWidth, setSidebar, setInspector]);

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

  /** The item panel's boundary, by the same rules; its fold rescue is useKeepFocusOnInspectorFold. */
  const onMainLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    const panel = inspectorRef.current;
    const group = mainGroupRef.current;
    if (!meta.isUserInteraction || !panel || !group) return;
    const s = useShell.getState();
    const panes = { sidebar: s.sidebar, inspector: s.inspector };
    if (panel.isCollapsed()) {
      if (hiddenPanes(panes, innerWidth, true).inspector) return;
      setInspector(s.inspector.forceShown ? { ...s.inspector, forceShown: false } : { ...s.inspector, collapsed: true });
      return;
    }
    const px = ((layout['inspector'] ?? panel.getSize().asPercentage) / 100) * group.offsetWidth;
    const width = draggedInspectorWidth(panes, innerWidth, px);
    setInspector({ ...s.inspector, width, collapsed: false });
    // Dragged wider than leaves the content column its 520: back to the widest that does, rather than folding on release.
    if (Math.abs(width - px) >= 1) panel.resize(width);
  };

  return (
    <div className="window" data-testid="shell" data-sidebar={hidden ? 'hidden' : 'shown'} data-inspector={present ? (inspectorHidden ? 'hidden' : 'shown') : undefined}>
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
          <Group orientation="horizontal" className="main-panes" elementRef={mainGroupRef} onLayoutChanged={onMainLayoutChanged} resizeTargetMinimumSize={{ fine: 9, coarse: 20 }}>
            <Panel id="content-pane" className="content-pane" style={CLIP}>
              <main className="content" data-testid="content" data-pane="content">
                {props.children}
              </main>
            </Panel>
            {present && (
              <>
                <Separator className="inspector-separator" id="inspector-separator" aria-label={t.inspector.panel} />
                <InspectorPanel panelRef={inspectorRef} hidden={inspectorHidden} width={inspector.width}>
                  {props.inspector}
                </InspectorPanel>
              </>
            )}
          </Group>
        </Panel>
      </Group>
      {props.overlays}
    </div>
  );
}

/**
 * The item panel's slot. It mounts when the library's table first shows, so its first size comes from the store then;
 * later changes go through the imperative effect, as the sidebar's. Folded, it stays mounted and inert (an open edit
 * survives a fold; nothing in it takes focus or is read out).
 */
function InspectorPanel(props: { panelRef: RefObject<PanelImperativeHandle | null>; hidden: boolean; width: number; children: ReactNode }) {
  const { panelRef, hidden, width } = props;
  const [initialSize] = useState(() => (hidden ? 0 : width));
  // The group derives a late-mounted panel's constraints after this effect first runs (the handle throws until then),
  // and the first size already says what is wanted: only a change after the mount goes through the handle.
  const mounted = useRef(false);
  // Development's StrictMode unmounts and re-runs every effect on mount: the skip must start over with it.
  useEffect(() => () => void (mounted.current = false), []);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    if (hidden && !panel.isCollapsed()) panel.collapse();
    else if (!hidden && panel.isCollapsed()) panel.resize(width);
  }, [hidden, width, panelRef]);
  return (
    <Panel
      id="inspector"
      data-testid="inspector-panel"
      panelRef={panelRef}
      className="inspector-panel"
      style={CLIP}
      defaultSize={initialSize}
      minSize={INSPECTOR.min}
      maxSize={INSPECTOR.max}
      collapsible
      collapsedSize={0}
      groupResizeBehavior="preserve-pixel-size"
    >
      <aside className="inspector" aria-label={t.inspector.panel} data-pane="inspector" inert={hidden}>
        {props.children}
      </aside>
    </Panel>
  );
}
