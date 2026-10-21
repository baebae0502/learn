import { describe, expect, it } from 'vitest';
import { CONTENT_MIN, SIDEBAR, afterViewportChange, autoCollapses, clampSidebar, parsePanes, serializePanes, sidebarHidden, toggledSidebar, type SidebarState } from './layout';

const s = (over: Partial<SidebarState> = {}): SidebarState => ({ width: 240, collapsed: false, forceShown: false, ...over });

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
  it('forgets "shown on demand" once there is room again (automatic folding is never persisted)', () => {
    expect(afterViewportChange(s({ forceShown: true }), 1440)).toEqual(s());
    const same = s({ forceShown: true });
    expect(afterViewportChange(same, 720)).toBe(same);
  });
  it('reads and writes the layout.panes setting', () => {
    expect(parsePanes({ sidebar: 300, sidebarCollapsed: 1 })).toEqual({ width: 300, collapsed: true, forceShown: false });
    expect(parsePanes(null)).toEqual(s());
    expect(parsePanes({ sidebar: 9999 })).toEqual(s({ width: 360 }));
    expect(serializePanes(s({ width: 280, collapsed: true }))).toEqual({ sidebar: 280, sidebarCollapsed: 1 });
  });
});
