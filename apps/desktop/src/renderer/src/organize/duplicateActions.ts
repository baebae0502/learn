import type { KeepOneResult, KeepOneUndo, LibraryScope } from '@learn/domain';
import { t } from '../strings';
import { groupsLeftAfter } from './duplicates';
import type { OrganizeModel } from './model';
import { SCOPE_ALL } from './scope';

export interface DuplicateActionDeps {
  keepOne(itemIds: readonly string[]): Promise<KeepOneResult>;
  keepAll(): Promise<KeepOneResult>;
  undo(token: KeepOneUndo): Promise<number>;
  model(): OrganizeModel | undefined;
  scope(): LibraryScope;
  setScope(scope: LibraryScope): void;
  /** The list read again (waited for a while at most): the view moves once the trashed rows have left it. */
  settled(): Promise<void>;
  undoToast(title: string, undo: () => Promise<void>): void;
  failed(e: unknown): void;
}

export interface DuplicateActions {
  /** 하나만 남기고 휴지통으로: each group of these items keeps its earliest import (spec 5). */
  keepOne(itemIds: readonly string[]): Promise<void>;
  /** 중복 N묶음 모두 정리. */
  keepAll(): Promise<void>;
}

/**
 * The clean-up's screen side: main merges and trashes in one transaction (library.keepOneOf…) and hands back the undo
 * token, which 실행 취소 gives back unchanged. With no group left the 중복 항목 view has nothing to show: it gives way to
 * 내 라이브러리 (spec 5), and the undo does not bring it back (as a deleted collection's).
 */
export function createDuplicateActions(deps: DuplicateActionDeps): DuplicateActions {
  async function clean(run: () => Promise<KeepOneResult>, left: number): Promise<void> {
    let result: KeepOneResult;
    try {
      result = await run();
    } catch (e) {
      deps.failed(e);
      return;
    }
    if (result.trashed.length === 0) return;
    if (left === 0 && deps.scope().kind === 'duplicates') {
      await deps.settled();
      deps.setScope(SCOPE_ALL);
    }
    deps.undoToast(t.organize.duplicates.done(result.trashed.length), async () => {
      await deps.undo(result.undo);
    });
  }
  return {
    keepOne: (itemIds) => clean(() => deps.keepOne(itemIds), groupsLeftAfter(deps.model()?.duplicateGroups ?? [], itemIds)),
    keepAll: () => clean(() => deps.keepAll(), 0),
  };
}
