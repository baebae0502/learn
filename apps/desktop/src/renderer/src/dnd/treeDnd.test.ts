import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { SCOPE_KEYS } from '../sidebar/rows';
import { dragState } from './dragState';
import { MIME_COLLECTION } from './mime';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [],
  members: {},
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, [item('a')]);

vi.mock('../sidebar/actions', () => ({ currentModel: () => model, addExpanded: vi.fn(), collectionActions: {} }));
vi.mock('./actions', () => ({ dropActions: {}, viewedScope: () => ({ kind: 'all' }) }));
vi.mock('../api', () => ({ api: () => ({}), unwrap: (x: unknown) => x }));

const { rowTargets, treeDropOperation } = await import('./treeDnd');

afterEach(() => {
  dragState.end();
  dragState.setFilesOver(false);
  dragState.setAlt(false);
  dragState.setNative(false);
  vi.unstubAllGlobals();
});

const on = (key: string) => ({ type: 'item', key, dropPosition: 'on' }) as const;
const types = new Set([MIME_COLLECTION]);

describe('the tree while a collection is dragged by keyboard after a Finder drag left the window', () => {
  it('the drag of ours drops the stale "files over", so the collection rules answer, not the files ones', () => {
    // The Finder drag ended with a dragleave only, so the window listeners left "files over" set.
    dragState.setFilesOver(true);
    dragState.beginCollection('bio'); // a drag of ours
    expect(dragState.filesOver()).toBe(false);
    for (const key of ['bio', 'c6', SCOPE_KEYS.all]) expect(treeDropOperation(on(key), types as never, ['move']), key).toBe('cancel');
    expect(treeDropOperation(on('stat'), types as never, ['move'])).toBe('move');
  });
});

describe('Finder\'s files over the tree (no drag of ours)', () => {
  const files = new Set(['Files']);
  it('a collection and 내 라이브러리 take them as a copy; a special view takes none', () => {
    dragState.setFilesOver(true);
    for (const key of ['bio', 'c6', SCOPE_KEYS.all]) expect(treeDropOperation(on(key), files as never, ['copy', 'move']), key).toBe('copy');
    expect(treeDropOperation(on(SCOPE_KEYS.unfiled), files as never, ['copy'])).toBe('cancel');
    // ⌥ or the move key narrow what is allowed, not whether files drop.
    expect(treeDropOperation(on('stat'), files as never, ['move'])).toBe('move');
  });
});

describe('the drop target under the pointer', () => {
  // Rows of 28 px starting at 100: stat (the last row of its section) is 128–156.
  const rows = [['bio', 100], ['stat', 128]].map(([key, top]) => ({
    dataset: { key },
    getBoundingClientRect: () => ({ top: top as number, bottom: (top as number) + 28 }),
  }));
  const tree = { getBoundingClientRect: () => ({ top: 100 }), querySelectorAll: () => rows };

  it('the lower half of a section\'s last row is that row', () => {
    vi.stubGlobal('document', { querySelector: () => tree });
    for (const y of [28, 35, 41, 54]) expect(rowTargets.getDropTargetFromPoint(0, y, () => true), String(y)).toEqual({ type: 'item', key: 'stat', dropPosition: 'on' });
  });

  it('below the last row, and with no tree, it is the root', () => {
    vi.stubGlobal('document', { querySelector: () => tree });
    expect(rowTargets.getDropTargetFromPoint(0, 56, () => true)).toEqual({ type: 'root' });
    vi.stubGlobal('document', { querySelector: () => null });
    expect(rowTargets.getDropTargetFromPoint(0, 10, () => true)).toEqual({ type: 'root' });
  });
});
