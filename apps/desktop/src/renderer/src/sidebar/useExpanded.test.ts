import { describe, expect, it, vi } from 'vitest';
import { SIDEBAR_EXPANDED_MAX } from '@learn/domain';

const saved: Array<[string, unknown]> = [];
vi.mock('../data/saveSetting', () => ({ saveSetting: (key: string, value: unknown) => void saved.push([key, value]) }));
const { saveExpanded } = await import('./useExpanded');

describe('saveExpanded', () => {
  it('at the cap keeps the newest: the collection opened last stays open', () => {
    const ids = Array.from({ length: SIDEBAR_EXPANDED_MAX + 1 }, (_, i) => `id-${i}`);
    saveExpanded(new Set(ids));
    const [key, value] = saved.at(-1)!;
    expect(key).toBe('sidebar.expanded');
    expect(value).toHaveLength(SIDEBAR_EXPANDED_MAX);
    expect((value as string[]).at(-1)).toBe(`id-${SIDEBAR_EXPANDED_MAX}`);
    expect(value).not.toContain('id-0');
  });
});
