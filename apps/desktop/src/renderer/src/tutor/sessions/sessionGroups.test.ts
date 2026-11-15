import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@learn/domain';
import { sessionGroups } from './sessionGroups';

/** A session last talked in at this local time. */
const at = (id: string, y: number, m: number, d: number, h: number, min = 0): SessionSummary => {
  const iso = new Date(y, m - 1, d, h, min).toISOString();
  return { id, itemId: 'item', title: id, renamed: false, agent: 'fake', mixedAgents: false, createdAt: iso, updatedAt: iso };
};
const shape = (groups: ReturnType<typeof sessionGroups>) => groups.map((g) => [g.label, g.sessions.map((s) => s.id)]);

describe('sessionGroups (T1a spec 8.9): a day group each, newest first', () => {
  const now = new Date(2026, 10, 10, 12, 0);
  it('groups 오늘, 어제, then each older day by its date, and the sessions of a day newest first', () => {
    const sessions = [at('older', 2026, 10, 12, 21, 5), at('morning', 2026, 11, 10, 9, 31), at('yesterday', 2026, 11, 9, 16, 52), at('noon', 2026, 11, 10, 11, 58)];
    expect(shape(sessionGroups(sessions, now))).toEqual([
      ['오늘', ['noon', 'morning']],
      ['어제', ['yesterday']],
      ['2026. 10. 12.', ['older']],
    ]);
  });
  it('the day is the local one: just after midnight is 오늘, just before it 어제; another year keeps its year', () => {
    const sessions = [at('late', 2026, 11, 9, 23, 59), at('early', 2026, 11, 10, 0, 1), at('last-year', 2025, 11, 10, 12), at('two-days', 2026, 11, 8, 12)];
    expect(shape(sessionGroups(sessions, now))).toEqual([
      ['오늘', ['early']],
      ['어제', ['late']],
      ['2026. 11. 8.', ['two-days']],
      ['2025. 11. 10.', ['last-year']],
    ]);
  });
  it('one group a day however many sessions it has, and no group for a day without one', () => {
    const days = [at('a', 2026, 10, 1, 9), at('b', 2026, 10, 1, 18), at('c', 2026, 9, 30, 9)];
    expect(shape(sessionGroups(days, now))).toEqual([
      ['2026. 10. 1.', ['b', 'a']],
      ['2026. 9. 30.', ['c']],
    ]);
    expect(sessionGroups([], now)).toEqual([]);
  });
  it('sessions of the same moment keep the order they came in (the list\'s own)', () => {
    const same = [at('first', 2026, 11, 10, 9), at('second', 2026, 11, 10, 9)];
    expect(shape(sessionGroups(same, now))).toEqual([['오늘', ['first', 'second']]]);
  });
});
