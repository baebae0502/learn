import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { LibraryItem, OrganizeSnapshot } from '@learn/domain';
import { keys } from '../data/queries';
import { commandTargets } from './targets';

const item = (id: string, availability: 'available' | 'missing', storageMode: 'managed' | 'linked' = 'managed') => ({ id, storageMode, availability }) as LibraryItem;
const SNAPSHOT: OrganizeSnapshot = {
  collections: [],
  tags: [
    { id: 't1', name: '중요', color: 'green', position: 3 },
    { id: 't2', name: '복습', color: null, position: null },
  ],
  members: {},
  tagged: {},
  duplicates: [],
};
const LIST = [item('a', 'available'), item('b', 'missing', 'linked')];

describe('the targets a command is judged on (P-4)', () => {
  it('gives items by their freshest facts, collections by id, and tags with whether they have a colour — in that order', () => {
    const client = new QueryClient();
    client.setQueryData(keys.organize, SNAPSHOT);
    expect(commandTargets(client, LIST, { itemIds: ['b', 'a'], collectionIds: ['c1'], tagIds: ['t1', 't2'] })).toEqual([
      { kind: 'item', storageMode: 'linked', availability: 'missing' },
      { kind: 'item', storageMode: 'managed', availability: 'available' },
      { kind: 'collection', id: 'c1' },
      { kind: 'tag', id: 't1', hasColor: true },
      { kind: 'tag', id: 't2', hasColor: false },
    ]);
  });
  it('leaves out an item the list does not have and a tag the snapshot does not know', () => {
    const client = new QueryClient();
    client.setQueryData(keys.organize, SNAPSHOT);
    expect(commandTargets(client, LIST, { itemIds: ['gone'], tagIds: ['gone'] })).toEqual([]);
  });
  it('knows no tag before the snapshot has arrived, and an empty target has no targets', () => {
    const client = new QueryClient();
    expect(commandTargets(client, LIST, { tagIds: ['t1'] })).toEqual([]);
    expect(commandTargets(client, LIST, {})).toEqual([]);
    expect(commandTargets(client, LIST, { args: { column: 'year' } })).toEqual([]);
  });
});
