import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { TrashView } from '@learn/domain';
import { keys } from './queries';

describe('the trash view query', () => {
  it('lives under ["library"]: every whole-library notice — trash, restore, purge — marks it stale with the rest', async () => {
    expect(keys.trash).toEqual(['library', 'trash']);
    const client = new QueryClient();
    const view: TrashView = { collections: [], items: [] };
    client.setQueryData(keys.trash, view);
    await client.invalidateQueries({ queryKey: ['library'] });
    expect(client.getQueryState(keys.trash)?.isInvalidated).toBe(true);
  });
});
