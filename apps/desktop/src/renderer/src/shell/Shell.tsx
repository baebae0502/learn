import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Group, Panel, Separator, usePanelRef, type Layout, type LayoutChangedMeta, type PanelImperativeHandle } from 'react-resizable-panels';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { INSPECTOR, READER_CONTENT_MIN, SIDEBAR, TUTOR, afterViewportChange, clampSidebar, draggedInspectorWidth, hiddenPanes, inspectorAfterViewportChange, inspectorContentMin, sidebarHidden, sidebarHiddenIn, slotWidthFor, type InspectorMode } from './layout';
import { inspectorModeNow, useInspectorMode } from './inspectorMode';
import { SidebarToggle } from './SidebarToggle';
import { useKeepFocusOnInspectorFold } from './useInspector';
import { keepFocusAcross, useKeepFocusAcrossFold } from './useSidebar';
import { useVideoStage } from './videoStage';
import { useViewportWidth } from './useViewportWidth';

/**
 * The panels' boxes clip: what scrolls is inside them (the sidebar's lists, the table body, the panel body). A folded panel is 0 px wide
 * while its inert content keeps its own width: unclipped, it would be a region that scrolls sideways with nothing to focus in it.
 */
const CLIP = { overflow: 'hidden' } as const;

/**
 * Layout B (design-spec 2.3): a full-height sidebar whose top 88 px (traffic lights + toggle, ⌘K launcher, 8 gap)
 * is identical in every view, a 1 px boundary with a ±4 px resize handle, and the main column: the 52 px toolbar over
 * the content and, in the library, the item panel (design-spec 2.5) — a nested group whose boundary works as the
 * sidebar's does, so the toolbar spans both. With reader tabs the toolbar is the tab strip and `head` is the view's own bar over its column. `sidebarFoot` sits under the scrolling part of the sidebar, as tall as it is
 * (the tag selector).
 */
export function Shell(props: { sidebar: ReactNode; sidebarFoot?: ReactNode; launcher?: ReactNode; toolbar: ReactNode; head?: ReactNode; children: ReactNode; inspector?: ReactNode; overlays?: ReactNode }) {
  const panelRef = usePanelRef();
  const groupRef = useRef<HTMLDivElement>(null);
  const inspectorRef = usePanelRef();
  const mainGroupRef = useRef<HTMLDivElement>(null);
  const sidebar = useShell((s) => s.sidebar);
  const setSidebar = useShell((s) => s.setSidebar);
  const inspector = useShell((s) => s.inspector);
  const tutorWidth = useShell((s) => s.tutorWidth);
  const setInspector = useShell((s) => s.setInspector);
  const setTutorWidth = useShell((s) => s.setTutorWidth);
  const viewportWidth = useViewportWidth();
  const viewKind = useShell((s) => s.view.kind);
  const contentMin = inspectorContentMin(viewKind);
  const mode = useInspectorMode();
  const panes = { sidebar, inspector, tutorWidth };
  // In the tutor mode a slot shown on demand pushes the sidebar away (spec 8.10): the sidebar's fold reads the slot too.
  const present = props.inspector !== undefined;
  // The video stage (spec 6.6) folds both panes without touching the user's choice: they come back at their widths when it ends.
  const stage = useVideoStage((s) => s.on);
  const hidden = stage || sidebarHiddenIn(panes, viewportWidth, contentMin, mode, present);
  const inspectorHidden = stage || hiddenPanes(panes, viewportWidth, present, contentMin, mode).inspector;
  const setInspectorPresent = useShell((s) => s.setInspectorPresent);
  useLayoutEffect(() => setInspectorPresent(present), [present, setInspectorPresent]);
  const slotWidth = slotWidthFor(mode, panes, viewportWidth, contentMin);
  useToastsBeside(viewKind === 'reader' && present && !inspectorHidden && mode === 'tutor' ? slotWidth : 0);
  useKeepFocusAcrossFold(hidden);
  useKeepFocusOnInspectorFold(inspectorHidden);
  const inspectorSeparatorKey = useSeparatorKeyAfterFirstShow(present, inspectorHidden);
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
    // A panel shown on demand stays so until the window is wide enough for the library's column: a visit to the reader, whose
    // column needs less, is no reason to fold it again on the way back.
    const mode = inspectorModeNow();
    const nextInspector = inspectorAfterViewportChange({ sidebar: next, inspector: s.inspector, tutorWidth: s.tutorWidth }, viewportWidth, mode === 'tutor' ? READER_CONTENT_MIN : undefined, mode);
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
    const panes = { sidebar: s.sidebar, inspector: s.inspector, tutorWidth: s.tutorWidth };
    const min = inspectorContentMin(s.view.kind);
    const mode = inspectorModeNow();
    if (panel.isCollapsed()) {
      if (hiddenPanes(panes, innerWidth, true, min, mode).inspector) return;
      setInspector(s.inspector.forceShown ? { ...s.inspector, forceShown: false } : { ...s.inspector, collapsed: true });
      return;
    }
    const px = ((layout['inspector'] ?? panel.getSize().asPercentage) / 100) * group.offsetWidth;
    const width = draggedInspectorWidth(panes, innerWidth, px, min, mode);
    // Each mode keeps its own width; a slot opened by the drag is no longer a user fold.
    if (mode === 'tutor') {
      setTutorWidth(width);
      if (s.inspector.collapsed) setInspector({ ...s.inspector, collapsed: false });
    } else setInspector({ ...s.inspector, width, collapsed: false });
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
          style={CLIP}
          defaultSize={initialSize}
          minSize={SIDEBAR.min}
          maxSize={SIDEBAR.max}
          collapsible
          collapsedSize={0}
          groupResizeBehavior="preserve-pixel-size"
        >
          {/* inert while folded: nothing in a 0 px panel may take focus or be read out. */}
          <nav className="sidebar-inner" data-sidebar-area="" aria-label={t.shell.sidebar} inert={hidden}>
            <div className="sidebar-top" data-testid="sidebar-top">
              <SidebarToggle place="sidebar" />
            </div>
            <div className="launcher-wrap">{hidden ? null : props.launcher}</div>
            <div className="sidebar-scroll" data-pane="sidebar">
              {props.sidebar}
            </div>
            {props.sidebarFoot}
          </nav>
        </Panel>
        {/* Window-splitter pattern: the focusable handle is named after the pane it resizes. */}
        <Separator className="pane-separator" id="pane-separator" aria-label={t.shell.sidebar} />
        <Panel id="main" className="main-column">
          {props.toolbar}
          <Group orientation="horizontal" className="main-panes" elementRef={mainGroupRef} onLayoutChanged={onMainLayoutChanged} resizeTargetMinimumSize={{ fine: 9, coarse: 20 }}>
            <Panel id="content-pane" className="content-pane" style={CLIP}>
              {/* The view's own head under the tab strip (the library's, while reader tabs exist): over the content column only, outside the pane F6 visits. */}
              {props.head}
              <main className="content" data-testid="content" data-pane="content">
                {props.children}
              </main>
            </Panel>
            {present && (
              <>
                <Separator key={inspectorSeparatorKey} className="inspector-separator" id="inspector-separator" aria-label={t.inspector.panel} />
                <InspectorPanel panelRef={inspectorRef} hidden={inspectorHidden} width={slotWidth} mode={mode}>
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
 * While the reader shows the tutor, the toasts stand at the reader's bottom-right corner, `width` (the tutor's slot) in from the
 * window's edge — never over the composer's agent button, 보내기 or 중지, for as long as a toast (a job's, for minutes) lasts. Everywhere
 * else 0: they keep their place. On the root, as the toast region is drawn in the body (toast.css reads --toasts-right).
 */
function useToastsBeside(width: number): void {
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--toasts-right', `${width}px`);
  }, [width]);
}

/**
 * A separator that mounted beside a folded panel never learns its aria values (aria-valuenow, aria-controls: axe's
 * aria-required-attr on a focusable separator), not even when the panel is shown later; one that mounted beside a shown
 * panel does, through every later fold. So a separator that began folded is mounted again once, right after its panel
 * first opens, and the new one registers beside an open panel. Returns the key to give the separator.
 */
function useSeparatorKeyAfterFirstShow(present: boolean, hidden: boolean): number {
  const [key, setKey] = useState(0);
  /** null: not mounted; true: mounted beside a folded panel and not yet remounted; false: settled. */
  const pending = useRef<boolean | null>(null);
  if (!present) pending.current = null;
  else if (pending.current === null) pending.current = hidden;
  useEffect(() => {
    if (!present || hidden || pending.current !== true) return;
    pending.current = false;
    // After the panel's own effect has resized it and the group has laid out: the next frame.
    const frame = requestAnimationFrame(() => setKey((k) => k + 1));
    return () => cancelAnimationFrame(frame);
  }, [present, hidden]);
  return key;
}

/**
 * The item panel's slot. It mounts when the library's table first shows, so its first size comes from the store then;
 * later changes go through the imperative effect, as the sidebar's. Folded, it stays mounted and inert (an open edit
 * survives a fold; nothing in it takes focus or is read out).
 */
function InspectorPanel(props: { panelRef: RefObject<PanelImperativeHandle | null>; hidden: boolean; width: number; mode: InspectorMode; children: ReactNode }) {
  const { panelRef, hidden, width, mode } = props;
  const range = mode === 'tutor' ? TUTOR : INSPECTOR;
  const [initialSize] = useState(() => (hidden ? 0 : width));
  // The group derives a late-mounted panel's constraints after this effect first runs (the handle throws until then),
  // and the first size already says what is wanted: only a change after the mount goes through the handle at once.
  const mounted = useRef(false);
  // Development's StrictMode unmounts and re-runs every effect on mount: the skip must start over with it.
  useEffect(() => () => void (mounted.current = false), []);
  useEffect(() => {
    const follow = () => {
      const panel = panelRef.current;
      if (!panel) return;
      if (hidden && !panel.isCollapsed()) panel.collapse();
      // A mode change, or a window that narrows the tutor, moves the slot to its width; a drag has already put it there.
      else if (!hidden && (panel.isCollapsed() || Math.abs(panel.getSize().inPixels - width) >= 1)) panel.resize(width);
    };
    if (!mounted.current) {
      mounted.current = true;
      // The group keeps the layout of a panel that left it (the reader's panel gone while the PDF loads, the library's folded one):
      // a panel mounted again takes that size, not its defaultSize. A frame later, once the constraints exist, it is brought to what
      // the shell says (hiddenPanes), so the toggle and the drawn panel never disagree (Mac critique 4).
      const frame = requestAnimationFrame(follow);
      return () => cancelAnimationFrame(frame);
    }
    follow();
  }, [hidden, width, mode, panelRef]);
  return (
    <Panel
      id="inspector"
      data-testid="inspector-panel"
      panelRef={panelRef}
      className="inspector-panel"
      style={CLIP}
      defaultSize={initialSize}
      minSize={range.min}
      maxSize={range.max}
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
