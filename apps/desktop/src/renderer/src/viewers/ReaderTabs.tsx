import { useEffect, useLayoutEffect, useRef } from 'react';
import { mountedTabs } from '../state/tabs';
import { useShell } from '../state/shell-store';
import { useItem } from '../data/queries';
import { ViewerHost } from './ViewerHost';
import { readerScopes, setActiveReaderScope } from './readerScope';

/**
 * The readers of the tabs kept mounted: the shown tab and the most recent others (tabs.ts MOUNTED_MAX). A tab that is not shown
 * stays in the page, hidden and inert, so coming back to it is a show and not an open. The panels keep their order in the
 * page whatever the order of use (a node moved in the page loses its scroll), and a tab that leaves the set is unmounted:
 * its place is saved by the reader's own unmount, and its scope stays for when the tab is chosen again.
 */
export function ReaderTabs() {
  const tabs = useShell((s) => s.tabs);
  const order = useRef<string[]>([]);
  const keep = new Set(mountedTabs(tabs));
  order.current = [...order.current.filter((id) => keep.has(id)), ...[...keep].filter((id) => !order.current.includes(id))];

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

  return (
    <>
      {order.current.map((id) => (
        <TabPanel key={id} itemId={id} active={id === tabs.active} />
      ))}
    </>
  );
}

function TabPanel({ itemId, active }: { itemId: string; active: boolean }) {
  const title = useItem(itemId).data?.title;
  return (
    <div
      className="tab-panel"
      role="tabpanel"
      aria-label={title}
      hidden={!active}
      inert={!active}
      data-testid="tab-panel"
      data-item-id={itemId}
      data-active={active ? 'true' : 'false'}
    >
      <ViewerHost itemId={itemId} active={active} />
    </div>
  );
}
