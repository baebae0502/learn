import type { KeepOneResult, KeepOneUndo, LibraryScope } from '@learn/domain';
import { t } from '../strings';
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
  /** The toast's key, for trackUndo. */
  undoToast(title: string, undo: () => Promise<void>): string;
  /** The toast stands for these trashed items: a purge of them closes it (trashActions.trackUndo); the function it returns drops the entry (the toast's own 실행 취소). */
  trackUndo(toastKey: string, itemIds: readonly string[]): () => void;
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
  async function clean(run: () => Promise<KeepOneResult>): Promise<void> {
    let result: KeepOneResult;
    try {
      result = await run();
    } catch (e) {
      deps.failed(e);
      return;
    }
    if (result.trashed.length === 0) return;
    if (deps.scope().kind === 'duplicates') {
      // Decided from the list read after the call, not from the model before it: another window may have cleaned a group meanwhile.
      await deps.settled();
      if ((deps.model()?.duplicateGroups.length ?? 0) === 0) deps.setScope(SCOPE_ALL);
    }
    let dispose = (): void => {};
    const key = deps.undoToast(t.organize.duplicates.done(result.trashed.length), async () => {
      dispose();
      await deps.undo(result.undo);
    });
    dispose = deps.trackUndo(key, result.trashed);
  }
  return {
    keepOne: (itemIds) => clean(() => deps.keepOne(itemIds)),
    keepAll: () => clean(() => deps.keepAll()),
  };
}
