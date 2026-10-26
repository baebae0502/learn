import type { Collection, LibraryScope, OrganizeSnapshot } from '@learn/domain';
import type { OrganizeModel } from '../organize/model';
import { t } from '../strings';
import { NEW_COLLECTION_NAME, finishName } from './nameEdit';
import { withCollection, withRenamed, withoutCollections } from './organizeCache';
import { descendantIds } from './rows';
import { useSidebarEdit } from './sidebarEdit';

/** Everything the collection actions touch outside themselves, so they run in a test without a window. */
export interface ActionDeps {
  collections: {
    create(input: { name: string; parentId: string | null }): Promise<Collection>;
    rename(input: { collectionId: string; name: string }): Promise<Collection>;
    remove(input: { collectionId: string }): Promise<void>;
    restore(input: { collectionId: string }): Promise<Collection>;
  };
  /** ui.confirm: the native sheet. */
  confirm(input: { message: string; detail?: string; confirm: string }): Promise<boolean>;
  model(): OrganizeModel | undefined;
  /** The scope shown. */
  scope(): LibraryScope;
  setScope(scope: LibraryScope): void;
  /** Changes the organize snapshot in the cache (the notice that follows brings the real one). */
  patch(update: (s: OrganizeSnapshot) => OrganizeSnapshot): void;
  /** Opens a collection's row in the tree and remembers it. */
  expand(collectionId: string): void;
  /** The sidebar is shown (it may be hidden when ⇧⌘N is pressed). */
  showSidebar(): void;
  /** What has the focus now (given back when the edit ends). */
  opener(): Element | null;
  failed(e: unknown): void;
  undoToast(title: string, undo: () => Promise<void>): void;
}

export interface CollectionActions {
  /** ⇧⌘N, 새 하위 컬렉션, 컬렉션에 추가 › 새 컬렉션: a row at the top (or under `parentId`), named in place. */
  startNew(opts?: { parentId?: string | null; onCreated?: (collectionId: string) => void }): void;
  startRename(collectionId: string): void;
  /**
   * Ends the edit with the text in the field: `enter` (↩), `blur` (a click elsewhere) or `scroll` (the row left the
   * virtual window). A name over the limit keeps the edit open on ↩ and drops it on the others.
   */
  finish(text: string, how: 'enter' | 'blur' | 'scroll'): Promise<void>;
  cancel(): void;
  remove(collectionId: string): Promise<void>;
}

export function createCollectionActions(deps: ActionDeps): CollectionActions {
  const edit = () => useSidebarEdit.getState();
  return {
    startNew(opts = {}) {
      const parentId = opts.parentId ?? null;
      if (parentId !== null && deps.model()?.node(parentId) === undefined) return;
      deps.showSidebar();
      if (parentId !== null) deps.expand(parentId);
      edit().begin({ kind: 'new', parentId, text: NEW_COLLECTION_NAME, ...(opts.onCreated ? { onCreated: opts.onCreated } : {}) }, deps.opener());
    },

    startRename(collectionId) {
      const node = deps.model()?.node(collectionId);
      if (!node) return;
      deps.showSidebar();
      edit().begin({ kind: 'rename', id: collectionId, text: node.name }, deps.opener());
    },

    async finish(text, how) {
      const s = edit();
      const current = s.edit;
      if (!current || s.busy) return;
      const original = current.kind === 'new' ? NEW_COLLECTION_NAME : (deps.model()?.node(current.id)?.name ?? '');
      const verdict = finishName(text, original);
      if ('tooLong' in verdict) {
        if (how !== 'enter') s.end(false);
        return;
      }
      s.setBusy(true);
      try {
        if (current.kind === 'new') {
          const made = await deps.collections.create({ name: verdict.name, parentId: current.parentId });
          deps.patch((snap) => withCollection(snap, made));
          current.onCreated?.(made.id);
        } else if (verdict.name !== original) {
          const renamed = await deps.collections.rename({ collectionId: current.id, name: verdict.name });
          deps.patch((snap) => withRenamed(snap, renamed.id, renamed.name));
        }
      } catch (e) {
        deps.failed(e);
      } finally {
        edit().end(how === 'enter'); // a click elsewhere or a scroll has put the focus where the user wants it
      }
    },

    cancel() {
      const s = edit();
      if (s.edit && !s.busy) s.end();
    },

    async remove(collectionId) {
      const model = deps.model();
      const node = model?.node(collectionId);
      if (!model || !node) return;
      const below = descendantIds(model, collectionId);
      const sure = await deps.confirm({ message: t.organize.remove.message(node.name), detail: t.organize.remove.detail(below.length), confirm: t.organize.remove.confirm });
      if (!sure) return;
      const scope = deps.scope();
      const viewed = scope.kind === 'collection' && (scope.id === collectionId || below.includes(scope.id));
      try {
        await deps.collections.remove({ collectionId });
      } catch (e) {
        deps.failed(e);
        return;
      }
      deps.patch((snap) => withoutCollections(snap, new Set([collectionId, ...below])));
      if (viewed) deps.setScope(node.parentId === null ? { kind: 'all' } : { kind: 'collection', id: node.parentId });
      deps.undoToast(t.organize.remove.done(node.name), async () => {
        await deps.collections.restore({ collectionId });
      });
    },
  };
}
