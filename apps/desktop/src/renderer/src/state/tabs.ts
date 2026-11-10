import type { ItemType } from '@learn/domain';

/** The window's tabs: the library first and always there, then one reader tab per item. Pure; the shell store holds the state. */
export type TabId = 'library' | string;

export interface TabsState {
  /** Reader tabs only, in the order shown; a reader tab's id is its item's id. */
  tabs: string[];
  active: TabId;
  /** Reader tabs in the order they were last shown, newest first: what stays mounted and where closing the active tab goes. */
  recent: string[];
  /** Closed reader tabs, newest first, for reopening. */
  closed: string[];
}

export const NO_TABS: TabsState = { tabs: [], active: 'library', recent: [], closed: [] };
export const CLOSED_MAX = 10;
export const SAVED_MAX = 50;
export const MOUNTED_MAX = 4;
export const SAVED_TITLE_MAX = 300;

const without = (list: readonly string[], id: string) => list.filter((x) => x !== id);

/** Shows a tab: it comes first in `recent`, the library never does. */
function show(s: TabsState, id: TabId): TabsState {
  return { ...s, active: id, recent: id === 'library' ? s.recent : [id, ...without(s.recent, id)] };
}

export function selectTab(s: TabsState, id: TabId): TabsState {
  if (id === s.active) return s;
  if (id !== 'library' && !s.tabs.includes(id)) return s;
  return show(s, id);
}

export function openTabs(s: TabsState, itemIds: readonly string[], o: { background?: boolean } = {}): TabsState {
  const ids = [...new Set(itemIds)];
  if (ids.length === 0) return s;
  const fresh = ids.filter((id) => !s.tabs.includes(id));
  let tabs = s.tabs;
  if (fresh.length > 0) {
    // Right of the active tab (the library counts as the slot before the first); the background goes to the end.
    const at = o.background ? s.tabs.length : s.active === 'library' ? 0 : s.tabs.indexOf(s.active) + 1;
    tabs = [...s.tabs.slice(0, at), ...fresh, ...s.tabs.slice(at)];
  }
  const next: TabsState = { ...s, tabs, closed: s.closed.filter((id) => !ids.includes(id)) };
  return o.background ? next : show(next, ids[0]!);
}

export const openTab = (s: TabsState, itemId: string, o: { background?: boolean } = {}): TabsState => openTabs(s, [itemId], o);

export function selectTabAt(s: TabsState, index: number): TabsState {
  if (index === 0) return selectTab(s, 'library');
  const id = s.tabs[index - 1];
  return id === undefined ? s : selectTab(s, id);
}

export const selectLastTab = (s: TabsState): TabsState => selectTab(s, s.tabs.at(-1) ?? 'library');

export function selectRelativeTab(s: TabsState, delta: 1 | -1): TabsState {
  const all = ['library', ...s.tabs];
  const at = all.indexOf(s.active);
  return selectTab(s, all[(at + delta + all.length) % all.length]!);
}

/** Takes a tab out; when it was the shown one, the tab seen before it (or the library) is shown. */
function drop(s: TabsState, id: string): TabsState {
  const tabs = without(s.tabs, id);
  const recent = without(s.recent, id);
  const active = s.active === id ? (recent[0] ?? 'library') : s.active;
  return { ...s, tabs, recent, active, closed: without(s.closed, id) };
}

export function closeTab(s: TabsState, id: string): TabsState {
  if (!s.tabs.includes(id)) return s;
  const next = drop(s, id);
  return { ...next, closed: [id, ...next.closed].slice(0, CLOSED_MAX) };
}

export function closeOtherTabs(s: TabsState, id: string): TabsState {
  if (!s.tabs.includes(id)) return s;
  let next = s;
  for (const other of s.tabs) if (other !== id) next = closeTab(next, other);
  return selectTab(next, id);
}

export function reopenClosedTab(s: TabsState, isOpenable: (id: string) => boolean): TabsState {
  const id = s.closed.find(isOpenable);
  // What cannot be opened is forgotten too, so the next ask does not meet it again.
  const closed = id === undefined ? [] : s.closed.slice(s.closed.indexOf(id) + 1);
  const next = { ...s, closed };
  return id === undefined ? next : openTab(next, id);
}

export function moveTab(s: TabsState, id: string, toIndex: number): TabsState {
  if (!s.tabs.includes(id)) return s;
  const rest = without(s.tabs, id);
  const at = Math.max(0, Math.min(rest.length, toIndex));
  return { ...s, tabs: [...rest.slice(0, at), id, ...rest.slice(at)] };
}

/** An item that is gone for good: its tab goes without a place in `closed`. */
export function removeTab(s: TabsState, id: string): TabsState {
  return s.tabs.includes(id) || s.closed.includes(id) ? drop(s, id) : s;
}

export function mountedTabs(s: TabsState, limit: number = MOUNTED_MAX): string[] {
  const order = s.active === 'library' ? s.recent : [s.active, ...without(s.recent, s.active)];
  return order.filter((id) => s.tabs.includes(id)).slice(0, limit);
}

/** What a reader tab last showed of its item: its name and kind, kept in the saved session so the strip is whole in its first frame. */
export interface KnownTabItem {
  title: string;
  type: ItemType;
}
export type KnownTabItems = Readonly<Record<string, KnownTabItem>>;

export interface SavedTabs {
  items: string[];
  active: string | null;
  known?: Record<string, KnownTabItem> | undefined;
}

/** The record of ui.tabs; `known` only for the tabs kept, and left out when it holds none. */
export function toSaved(s: TabsState, known: KnownTabItems = {}): SavedTabs {
  const items = s.tabs.slice(0, SAVED_MAX);
  const kept: Record<string, KnownTabItem> = {};
  for (const id of items) {
    const k = known[id];
    if (k) kept[id] = { title: k.title.slice(0, SAVED_TITLE_MAX), type: k.type };
  }
  return { items, active: items.includes(s.active) ? s.active : null, ...(Object.keys(kept).length > 0 ? { known: kept } : {}) };
}

export function fromSaved(v: SavedTabs | undefined): TabsState {
  if (!v) return NO_TABS;
  const tabs = [...new Set(v.items)].slice(0, SAVED_MAX);
  const active = v.active !== null && tabs.includes(v.active) ? v.active : 'library';
  return { tabs, active, recent: active === 'library' ? [] : [active], closed: [] };
}

/** The names the saved session carried, for the tabs it reopens. */
export function knownFromSaved(v: SavedTabs | undefined): KnownTabItems {
  return v?.known ?? {};
}
