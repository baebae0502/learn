import { useEffect, useLayoutEffect, useRef } from 'react';
import { lastInput } from '../ui/inputModality';
import { mountedTabs } from '../state/tabs';
import { useShell } from '../state/shell-store';
import { tabId, tabPanelId, useTabPanelsMounted } from '../shell/tabPanels';
import { ViewerHost } from './ViewerHost';
import { readerScopes, setActiveReaderScope } from './readerScope';

/**
 * The readers of the tabs kept mounted: the shown tab and the most recent others (tabs.ts MOUNTED_MAX, a cap). A tab that is not shown
 * stays in the page, hidden and inert, so coming back to it is a show and not an open. The panels keep their order in the
 * page whatever the order of use (a node moved in the page loses its scroll), and a tab that leaves the set is unmounted:
 * its place is saved by the reader's own unmount, and its scope stays for when the tab is chosen again.
 */
export function ReaderTabs() {
  const tabs = useShell((s) => s.tabs);
  const order = useRef<string[]>([]);
  const keep = new Set(mountedTabs(tabs));
  // A tab joins the set only by being shown (R32): closing another tab lets the next recent one into `mountedTabs`, but an evicted
  // reader is not opened again for that (it would count as opened now); the cap is four, not a floor.
  order.current = [...order.current.filter((id) => keep.has(id)), ...(keep.has(tabs.active) && !order.current.includes(tabs.active) ? [tabs.active] : [])];

  // The shell around the readers (their toolbar, sidebar, item panel and commands) talks to the shown tab's scope, from the first paint.
  useLayoutEffect(() => {
    setActiveReaderScope(tabs.active === 'library' ? null : readerScopes.get(tabs.active));
  }, [tabs.active]);
  useEffect(() => () => setActiveReaderScope(null), []);

  // A closed or deleted tab's scope goes with it; a tab that was only pushed out of the mounted set keeps its own.
  useEffect(() => {
    const open = new Set(tabs.tabs);
    for (const id of readerScopes.ids()) if (!open.has(id)) readerScopes.drop(id);
  }, [tabs.tabs]);

  useTabPanelsMounted('readers', order.current);
  return (
    <>
      {order.current.map((id) => (
        <TabPanel key={id} itemId={id} active={id === tabs.active} />
      ))}
    </>
  );
}

function TabPanel({ itemId, active }: { itemId: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  /** What had the focus in this reader when it was last shown: a hidden (inert) panel loses its focus, and shown again has none. */
  const lastFocus = useRef<HTMLElement | null>(null);
  const wasActive = useRef(active);
  // Shown again, the reader takes the focus back where it was (or at its first target: the password field, the stage, the player) —
  // except when the tab was chosen from the strip by keyboard, where the focus stays on the tab (Tab goes on into the reader).
  useLayoutEffect(() => {
    const was = wasActive.current;
    wasActive.current = active;
    const panel = box.current;
    if (!active || was || !panel) return;
    const onTab = document.activeElement instanceof Element && document.activeElement.closest('.tab-bar') !== null;
    if (onTab && lastInput() === 'keyboard') return;
    const last = lastFocus.current;
    const target = last?.isConnected && panel.contains(last) ? last : panel.querySelector<HTMLElement>('input[type="password"], .pdf-stage, video');
    target?.focus({ preventScroll: true });
  }, [active]);
  return (
    <div
      ref={box}
      className="tab-panel"
      id={tabPanelId(itemId)}
      role="tabpanel"
      aria-labelledby={tabId(itemId)}
      hidden={!active}
      inert={!active}
      data-testid="tab-panel"
      data-item-id={itemId}
      data-active={active ? 'true' : 'false'}
      onFocus={(e) => {
        if (active) lastFocus.current = e.target as HTMLElement;
      }}
    >
      <ViewerHost itemId={itemId} active={active} />
    </div>
  );
}
