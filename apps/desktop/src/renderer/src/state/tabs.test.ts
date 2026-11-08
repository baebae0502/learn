import { describe, expect, test } from 'vitest';
import { SAVED_TITLE_MAX, CLOSED_MAX, NO_TABS, SAVED_MAX, closeOtherTabs, closeTab, fromSaved, moveTab, mountedTabs, openTab, openTabs, removeTab, reopenClosedTab, selectLastTab, selectRelativeTab, selectTab, selectTabAt, toSaved, knownFromSaved } from './tabs';

test('↩ on an open item goes to its tab; ⌘↩ never switches', () => {
  const s = openTab(openTab(NO_TABS, 'a'), 'b', { background: true });
  expect(s.active).toBe('a');
  expect(s.tabs).toEqual(['a', 'b']);
  expect(openTab(s, 'b').active).toBe('b');
  expect(openTab(s, 'b').tabs).toEqual(['a', 'b']);
});

test('a new tab opens right of the active one', () => {
  const s = selectTab(openTabs(NO_TABS, ['a', 'b', 'c']), 'a');
  expect(openTab(s, 'd').tabs).toEqual(['a', 'd', 'b', 'c']);
});

test('closing the active tab goes to the one seen before it', () => {
  let s = openTab(openTab(openTab(NO_TABS, 'a'), 'b'), 'c');
  s = selectTab(s, 'a');
  expect(closeTab(s, 'a').active).toBe('c');
  expect(closeTab(s, 'a').closed).toEqual(['a']);
});

test('the four most recent reader tabs stay mounted', () => {
  let s = openTabs(NO_TABS, ['a', 'b', 'c', 'd', 'e']);
  for (const id of ['a', 'b', 'c', 'd', 'e']) s = selectTab(s, id);
  expect(mountedTabs(s)).toEqual(['e', 'd', 'c', 'b']);
});

describe('more of the model', () => {
  test('a tab opened from the library lands first; background goes to the end', () => {
    const s = openTabs(NO_TABS, ['a', 'b']);
    expect(openTab(selectTab(s, 'library'), 'c').tabs).toEqual(['c', 'a', 'b']);
    expect(openTab(s, 'c', { background: true }).tabs).toEqual(['a', 'b', 'c']);
  });
  test('openTabs opens in order and goes to the first, unless in the background', () => {
    const s = openTabs(NO_TABS, ['a', 'b', 'c']);
    expect(s.tabs).toEqual(['a', 'b', 'c']);
    expect(s.active).toBe('a');
    const bg = openTabs(NO_TABS, ['a', 'b'], { background: true });
    expect(bg.active).toBe('library');
    expect(bg.tabs).toEqual(['a', 'b']);
  });
  test('closed keeps ten, the oldest dropped first', () => {
    const ids = Array.from({ length: CLOSED_MAX + 2 }, (_, i) => `t${i}`);
    let s = openTabs(NO_TABS, ids);
    for (const id of ids) s = closeTab(s, id);
    expect(s.closed).toHaveLength(CLOSED_MAX);
    expect(s.closed[0]).toBe(ids.at(-1));
    expect(s.closed).not.toContain('t0');
  });
  test('reopenClosedTab skips what cannot be opened', () => {
    let s = openTabs(NO_TABS, ['a', 'b', 'c']);
    s = closeTab(closeTab(s, 'a'), 'b');
    const r = reopenClosedTab(s, (id) => id === 'a');
    expect(r.tabs).toContain('a');
    expect(r.active).toBe('a');
    expect(r.closed).toEqual([]);
    expect(reopenClosedTab(s, () => false)).toMatchObject({ tabs: ['c'] });
  });
  test('removeTab does not put the tab in closed', () => {
    const s = removeTab(openTabs(NO_TABS, ['a', 'b']), 'a');
    expect(s.tabs).toEqual(['b']);
    expect(s.closed).toEqual([]);
    expect(s.active).toBe('library'); // b was never shown, so nothing was seen before a
  });
  test('closeOtherTabs keeps one and goes to it', () => {
    const s = closeOtherTabs(openTabs(NO_TABS, ['a', 'b', 'c']), 'b');
    expect(s.tabs).toEqual(['b']);
    expect(s.active).toBe('b');
    expect([...s.closed].sort()).toEqual(['a', 'c']);
  });
  test('closing the last tab goes to the library', () => {
    expect(closeTab(openTab(NO_TABS, 'a'), 'a').active).toBe('library');
  });
  test('selectRelativeTab wraps around, library included', () => {
    const s = openTabs(NO_TABS, ['a', 'b']);
    expect(selectRelativeTab(selectTab(s, 'b'), 1).active).toBe('library');
    expect(selectRelativeTab(selectTab(s, 'library'), -1).active).toBe('b');
    expect(selectRelativeTab(s, 1).active).toBe('b');
  });
  test('selectTabAt: 0 is the library, out of range stays', () => {
    const s = openTabs(NO_TABS, ['a', 'b']);
    expect(selectTabAt(s, 0).active).toBe('library');
    expect(selectTabAt(s, 2).active).toBe('b');
    expect(selectTabAt(s, 3)).toBe(s);
    expect(selectLastTab(s).active).toBe('b');
  });
  test('moveTab places among the reader tabs', () => {
    const s = openTabs(NO_TABS, ['a', 'b', 'c']);
    expect(moveTab(s, 'a', 2).tabs).toEqual(['b', 'c', 'a']);
    expect(moveTab(s, 'c', 0).tabs).toEqual(['c', 'a', 'b']);
    expect(moveTab(s, 'c', 99).tabs).toEqual(['a', 'b', 'c']);
  });
  test('selecting a tab that is not open changes nothing', () => {
    const s = openTab(NO_TABS, 'a');
    expect(selectTab(s, 'zzz')).toBe(s);
  });
  test('toSaved cuts at fifty; fromSaved takes undefined and a missing active', () => {
    const ids = Array.from({ length: SAVED_MAX + 5 }, (_, i) => `t${i}`);
    const saved = toSaved(openTabs(NO_TABS, ids));
    expect(saved.items).toHaveLength(SAVED_MAX);
    expect(saved.active).toBe('t0');
    expect(toSaved(NO_TABS)).toEqual({ items: [], active: null });
    expect(fromSaved(undefined)).toEqual(NO_TABS);
    expect(fromSaved({ items: ['a', 'b'], active: 'zzz' }).active).toBe('library');
    expect(fromSaved({ items: ['a', 'b'], active: 'b' })).toMatchObject({ tabs: ['a', 'b'], active: 'b' });
    expect(fromSaved({ items: ['a', 'a'], active: null }).tabs).toEqual(['a']);
  });
  test('toSaved carries the known title and kind of the tabs it keeps, cut at 300, and nothing for a tab that is not saved (R38)', () => {
    const s = openTabs(NO_TABS, ['a', 'b']);
    const known = { a: { title: 'Alpha', type: 'pdf' as const }, b: { title: 'x'.repeat(400), type: 'video' as const }, gone: { title: 'Gone', type: 'pdf' as const } };
    const saved = toSaved(s, known);
    expect(saved.known).toEqual({ a: { title: 'Alpha', type: 'pdf' }, b: { title: 'x'.repeat(SAVED_TITLE_MAX), type: 'video' } });
    // None known: the record is the one written before, with no `known` key at all.
    expect(toSaved(s)).toEqual({ items: ['a', 'b'], active: 'a' });
    expect('known' in toSaved(s, { gone: known.gone })).toBe(false);
    // It comes back as the strip's stand-in names.
    expect(knownFromSaved(saved)).toEqual(saved.known);
    expect(knownFromSaved(undefined)).toEqual({});
    expect(knownFromSaved({ items: ['a'], active: null })).toEqual({});
  });
});
