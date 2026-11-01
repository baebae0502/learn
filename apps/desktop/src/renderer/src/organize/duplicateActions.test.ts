import { describe, expect, it, vi } from 'vitest';
import type { KeepOneResult, LibraryScope, OrganizeSnapshot } from '@learn/domain';
import { createDuplicateActions, type DuplicateActionDeps } from './duplicateActions';
import { buildOrganizeModel } from './model';
import { item } from './testing';

const SNAPSHOT: OrganizeSnapshot = { collections: [], tags: [], members: {}, tagged: {}, duplicates: [['p1', 'p2', 'p3'], ['q1', 'q2']], trashCount: 0 };
const model = buildOrganizeModel(SNAPSHOT, ['p1', 'p2', 'p3', 'q1', 'q2'].map((id) => item(id)));
const answer = (trashed: string[], kept: string[]): KeepOneResult => ({ kept, trashed, undo: { trashed, stamp: '2026-10-31T02:00:00.000Z', memberships: [], tags: [] } });

function harness(start: LibraryScope, over: Partial<DuplicateActionDeps> = {}) {
  const log: string[] = [];
  const toasts: Array<{ title: string; undo: () => Promise<void> }> = [];
  let scope = start;
  const deps: DuplicateActionDeps = {
    keepOne: vi.fn(async (itemIds: readonly string[]) => {
      log.push(`keepOne ${itemIds.join(' ')}`);
      return answer(['p2', 'p3'], ['p1']);
    }),
    keepAll: vi.fn(async () => {
      log.push('keepAll');
      return answer(['p2', 'p3', 'q2'], ['p1', 'q1']);
    }),
    undo: vi.fn(async () => {
      log.push('undo');
      return 3;
    }),
    model: () => model,
    scope: () => scope,
    setScope: (next) => {
      log.push(`view ${next.kind}`);
      scope = next;
    },
    settled: async () => void log.push('list read'),
    undoToast: (title, undo) => void toasts.push({ title, undo }),
    failed: vi.fn(),
    ...over,
  };
  return { deps, actions: createDuplicateActions(deps), log, toasts };
}

describe('하나만 남기고 휴지통으로 (M6 spec 5)', () => {
  it('cleans the groups of the rows handed over; the view stays while a group is left; 실행 취소 hands main its token', async () => {
    const h = harness({ kind: 'duplicates' });
    await h.actions.keepOne(['p2']);
    expect(h.log).toEqual(['keepOne p2']);
    expect(h.toasts.map((t) => t.title)).toEqual(['중복 2개를 휴지통으로 옮겼습니다']);
    await h.toasts[0]!.undo();
    expect(h.deps.undo).toHaveBeenCalledWith(answer(['p2', 'p3'], ['p1']).undo);
    expect(h.log).toEqual(['keepOne p2', 'undo']);
  });

  it('goes to 내 라이브러리 once no group is left, after the list was read again; the undo does not move the view back', async () => {
    const h = harness({ kind: 'duplicates' }, { keepOne: vi.fn(async () => answer(['p2', 'p3', 'q2'], ['p1', 'q1'])) });
    await h.actions.keepOne(['p2', 'q1']);
    expect(h.log).toEqual(['list read', 'view all']);
    await h.toasts[0]!.undo();
    expect(h.log).toEqual(['list read', 'view all', 'undo']);
  });

  it('says nothing when nothing went (another window cleaned them first); a refused call is the failure toast', async () => {
    const quiet = harness({ kind: 'duplicates' }, { keepOne: vi.fn(async () => answer([], [])) });
    await quiet.actions.keepOne(['p2', 'q1']);
    expect([quiet.toasts, quiet.log]).toEqual([[], []]);
    const refused = new Error('라이브러리를 열 수 없습니다.');
    const failing = harness({ kind: 'duplicates' }, { keepOne: vi.fn(async () => Promise.reject(refused)) });
    await failing.actions.keepOne(['p2']);
    expect(failing.deps.failed).toHaveBeenCalledWith(refused);
    expect(failing.toasts).toEqual([]);
  });
});

describe('중복 N묶음 모두 정리', () => {
  it('leaves no group: from 중복 항목 the view goes to 내 라이브러리', async () => {
    const h = harness({ kind: 'duplicates' });
    await h.actions.keepAll();
    expect(h.log).toEqual(['keepAll', 'list read', 'view all']);
    expect(h.toasts.map((t) => t.title)).toEqual(['중복 3개를 휴지통으로 옮겼습니다']);
  });

  it('run from another view (the palette) it stays where it is', async () => {
    const h = harness({ kind: 'collection', id: 'c1' });
    await h.actions.keepAll();
    expect(h.log).toEqual(['keepAll']);
  });
});
