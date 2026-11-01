import { describe, expect, it } from 'vitest';
import { sharedTrashedAt } from './trashNote';

const at = (iso: string) => ({ deletedAt: iso });

describe('the trash panel line under 복원 (T6 re-check §2)', () => {
  it('names the time when every selected row was trashed at the same moment, items and collections alike', () => {
    expect(sharedTrashedAt([at('2026-10-31T01:00:00.000Z'), at('2026-10-31T01:00:00.000Z'), at('2026-10-31T01:00:00.000Z')])).toBe('2026-10-31T01:00:00.000Z');
    expect(sharedTrashedAt([at('2026-10-31T01:00:00.000Z')])).toBe('2026-10-31T01:00:00.000Z');
  });
  it('leaves the time out when the rows were trashed at different moments, or there are none', () => {
    expect(sharedTrashedAt([at('2026-10-31T01:00:00.000Z'), at('2026-10-31T01:00:00.001Z')])).toBeNull();
    expect(sharedTrashedAt([])).toBeNull();
  });
});
