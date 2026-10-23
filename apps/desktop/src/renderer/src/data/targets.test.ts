import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { keys } from './queries';
import { freshTargets } from './targets';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const OTHER = '3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f';
const item = (id: string, availability: 'available' | 'missing') => ({ id, storageMode: 'linked', availability }) as LibraryItem;

describe('freshTargets (command availability from the freshest fact)', () => {
  it('prefers the item read (library.get re-checked the file) while it is current', () => {
    const client = new QueryClient();
    client.setQueryData(keys.item(ID), item(ID, 'missing'));
    expect(freshTargets(client, [item(ID, 'available')], [ID]).map((t) => t.availability)).toEqual(['missing']);
  });
  it('falls back to the list once that read is invalidated (a change was announced since)', async () => {
    const client = new QueryClient();
    client.setQueryData(keys.item(ID), item(ID, 'available')); // cached while the reader was open
    await client.invalidateQueries({ queryKey: ['library'] }); // libraryChanged: the file went missing
    const list = [item(ID, 'missing')]; // the list was read again
    expect(freshTargets(client, list, [ID]).map((t) => t.availability)).toEqual(['missing']);
  });
  it('uses the list for items never read alone, and drops unknown ids', () => {
    const client = new QueryClient();
    expect(freshTargets(client, [item(OTHER, 'available')], [OTHER, ID]).map((t) => t.id)).toEqual([OTHER]);
  });
});
