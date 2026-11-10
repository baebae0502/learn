import { useEffect, useSyncExternalStore } from 'react';

/** The tabs whose panel is in the page now ('library' for the library's content): a tab points at its panel only while there is one. */
let mounted: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function set(next: ReadonlySet<string>) {
  if (next.size === mounted.size && [...next].every((id) => mounted.has(id))) return;
  mounted = next;
  for (const l of listeners) l();
}

/** Registers `ids` as having a panel for as long as the caller stays; one owner per id. */
export function useTabPanelsMounted(owner: string, ids: readonly string[]): void {
  const key = ids.join('\n');
  useEffect(() => {
    const mine = key === '' ? [] : key.split('\n');
    owners.set(owner, mine);
    publish();
    return () => {
      owners.delete(owner);
      publish();
    };
  }, [owner, key]);
}

const owners = new Map<string, readonly string[]>();
const publish = () => set(new Set([...owners.values()].flat()));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const panelMounted = (id: string): boolean => mounted.has(id);

/** Whether the tab `id` has a panel in the page. */
export function useHasTabPanel(id: string): boolean {
  return useSyncExternalStore(subscribe, () => mounted.has(id));
}

export const tabId = (id: string) => `tab-${id}`;
export const tabPanelId = (id: string) => `tabpanel-${id}`;
