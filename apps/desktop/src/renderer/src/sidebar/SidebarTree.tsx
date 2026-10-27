import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ChevronDown, ChevronRight, Clock, Copy, Folder, FolderOpen, GripVertical, Inbox, LibraryBig, type LucideIcon } from 'lucide-react';
import {
  Button, Tree, TreeHeader, TreeItem, TreeItemContent, TreeSection, Virtualizer, type Key, type Selection, type TreeProps, type TreeState,
} from 'react-aria-components';
import { flushSync } from 'react-dom';
import type { LibraryScope } from '@learn/domain';
import { api, unwrap } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { runPicked } from '../commands/registry';
import type { CollectionNode, OrganizeModel } from '../organize/model';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { isContextMenuKey, menuPointFor } from '../ui/contextMenuKey';
import { showToast } from '../ui/toasts';
import { dragState } from '../dnd/dragState';
import { inertRow } from '../dnd/rules';
import { addExpanded, collectionActions } from './actions';
import { CollectionsHeading } from './CollectionsHeading';
import { HEADING_HEIGHT } from './layout';
import { NameField } from './NameField';
import { DRAFT_KEY, SCOPE_KEYS, ancestorIds, keyOfScope, scopeOfKey, visibleCollectionKeys, type SpecialKind, type SpecialRow } from './rows';
import { NEW_COLLECTION_NAME } from './nameEdit';
import { useSidebarEdit } from './sidebarEdit';
import { TreeSectionsLayout } from './treeLayout';
import { treeKeyAction } from './treeKeys';
import { saveExpanded } from './useExpanded';

const SPECIAL: Record<SpecialKind, { icon: LucideIcon; label: string }> = {
  all: { icon: LibraryBig, label: t.shell.myLibrary },
  recent: { icon: Clock, label: t.organize.scopes.recent },
  unfiled: { icon: Inbox, label: t.organize.scopes.unfiled },
  duplicates: { icon: Copy, label: t.organize.scopes.duplicates },
};

export interface SidebarTreeProps {
  model: OrganizeModel | undefined;
  /** The view shown (resolveScope of the one chosen). */
  scope: LibraryScope;
  specials: readonly SpecialRow[];
  /** The collections are known: the snapshot and the stored open rows have both arrived. */
  settled: boolean;
  expanded: ReadonlySet<string>;
  /** The reader is showing: a row is the way back to the library, and moving the cursor changes no view. */
  reader: boolean;
  /** A row's height in px (the density). */
  rowSize: number;
  /** The sidebar's drag and drop (dnd/treeDnd.ts): handed to the Tree as it is. */
  dragAndDropHooks?: TreeProps<object>['dragAndDropHooks'];
}

interface RowContext {
  model: OrganizeModel;
  reader: boolean;
  tap: { current: TreeState<unknown> | null };
  onReaderPress(key: string): void;
  /** Drag and drop is wired: each collection row has its drag button (the keyboard's way to start a drag). */
  dnd: boolean;
}

/** Hands the tree's state (its selection manager) out of a row: the keys that move the cursor to a row that may be unmounted need it. */
function StateTap({ tap, state }: { tap: RowContext['tap']; state: TreeState<unknown> }) {
  useEffect(() => {
    tap.current = state;
  });
  return null;
}

const indent = ({ level }: { level: number }) => ({ '--indent': level - 1 }) as CSSProperties;
/** The tree's selection while a drop is being recorded (SidebarTree's parkCursor). */
const NO_KEYS: ReadonlySet<Key> = new Set();

function SpecialItem({ row, tap, reader, onReaderPress }: { row: SpecialRow; tap: RowContext['tap']; reader: boolean; onReaderPress(key: string): void }) {
  const { icon, label } = SPECIAL[row.kind];
  const key = SCOPE_KEYS[row.kind];
  return (
    <TreeItem id={key} textValue={label} className="nav-row" data-testid={`nav-scope-${row.kind}`} {...(reader ? { onPress: () => onReaderPress(key) } : {})}>
      <TreeItemContent>
        {({ state }) => (
          <>
            <StateTap tap={tap} state={state} />
            <Icon icon={icon} />
            <span className="label ellipsis">{label}</span>
            {row.count !== null && <span className="count num">{row.count}</span>}
          </>
        )}
      </TreeItemContent>
    </TreeItem>
  );
}

/**
 * The row of a collection being created: not a collection yet, so the selection handler ignores its key. It is not disabled:
 * a disabled row clears the tree's focused key when the field takes the focus, and React Aria then moves the focus back to
 * the tree, out of the field.
 */
function DraftItem() {
  return (
    <TreeItem id={DRAFT_KEY} textValue={t.organize.sidebar.newName} className="nav-row" style={indent} data-testid="draft-row">
      <TreeItemContent>
        {({ state }) => (
          <>
            <Icon icon={Folder} />
            <NameField initial={NEW_COLLECTION_NAME} rowKey={DRAFT_KEY} state={state} />
          </>
        )}
      </TreeItemContent>
    </TreeItem>
  );
}

function CollectionItem({ node, ctx }: { node: CollectionNode; ctx: RowContext }) {
  // Booleans, not the edit: the text changes with every keystroke, and no row but the edited one may render for it.
  const renaming = useSidebarEdit((s) => s.edit?.kind === 'rename' && s.edit.id === node.id);
  const draftBelow = useSidebarEdit((s) => s.edit?.kind === 'new' && s.edit.parentId === node.id);
  const count = ctx.model.count(node.id);
  const path = ctx.model.path(node.id).map((n) => n.name).join(t.organize.pathSeparator);
  return (
    <TreeItem
      id={node.id}
      textValue={node.name}
      className="nav-row"
      style={indent}
      data-testid={`nav-collection-${node.id}`}
      {...(ctx.reader ? { onPress: () => ctx.onReaderPress(node.id) } : {})}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, state }) => (
          <>
            <StateTap tap={ctx.tap} state={state} />
            {ctx.dnd && !renaming && (
              <Button slot="drag" className="drag-handle" excludeFromTabOrder data-testid={`drag-handle-${node.id}`}>
                <Icon icon={GripVertical} size="sm" />
              </Button>
            )}
            {hasChildItems && (
              <Button slot="chevron" className="disclosure">
                <Icon icon={isExpanded ? ChevronDown : ChevronRight} size="xs" />
              </Button>
            )}
            <Icon icon={isExpanded ? FolderOpen : Folder} />
            {renaming ? (
              <NameField initial={node.name} rowKey={node.id} state={state} />
            ) : (
              <span className="label ellipsis" title={path}>
                {node.name}
              </span>
            )}
            {count > 0 && !renaming && <span className="count num">{count}</span>}
          </>
        )}
      </TreeItemContent>
      {draftBelow && <DraftItem />}
      {node.children.map((child) => (
        <CollectionItem key={child.id} node={child} ctx={ctx} />
      ))}
    </TreeItem>
  );
}

/**
 * The sidebar's navigator (spec 3.2, 3.3): React Aria's Tree inside its Virtualizer, in two sections — the special views, then
 * the collections under their "컬렉션" heading. Selection is the view and follows the cursor. What React Aria does not do is
 * done by the wrapper above the tree, in the capture phase, from facts (treeKeys.ts): no type-ahead, ↩ renames, → goes to the
 * first child and ← to the parent by the model (a row may not be mounted), and the name field keeps its own keys.
 */
export function SidebarTree(props: SidebarTreeProps) {
  const { model, scope, specials, settled, expanded, reader, rowSize } = props;
  const { env, run } = useCommands();
  const editKey = useSidebarEdit((s) => (s.edit === null ? null : s.edit.kind === 'new' ? DRAFT_KEY : s.edit.id));
  const editParent = useSidebarEdit((s) => (s.edit?.kind === 'new' ? s.edit.parentId : undefined));
  const restoreTo = useSidebarEdit((s) => s.restoreTo);
  const treeRef = useRef<HTMLDivElement>(null);
  const tap = useRef<TreeState<unknown> | null>(null);
  const selectedKey = keyOfScope(scope);
  const selectedKeys = useMemo(() => new Set<Key>([selectedKey]), [selectedKey]);
  const [selectionParked, setSelectionParked] = useState(false);
  const hasCollections = settled && model !== undefined && (model.collectionCount > 0 || editParent !== undefined);
  const fit = !hasCollections;
  const layoutOptions = useMemo(() => ({ rowSize, headingSize: HEADING_HEIGHT }), [rowSize]);
  const latest = useRef({ model, expanded, selectedKey });
  latest.current = { model, expanded, selectedKey };

  const selectScope = useCallback((key: string) => useLibrary.getState().setScope(scopeOfKey(key)), []);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(expanded);
      if (!next.delete(id)) next.add(id);
      saveExpanded(next);
    },
    [expanded],
  );
  /** The cursor to a row, mounted or not: React Aria mounts it (the focused key is kept) and focuses it. */
  const focusRow = useCallback((key: string) => {
    const manager = tap.current?.selectionManager;
    if (manager) {
      manager.setFocused(true);
      manager.setFocusedKey(key);
    } else treeRef.current?.querySelector<HTMLElement>(`[role="row"][data-key="${CSS.escape(key)}"]`)?.focus();
  }, []);
  const onReaderPress = useCallback((key: string) => void (run('nav.back') && selectScope(key)), [run, selectScope]);
  const openMenu = useCallback(
    async (id: string, at: { x: number; y: number }) => {
      try {
        const picked = await unwrap(api().ui.showContextMenu({ kind: 'collection', collectionIds: [id], x: at.x, y: at.y }));
        if (picked) runPicked(picked, env, { collectionIds: [id] });
      } catch (e) {
        showToast({ kind: 'error', title: t.toast.actionFailed, body: e instanceof Error ? e.message : undefined, testId: 'action-error' });
      }
    },
    [env],
  );
  const dnd = props.dragAndDropHooks !== undefined;
  const ctx = useMemo<RowContext | null>(() => (model ? { model, reader, tap, onReaderPress, dnd } : null), [model, reader, onReaderPress, dnd]);

  // ---- keys (capture phase, before the row's own) -------------------------------------------------------------------
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const field = target instanceof HTMLInputElement && target.dataset['renameInput'] !== undefined;
    const rowEl = !field && target.matches('[role="row"][data-key]') ? target : null;
    const key = rowEl?.dataset['key'] ?? null;
    const node = key !== null ? model?.node(key) : undefined;
    // ⌥→ on a collection row: its drag button, where a keyboard drag starts. The plain → opens a row that has children or enters
    // one that has none, so a collection with children would have no way to its button.
    if (dnd && rowEl && key !== null && model?.node(key) && e.key === 'ArrowRight' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      rowEl.querySelector<HTMLElement>('button[slot="drag"]')?.focus();
      return;
    }
    const action = treeKeyAction({
      key: e.key,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      composing: e.nativeEvent.isComposing || e.keyCode === 229,
      target: field ? 'rename' : rowEl ? 'row' : 'other',
      contextMenuKey: isContextMenuKey(e),
      reader,
      row:
        key === null
          ? null
          : { key, collection: node !== undefined, expanded: expanded.has(key), hasChildren: (node?.children.length ?? 0) > 0, firstChild: node?.children[0]?.id ?? null, parent: node?.parentId ?? null },
    });
    if (action.do === 'none') return;
    e.stopPropagation();
    if (action.do === 'swallow' || action.do === 'block') return; // kept from the row; the browser's default (typing) stays
    e.preventDefault();
    switch (action.do) {
      case 'commit':
        void collectionActions.finish((target as HTMLInputElement).value, 'enter');
        break;
      case 'cancel':
        collectionActions.cancel();
        break;
      case 'rename':
        collectionActions.startRename(action.key);
        break;
      case 'menu':
        if (!reader) selectScope(action.key);
        void openMenu(action.key, menuPointFor(rowEl!));
        break;
      case 'goto':
        selectScope(action.key);
        focusRow(action.key);
        break;
      case 'ignoreMenu':
        break;
    }
  };

  // Only a collection row is a drag source: a special view, the draft row and the row being named are not (a prevented
  // dragstart is not started by React Aria).
  const onDragStartCapture = (e: DragEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[role="row"][data-key]')?.dataset['key'];
    if (key !== undefined && (!model?.node(key) || inertRow(key, editKey))) e.preventDefault();
  };

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input')) return; // the field keeps the browser's own
    const key = target.closest<HTMLElement>('[role="row"][data-key]')?.dataset['key'];
    if (key === undefined) return;
    e.preventDefault();
    if (!model?.node(key)) return; // a special view has no menu (spec 9.2)
    if (!reader) selectScope(key); // a right click selects first (design-spec 7.1)
    void openMenu(key, { x: e.clientX, y: e.clientY });
  };

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.disclosure, input')) return;
    const key = target.closest<HTMLElement>('[role="row"][data-key]')?.dataset['key'];
    if (key !== undefined && (model?.node(key)?.children.length ?? 0) > 0) toggle(key);
  };

  /**
   * A pointer is down on a chevron: it folds or unfolds and nothing else — the row it takes the focus to is not the view. When
   * the button goes up (a task later, after React Aria's own press handling) the tree's cursor goes back to the viewed row, so
   * that Tab into the tree lands there and not on the row whose chevron was pressed.
   */
  const chevronDown = useRef(false);
  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.disclosure') === null) return;
    chevronDown.current = true;
    const up = () => {
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.setTimeout(() => {
        chevronDown.current = false;
        if (!reader) tap.current?.selectionManager.setFocusedKey(latest.current.selectedKey);
      }, 0);
    };
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  };

  /**
   * A drop on a row is coming, and React Aria is about to record the tree's cursor and selection (useDroppableCollection). After the
   * drop it moves the cursor to the dropped-on row, with the keyboard modality, while it finds the cursor where it was; and it selects
   * the rows that appeared meanwhile (a special view such as 미분류 after Finder's file onto 내 라이브러리) while it finds the selection
   * as it was — on each render that changed the rows, until its timer ends the wait. So the cursor, and with `selection` the
   * selection (a prop, so drawn at once), are off for the moment it records them, and back on the viewed row as soon as the drop is
   * handed over (dragState.parkCursor): React Aria finds them changed and leaves them, however late its moves come — no ring after a
   * drop by mouse, no change of view — and only gives the tree the focus, on the viewed row.
   */
  const park = useCallback((selection: boolean) => {
    const manager = tap.current?.selectionManager;
    if (!manager) return;
    manager.setFocusedKey(null);
    if (selection) flushSync(() => setSelectionParked(true));
    dragState.parkCursor(() => {
      if (selection) setSelectionParked(false);
      manager.setFocusedKey(latest.current.selectedKey);
    });
  }, []);
  /**
   * A drop by the native drop event — the app's own mouse drags and Finder's files — in its capture phase, before the tree's handler
   * records it, when a row is the target (React Aria marks the row it will record; for Finder's files the drag's hover bookkeeping
   * is reset by every dragover, so the mark is what tells).
   */
  const onDropCapture = () => {
    if (treeRef.current?.querySelector('[role="row"][data-key][data-drop-target]')) park(true);
  };
  // A drop by keyboard has no drop event: React Aria's DragManager drops when ↩ is released, or on a screen reader's click (a click
  // with no pointer), in the document's capture phase — the window's comes first, and says a drop may come (the cursor is parked
  // when React Aria asks the tree for its operation, dragState.expectKeyboardDrop). ⌥↩ and the row's hidden expand button (a role
  // button that is not a drop indicator) open the row instead. The selection stays: a keyboard drop moves collections or adds
  // items to one, so no special view can appear.
  useEffect(() => {
    const virtualDrag = props.dragAndDropHooks?.isVirtualDragging;
    if (!virtualDrag) return;
    const expandButton = (target: EventTarget | null) => target instanceof Element && target.closest('[role="button"]:not([aria-roledescription])') !== null;
    const parkNow = () => park(false);
    let pointerless = false; // the last pointerdown had no size: a screen reader's (React Aria's isVirtualPointerEvent)
    const onPointerDown = (e: globalThis.PointerEvent) => void (pointerless = e.width === 0 && e.height === 0);
    const onKeyUp = (e: globalThis.KeyboardEvent) => {
      dragState.expectKeyboardDrop(e.key === 'Enter' && !e.altKey && virtualDrag() && !expandButton(e.target) ? parkNow : null);
    };
    const onClick = (e: globalThis.MouseEvent) => {
      const pointerType = (e as Partial<globalThis.PointerEvent>).pointerType;
      const virtualClick = (pointerType === '' && e.isTrusted) || (e.detail === 0 && !pointerType) || pointerless; // React Aria's isVirtualClick
      const inTree = treeRef.current?.contains(e.target as Node) ?? false;
      dragState.expectKeyboardDrop(virtualClick && virtualDrag() && inTree && !expandButton(e.target) ? parkNow : null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [props.dragAndDropHooks, park]);

  /** Selection follows the cursor, whichever key moved it (React Aria's ← to the parent moves only the focus). */
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (reader || chevronDown.current) return;
    const el = e.target as HTMLElement;
    if (!el.matches('[role="row"][data-key]')) return;
    const key = el.dataset['key']!;
    const dropFocus = dragState.takeDropFocus(key);
    if (dropFocus) {
      // React Aria moved the focus to the row that was dropped on (a drop whose cursor was not parked above): the view stays where
      // it was, and so does the cursor. After a mouse drop the cursor goes back quietly — React Aria set the keyboard modality for
      // its own move, which would scroll the tree to the cursor and draw a keyboard ring on it.
      if (dropFocus.pointer) document.dispatchEvent(new window.PointerEvent('pointermove'));
      if (key !== selectedKey) tap.current?.selectionManager.setFocusedKey(selectedKey);
      return;
    }
    if (key !== DRAFT_KEY && key !== selectedKey) selectScope(key);
  };

  /** Folding hides the rows below: when the viewed one is among them, the view moves to the collection that was folded. */
  const onExpandedChange = (keys: Set<Key>) => {
    const next = new Set([...keys].map(String));
    const { model: m } = latest.current;
    if (!reader && m && scope.kind === 'collection') {
      const hiding = ancestorIds(m, scope.id).find((id) => expanded.has(id) && !next.has(id));
      if (hiding !== undefined) selectScope(hiding);
    }
    saveExpanded(next);
  };

  const onSelectionChange = (selection: Selection) => {
    if (reader || selection === 'all' || chevronDown.current) return;
    const key = [...selection][0];
    if (key !== undefined && String(key) !== DRAFT_KEY) selectScope(String(key));
  };

  // ---- effects --------------------------------------------------------------------------------------------------------
  // The keyboard cursor follows the view when something else moved it (an item panel path, the palette): tabbing into the
  // tree then lands on the view's row and does not move the view to where the cursor was.
  useEffect(() => {
    if (!reader) tap.current?.selectionManager.setFocusedKey(selectedKey);
  }, [selectedKey, reader]);

  // A view inside a closed collection opens the way to its row — when the view changes, not whenever the user folds a parent.
  useEffect(() => {
    const { model: m, expanded: open } = latest.current;
    if (scope.kind !== 'collection' || !m) return;
    const closed = ancestorIds(m, scope.id).filter((id) => !open.has(id));
    if (closed.length > 0) addExpanded(closed);
  }, [selectedKey]); // the latest model and open rows are read on purpose: only a change of view opens the way

  // The row being named is brought into view (once per edit); the virtualizer then mounts it and its field takes the focus.
  const revealed = useRef<string | null>(null);
  /** The scroll that reveals the row is ours: only the user's scrolling can take the field out of sight. */
  const ownScroll = useRef(false);
  useEffect(() => {
    const tree = treeRef.current;
    if (editKey === null) {
      revealed.current = null;
      return;
    }
    const signature = `${editKey}|${editParent ?? ''}`;
    if (!tree || !model || revealed.current === signature) return;
    const index = visibleCollectionKeys(model, expanded, editParent).indexOf(editKey);
    if (index < 0) return;
    revealed.current = signature;
    const top = specials.length * rowSize + HEADING_HEIGHT + index * rowSize;
    if (top < tree.scrollTop || top + rowSize > tree.scrollTop + tree.clientHeight) {
      ownScroll.current = true;
      requestAnimationFrame(() => void (ownScroll.current = false));
      tree.scrollTop = Math.max(0, Math.round(top - (tree.clientHeight - rowSize) / 2));
    }
  }, [editKey, editParent, model, expanded, specials.length, rowSize]);

  // A row that scrolled out of the virtual window takes its field along: the edit ends with the text typed so far.
  useEffect(() => {
    const tree = treeRef.current;
    if (editKey === null || !tree) return;
    let seen = tree.querySelector('[data-rename-input]') !== null;
    let frame = 0;
    const check = () => {
      frame = 0;
      const s = useSidebarEdit.getState();
      if (!s.edit || s.busy) return;
      const input = tree.querySelector('[data-rename-input]');
      if (input) seen = true;
      // React Aria keeps the row that has the focus mounted wherever it scrolls to: the field counts as gone when it is out of sight.
      const out = input ? input.getBoundingClientRect() : null;
      const box = tree.getBoundingClientRect();
      if ((input === null && seen) || (out !== null && (out.bottom <= box.top || out.top >= box.bottom))) void collectionActions.finish(s.edit.text, 'scroll');
    };
    const onScroll = () => {
      if (ownScroll.current) return;
      if (frame === 0) frame = requestAnimationFrame(check);
    };
    tree.addEventListener('scroll', onScroll);
    return () => {
      tree.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [editKey]);

  // An edit that ended with no focus to give back (a click elsewhere, a scroll) leaves no blur for the tree: when the focus
  // is not in it, it must not go on believing it has it.
  const hadEdit = useRef(false);
  useEffect(() => {
    if (editKey !== null) {
      hadEdit.current = true;
      return;
    }
    if (!hadEdit.current) return;
    hadEdit.current = false;
    if (useSidebarEdit.getState().restoreTo === null && !treeRef.current?.contains(document.activeElement)) tap.current?.selectionManager.setFocused(false);
  }, [editKey]);

  // After an edit the focus goes back to where it was (the table, say); from inside the tree, to the cursor row.
  useEffect(() => {
    if (restoreTo === null) return;
    useSidebarEdit.getState().clearRestore();
    const tree = treeRef.current;
    const opener = restoreTo.opener;
    if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body && !tree?.contains(opener)) {
      // The field left with the focus in it, so no blur told the tree: it must not go on believing it has the focus.
      tap.current?.selectionManager.setFocused(false);
      opener.focus({ preventScroll: true });
      return;
    }
    // From inside the tree the focus goes to the row it was on: the cursor row, or the view's.
    const openerKey = opener instanceof HTMLElement ? opener.closest<HTMLElement>('[role="row"][data-key]')?.dataset['key'] : undefined;
    const key = openerKey && openerKey !== DRAFT_KEY ? openerKey : (tap.current?.selectionManager.focusedKey?.toString() ?? latest.current.selectedKey);
    const row = tree?.querySelector<HTMLElement>(`[role="row"][data-key="${CSS.escape(key)}"]`);
    if (row) row.focus({ preventScroll: true });
    else if (tree) focusRow(key);
  }, [restoreTo, focusRow]);

  return (
    <div className="sidebar-body" onPointerDownCapture={onPointerDownCapture} onKeyDownCapture={onKeyDownCapture} onDragStartCapture={onDragStartCapture} onDropCapture={onDropCapture} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} onFocus={onFocus}>
      <div className="section-label" aria-hidden="true">
        {t.shell.libraryHeading}
      </div>
      <Virtualizer layout={TreeSectionsLayout} layoutOptions={layoutOptions}>
        <Tree
          ref={treeRef}
          aria-label={t.organize.sidebar.tree}
          className="nav-list sidebar-tree"
          data-testid="sidebar-tree"
          data-fit={fit || undefined}
          style={fit ? { height: specials.length * rowSize } : undefined}
          selectionMode="single"
          selectionBehavior="replace"
          disallowEmptySelection
          selectedKeys={selectionParked ? NO_KEYS : selectedKeys}
          onSelectionChange={onSelectionChange}
          expandedKeys={expanded}
          onExpandedChange={onExpandedChange}
          dragAndDropHooks={props.dragAndDropHooks}
        >
          <TreeSection aria-label={t.shell.libraryHeading}>
            {specials.map((row) => (
              <SpecialItem key={row.kind} row={row} tap={tap} reader={reader} onReaderPress={onReaderPress} />
            ))}
          </TreeSection>
          {hasCollections && ctx && model && (
            <TreeSection aria-label={t.organize.sidebar.collections}>
              <TreeHeader className="section-label tree-heading">
                <CollectionsHeading dropRoot={dnd} />
              </TreeHeader>
              {editParent === null && <DraftItem />}
              {model.roots.map((node) => (
                <CollectionItem key={node.id} node={node} ctx={ctx} />
              ))}
            </TreeSection>
          )}
        </Tree>
      </Virtualizer>
      {fit && settled && (
        <>
          <div className="section-label">
            <CollectionsHeading />
          </div>
          <div className="sidebar-empty-hint" data-testid="sidebar-hint">
            {t.organize.sidebar.emptyHint}
          </div>
        </>
      )}
    </div>
  );
}
