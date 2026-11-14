import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '@learn/domain';
import { renamedTitle } from './sessionEdit';

const session = (title: string, renamed: boolean): SessionSummary => ({
  id: 's', itemId: 'i', title, renamed, agent: 'fake', mixedAgents: false, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
});

describe('renamedTitle (T1a spec 8.9): what a finished name field asks of sessions:rename', () => {
  it('a new name, trimmed and normalized as the database keeps it', () => {
    expect(renamedTitle('  증폭 배율 정리 ', session('어텐션이 뭐야?', false))).toEqual({ title: '증폭 배율 정리' });
    expect(renamedTitle('é', session('x', true))).toEqual({ title: 'é' });
  });
  it('an emptied name goes back to the first question: null, for a renamed session only', () => {
    expect(renamedTitle('   ', session('정리', true))).toEqual({ title: null });
    expect(renamedTitle('', session('어텐션이 뭐야?', false))).toBe('unchanged');
  });
  it('the name it has is no change: the first question kept as it is stays unrenamed', () => {
    expect(renamedTitle('어텐션이 뭐야?', session('어텐션이 뭐야?', false))).toBe('unchanged');
    expect(renamedTitle(' 정리 ', session('정리', true))).toBe('unchanged');
    // Typing the first question as a name of its own makes it one.
    expect(renamedTitle('정리', session('어텐션이 뭐야?', true))).toEqual({ title: '정리' });
  });
  it('more than 200 characters is refused (the field says so)', () => {
    expect(renamedTitle('가'.repeat(200), session('x', false))).toEqual({ title: '가'.repeat(200) });
    expect(renamedTitle('가'.repeat(201), session('x', false))).toBe('tooLong');
  });
});
