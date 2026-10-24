import { describe, expect, it } from 'vitest';
import {
  CONTENT_MIN, INSPECTOR, SIDEBAR, afterViewportChange, autoCollapses, clampInspector, clampSidebar, draggedInspectorWidth, hiddenPanes,
  inspectorAfterViewportChange, inspectorAutoCollapses, parsePanes, serializePanes, sidebarHidden, toggledInspector, toggledSidebar,
  type PaneState, type PanesState,
} from './layout';

const s = (over: Partial<PaneState> = {}): PaneState => ({ width: 240, collapsed: false, forceShown: false, ...over });
const i = (over: Partial<PaneState> = {}): PaneState => ({ width: 320, collapsed: false, forceShown: false, ...over });
const panes = (sidebar: Partial<PaneState> = {}, inspector: Partial<PaneState> = {}): PanesState => ({ sidebar: s(sidebar), inspector: i(inspector) });

describe('sidebar layout rules (design-spec 2.1)', () => {
  it('clamps the width to 180–360', () => {
    expect([clampSidebar(100), clampSidebar(240.4), clampSidebar(999)]).toEqual([180, 240, 360]);
    expect(SIDEBAR).toEqual({ default: 240, min: 180, max: 360 });
  });
  it('folds away automatically when the content column would drop below 520 px', () => {
    expect(CONTENT_MIN).toBe(520);
    expect(autoCollapses(760, 240)).toBe(false);
    expect(autoCollapses(759, 240)).toBe(true);
    expect(sidebarHidden(s(), 720)).toBe(true); // 1440 window at 200 % zoom
    expect(sidebarHidden(s(), 1440)).toBe(false);
  });
  it('toggling shows a folded sidebar on demand and hides a shown one as the user choice', () => {
    const shownOnDemand = toggledSidebar(s(), 720);
    expect(shownOnDemand).toEqual(s({ forceShown: true }));
    expect(sidebarHidden(shownOnDemand, 720)).toBe(false);
    expect(toggledSidebar(s(), 1440)).toEqual(s({ collapsed: true }));
    expect(toggledSidebar(s({ collapsed: true }), 1440)).toEqual(s());
  });
  it('folding a sidebar shown on demand only gives the fold back to the window width (not a user collapse, M-5)', () => {
    expect(toggledSidebar(s({ forceShown: true }), 720)).toEqual(s());
    expect(sidebarHidden(toggledSidebar(s({ forceShown: true }), 720), 720)).toBe(true);
    expect(sidebarHidden(toggledSidebar(s({ forceShown: true }), 720), 1440)).toBe(false);
  });
  it('forgets "shown on demand" once there is room again (automatic folding is never persisted)', () => {
    expect(afterViewportChange(s({ forceShown: true }), 1440)).toEqual(s());
    const same = s({ forceShown: true });
    expect(afterViewportChange(same, 720)).toBe(same);
  });
});

describe('item panel layout rules (design-spec 2.1, 2.5; spec §5.2)', () => {
  it('clamps the width to 260–480 (정보 320)', () => {
    expect(INSPECTOR).toEqual({ default: 320, min: 260, max: 480 });
    expect([clampInspector(100), clampInspector(320.4), clampInspector(999)]).toEqual([260, 320, 480]);
  });
  it('folds before the sidebar: first the item panel, then the sidebar, as the window narrows', () => {
    // 240 + 320 + 520 = 1080: both fit.
    expect(hiddenPanes(panes(), 1080, true)).toEqual({ sidebar: false, inspector: false });
    expect(hiddenPanes(panes(), 1079, true)).toEqual({ sidebar: false, inspector: true });
    expect(hiddenPanes(panes(), 760, true)).toEqual({ sidebar: false, inspector: true });
    expect(hiddenPanes(panes(), 759, true)).toEqual({ sidebar: true, inspector: true });
    expect(hiddenPanes(panes(), 720, true)).toEqual({ sidebar: true, inspector: true }); // 1440 window at 200 % zoom
    // A sidebar the user hid leaves its width to the item panel: 320 + 520 = 840.
    expect(hiddenPanes(panes({ collapsed: true }), 840, true)).toEqual({ sidebar: true, inspector: false });
    expect(hiddenPanes(panes({ collapsed: true }), 839, true).inspector).toBe(true);
    expect(inspectorAutoCollapses(panes(), 1079)).toBe(true);
    expect(inspectorAutoCollapses(panes(), 1080)).toBe(false);
  });
  it('is hidden where the view has no item panel, and where the user hid it', () => {
    expect(hiddenPanes(panes(), 1440, false)).toEqual({ sidebar: false, inspector: true });
    expect(hiddenPanes(panes({}, { collapsed: true }), 1440, true).inspector).toBe(true);
  });
  it('toggling shows a folded panel on demand and hides a shown one as the user choice', () => {
    expect(toggledInspector(panes(), 1000)).toEqual(i({ forceShown: true }));
    expect(hiddenPanes(panes({}, { forceShown: true }), 1000, true).inspector).toBe(false);
    expect(toggledInspector(panes(), 1440)).toEqual(i({ collapsed: true }));
    expect(toggledInspector(panes({}, { collapsed: true }), 1440)).toEqual(i());
    expect(toggledInspector(panes({}, { collapsed: true }), 1000)).toEqual(i({ forceShown: true }));
  });
  it('hiding a panel shown on demand gives the fold back to the window width (not a user collapse, M-5)', () => {
    expect(toggledInspector(panes({}, { forceShown: true }), 1000)).toEqual(i());
    expect(hiddenPanes({ ...panes(), inspector: toggledInspector(panes({}, { forceShown: true }), 1000) }, 1440, true).inspector).toBe(false);
  });
  it('forgets "shown on demand" once there is room again', () => {
    expect(inspectorAfterViewportChange(panes({}, { forceShown: true }), 1440)).toEqual(i());
    const same = panes({}, { forceShown: true });
    expect(inspectorAfterViewportChange(same, 1000)).toBe(same.inspector);
  });
  it('a drag never leaves the content column under 520 px, except for a panel shown on demand', () => {
    expect(draggedInspectorWidth(panes(), 1200, 470)).toBe(440); // 1200 − 240 − 520
    expect(draggedInspectorWidth(panes(), 1200, 400)).toBe(400);
    expect(draggedInspectorWidth(panes(), 1440, 600)).toBe(480);
    expect(draggedInspectorWidth(panes(), 1440, 100)).toBe(260);
    expect(draggedInspectorWidth(panes({}, { forceShown: true }), 1000, 470)).toBe(470);
  });
});

describe('layout.panes: one record for both panes', () => {
  it('reads both panes, clamps the widths and defaults what is missing', () => {
    expect(parsePanes({ sidebar: 300, sidebarCollapsed: 1, 'inspector.info': 400, inspectorCollapsed: 1 })).toEqual(panes({ width: 300, collapsed: true }, { width: 400, collapsed: true }));
    expect(parsePanes(null)).toEqual(panes());
    expect(parsePanes({ sidebar: 9999, 'inspector.info': 9999 })).toEqual(panes({ width: 360 }, { width: 480 }));
    expect(parsePanes({ sidebar: 280, sidebarCollapsed: 0 })).toEqual(panes({ width: 280 })); // an M3 record: sidebar keys only
  });
  it('writes both panes every time, never one alone, and no session-only state', () => {
    expect(serializePanes(panes({ width: 280, collapsed: true, forceShown: true }, { width: 360, forceShown: true }))).toEqual({
      sidebar: 280, sidebarCollapsed: 1, 'inspector.info': 360, inspectorCollapsed: 0,
    });
  });
});
