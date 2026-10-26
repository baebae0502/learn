// M5 Task 1 drag-and-drop spike (branch m5-spike only, never merged): the real LibraryTable with 10,000 synthetic rows
// next to a RAC Tree of 200 collections, tag chips, and the window's Finder-file overlay, in one renderer-only page
// (?window=spike). Options: &typeahead=on (leave Tree's type-ahead on), &asMac=1 (RAC thinks it runs on macOS, so ⌘ = move),
// &nopin=1 is not needed (the test toggles __dnd.pin).
import { flushSync } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Button, ListLayout, Tree, Virtualizer, TreeItem, TreeItemContent, isFileDropItem, useDrag, useDragAndDrop, useDrop,
  type DropTarget, type Key, type TextDropItem,
} from 'react-aria-components';
import { ChevronRight, Folder } from 'lucide-react';
import { keyCommand, isEditing } from '../commands/keymap';
import { LibraryTable } from '../library/LibraryTable';
import { inOrder, rowOrder } from '../library/selectionModel';
import { defaultColumns } from '../library/columns';
import { DEFAULT_SORT } from '../library/sort';
import { windowDropTarget } from '../shell/drop';
import { useLibrary } from '../state/library-store';
import { afterPaint } from '../ui/afterPaint';
import { Icon } from '../ui/Icon';
import { bridge } from './bridge';
import { MIME_COLLECTION, MIME_ITEMS, MIME_TAG, descendantIds, makeCollections, makeItems, type CollectionNode } from './data';
import type { LibraryItem } from '@learn/domain';

const Q = new URLSearchParams(location.search);

const TOTAL = Number(Q.get('rows') ?? 10_000);
const { roots, byId } = makeCollections(200);
const ITEMS = makeItems(TOTAL);
const TAGS = [
  { id: 't1', name: '시험' },
  { id: 't2', name: '읽을 것' },
];
const SPRING_MS = 700;
/** &virtual=1: the Tree inside RAC's Virtualizer (ListLayout, 28 px rows). */
const VIRTUAL = Q.get('virtual') === '1';
/** &chipdrag=virtual leaves useDrag's default pointer handling on the chips (CDP's synthetic pointer looks virtual to RAC). */
const CHIP_BUTTON = Q.get('chipdrag') !== 'virtual';
/** &rename=raw: the rename <input> is left to its own handlers; default 'own': a capture handler above the Tree owns its keys. */
const RENAME = Q.get('rename') ?? 'own';
/** &sweep=1: when any drag ends, a dragleave is sent to rows RAC still marks as drop targets (Playwright's Esc sends no dragleave). */
const SWEEP = Q.get('sweep') === '1';
/** Spring-loading: RAC's own (800 ms, Tree.onDropActivate) by default; &spring=own adds our 700 ms timer. */
const SPRING = Q.get('spring') ?? 'native';
/** Type-ahead: 'on' leaves RAC's; 'prop' passes the untyped disallowTypeAhead through Tree; 'wrap' (default) stops printable keys above the Tree. */
const TYPEAHEAD = Q.get('typeahead') ?? 'wrap';
let lastEffect = '';
let dropStart = 0;
const mc = new MessageChannel();

const isDescendantOrSelf = (key: string, ancestor: string | null): boolean => ancestor !== null && (key === ancestor || descendantIds(byId.get(ancestor)!).includes(key));

function Chip({ id, name }: { id: string; name: string }) {
  const { dragProps, isDragging } = useDrag({
    hasDragButton: CHIP_BUTTON,
    getItems: () => [{ [MIME_TAG]: JSON.stringify({ tagId: id }), 'text/plain': name }],
    getAllowedDropOperations: () => ['copy'],
    onDragStart: () => bridge.setTagDragging(true),
    onDragEnd: () => bridge.setTagDragging(false),
  });
  return (
    <span {...dragProps} role="button" tabIndex={0} className="dnd-chip" data-testid={`chip-${id}`} data-dragging={isDragging || undefined}>
      {name}
    </span>
  );
}

/** "컬렉션" section header: dropping a collection on it moves it to the root. */
function RootHeader({ onRoot }: { onRoot(collectionId: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { dropProps, isDropTarget } = useDrop({
    ref,
    getDropOperation: (types) => (types.has(MIME_COLLECTION) ? 'move' : 'cancel'),
    onDrop: async (e) => {
      const item = e.items.find((i): i is TextDropItem => i.kind === 'text' && i.types.has(MIME_COLLECTION));
      if (!item) return;
      onRoot((JSON.parse(await item.getText(MIME_COLLECTION)) as { collectionId: string }).collectionId);
    },
  });
  return (
    <div ref={ref} {...dropProps} className="section-label dnd-root-header" data-testid="tree-header" data-drop-target={isDropTarget || undefined}>
      컬렉션
    </div>
  );
}

function Node({ node, editing, onEdit, onToggle }: { node: CollectionNode; editing: string | null; onEdit(id: string | null): void; onToggle(id: string): void }) {
  return (
    <TreeItem
      id={node.id}
      textValue={node.name}
      className="nav-row dnd-row"
      style={({ level }) => ({ '--indent': level - 1 }) as CSSProperties}
      data-testid={`coll-${node.id}`}
      // ↩ is an action in RAC (and so is a double click in 'replace' behaviour): tell them apart by the key that just went down.
      onAction={() => {
        const byKey = performance.now() - bridge.lastEnterAt < 150 && !bridge.lastEnterAlt;
        bridge.log.push(`action ${node.id} by=${byKey ? 'enter' : 'mouse'}`);
        bridge.actions.push({ id: node.id, by: byKey ? 'enter' : 'mouse' });
        if (byKey) onEdit(node.id);
      }}
      onDoubleClick={() => onToggle(node.id)}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, id }) => (
          <>
            <Button slot="chevron" className="dnd-chevron" data-has-children={hasChildItems || undefined} data-expanded={isExpanded || undefined}>
              {hasChildItems ? <Icon icon={ChevronRight} size="xs" /> : null}
            </Button>
            <Button slot="drag" className="dnd-draghandle" excludeFromTabOrder>
              ≡
            </Button>
            <Icon icon={Folder} />
            {editing === node.id ? (
              <input
                className="dnd-rename"
                data-testid="rename-input"
                autoFocus
                defaultValue={node.name}
                onBlur={() => onEdit(null)}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  bridge.log.push(`input keydown ${e.key} composing=${e.nativeEvent.isComposing}`);
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    if (!e.nativeEvent.isComposing) onEdit(null);
                  }
                }}
              />
            ) : (
              <span className="label ellipsis" data-testid={`coll-label-${String(id)}`}>
                {node.name}
              </span>
            )}
            <span className="count num">{node.children.length || ''}</span>
          </>
        )}
      </TreeItemContent>
      {node.children.map((c) => (
        <Node key={c.id} node={c} editing={editing} onEdit={onEdit} onToggle={onToggle} />
      ))}
    </TreeItem>
  );
}

export function DndSpike() {
  // ---- table ----------------------------------------------------------------------------------------------------
  const [rows, setRows] = useState<readonly LibraryItem[]>(ITEMS);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const order = useMemo(() => rowOrder(rows.map((r) => r.id)), [rows]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const columns = useMemo(defaultColumns, []);
  const [sort, setSort] = useState(DEFAULT_SORT);

  // ---- collections ------------------------------------------------------------------------------------------------
  const [parents, setParents] = useState<ReadonlyMap<string, string | null>>(() => new Map([...byId].map(([id, n]) => [id, n.parentId])));
  const parentsRef = useRef(parents);
  parentsRef.current = parents;
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(() => new Set(['c000']));
  const [selected, setSelected] = useState<ReadonlySet<Key>>(() => new Set(['c000']));
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [editing, setEditing] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [filesDrops, setFilesDrops] = useState<Array<{ target: string; names: string[] }>>([]);
  const spring = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const [treeKey, setTreeKey] = useState(0);
  const timing = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const f = timing.current;
    timing.current = null;
    f?.();
  }, [treeKey, expanded]);
  const toggle = useCallback((id: string) => {
    if (byId.get(id)!.children.length === 0) return;
    setExpanded((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const isUnder = useCallback((key: string, ancestor: string): boolean => {
    for (let at: string | null | undefined = parentsRef.current.get(key); at; at = parentsRef.current.get(at)) if (at === ancestor) return true;
    return false;
  }, []);
  const moveCollection = useCallback((id: string, to: string | null) => setParents((p) => new Map(p).set(id, to)), []);

  // Row-dragging bridge: the ids a drag of `rowId` carries (the selection in table order if the row is in it, else the row).
  useEffect(() => {
    bridge.dragItems = (rowId) => {
      const sel = useLibrary.getState().selected;
      return sel.has(rowId) ? inOrder(sel, orderRef.current) : [rowId];
    };
    (window as unknown as { __titleOf: (id: string) => string }).__titleOf = (id) => rowsRef.current.find((r) => r.id === id)?.title ?? id;
  }, []);

  const { dragAndDropHooks } = useDragAndDrop({
    // ---- source: a collection row
    getItems: (keys) => [...keys].map((k) => ({ [MIME_COLLECTION]: JSON.stringify({ collectionId: String(k) }), 'text/plain': byId.get(String(k))!.name })),
    getAllowedDropOperations: () => ['move'],
    onDragStart: (e) => void (bridge.draggingCollectionId = String([...e.keys][0])),
    onDragEnd: (e) => {
      bridge.ends.push({ at: performance.now(), op: `tree:${e.dropOperation}` });
      bridge.draggingCollectionId = null;
    },
    // ---- target: "on" a row only
    acceptedDragTypes: 'all',
    getDropOperation: (target: DropTarget, types, allowed) => {
      if (target.type !== 'item' || target.dropPosition !== 'on') return 'cancel';
      const key = String(target.key);
      if (types.has(MIME_COLLECTION) && !types.has(MIME_ITEMS)) {
        const dragged = bridge.draggingCollectionId;
        if (dragged === null) return 'cancel';
        if (key === dragged || isUnder(key, dragged) || parentsRef.current.get(dragged) === key) return 'cancel';
        return 'move';
      }
      if (types.has(MIME_ITEMS)) {
        if (key === [...selectedRef.current][0]) return 'cancel'; // the collection being viewed
        return allowed.length === 1 && allowed[0] === 'move' ? 'move' : 'copy';
      }
      return allowed.includes('copy') ? 'copy' : 'cancel'; // Finder files
    },
    onDropEnter: (e) => {
      bridge.log.push(`dropenter ${e.target.type === 'item' ? String(e.target.key) : e.target.type}`);
      if (e.target.type !== 'item') return;
      const key = String(e.target.key);
      clearTimeout(spring.current?.timer);
      spring.current = null;
      if (SPRING !== 'own' || byId.get(key)!.children.length === 0) return;
      const timer = setTimeout(() => {
        bridge.log.push(`spring ${key} ${performance.now()}`);
        setExpanded((s) => (s.has(key) ? s : new Set(s).add(key)));
      }, SPRING_MS);
      spring.current = { key, timer };
    },
    onDropExit: () => {
      clearTimeout(spring.current?.timer);
      spring.current = null;
    },
    onItemDrop: async (e) => {
      const t0 = dropStart;
      const key = String(e.target.key);
      const first = e.items[0];
      const handlerAt = performance.now();
      const rec = { target: key, operation: e.dropOperation, ids: [] as string[], meta: bridge.lastMeta, shift: bridge.lastShift, effect: lastEffect, at: handlerAt };
      if (first && first.kind === 'text' && first.types.has(MIME_COLLECTION)) {
        const { collectionId } = JSON.parse(await first.getText(MIME_COLLECTION)) as { collectionId: string };
        rec.ids = [collectionId];
        moveCollection(collectionId, key);
      } else if (first && first.kind === 'text' && first.types.has(MIME_ITEMS)) {
        rec.ids = (JSON.parse(await first.getText(MIME_ITEMS)) as { itemIds: string[] }).itemIds;
      } else {
        const names = e.items.filter(isFileDropItem).map((f) => f.name);
        rec.ids = names;
        setFilesDrops((d) => [...d, { target: key, names }]);
      }
      bridge.drops.push(rec);
      bridge.dropMs.push(handlerAt - t0);
    },
    renderDropIndicator: () => <span hidden data-testid="between-indicator" />,
  });

  // Window drop overlay for Finder files, restricted to the area right of the sidebar.
  useEffect(() => {
    const target = windowDropTarget({
      show: (s) => setOverlay(s !== null),
      entered: () => {},
      drop: (paths, mode) => bridge.log.push(`overlay drop ${mode} ${paths.length}`),
      pathForFile: () => '',
    });
    const inSide = (e: DragEvent) => e.target instanceof Element && e.target.closest('[data-sidebar]') !== null;
    const enter = (e: DragEvent) => (inSide(e) ? target.reset() : target.enter(e));
    const over = (e: DragEvent) => (inSide(e) ? target.reset() : target.over(e));
    const leave = (e: DragEvent) => target.leave(e);
    const drop = (e: DragEvent) => (inSide(e) ? target.reset() : target.drop(e));
    addEventListener('dragenter', enter);
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
    };
  }, []);

  // The drop event's dropEffect as the page sees it (window capture, before RAC's handlers).
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      lastEffect = e.dataTransfer?.dropEffect ?? '';
      dropStart = performance.now();
      bridge.dropStart = dropStart;
      bridge.dropTypes = [...(e.dataTransfer?.types ?? [])];
      bridge.dropPayload = e.dataTransfer?.getData('application/x-learn-items+json') ?? '';
    };
    const onEnd = () => void bridge.nativeDragends++;
    const timeOver = (e: DragEvent) => {
      const t0 = performance.now();
      const onRow = e.target instanceof Element && e.target.closest('[data-testid="item-row"]') !== null;
      mc.port1.onmessage = () => void (onRow ? bridge.overMs : bridge.overOtherMs).push(performance.now() - t0);
      mc.port2.postMessage(0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      bridge.lastEnterAt = performance.now();
      bridge.lastEnterAlt = e.altKey;
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('dragend', onEnd, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('dragover', timeOver, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('dragend', onEnd, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('dragover', timeOver, true);
    };
  }, []);

  // &autoscroll=own: our 24 px edge band for the tree (RAC's is a fixed 20 px).
  useEffect(() => {
    if (Q.get('autoscroll') !== 'own') return;
    const el = () => document.querySelector<HTMLElement>('[data-testid="tree"]');
    let dir = 0;
    let raf = 0;
    let lastOver = 0;
    const loop = () => {
      const t = el();
      raf = 0;
      if (!t || dir === 0 || performance.now() - lastOver > 600) return;
      t.scrollTop += dir * 8;
      raf = requestAnimationFrame(loop);
    };
    const over = (e: DragEvent) => {
      const t = el();
      const target = e.target as Node | null;
      if (!t || !target || !t.contains(target)) return void (dir = 0);
      const r = t.getBoundingClientRect();
      dir = e.clientY - r.top < 24 ? -1 : r.bottom - e.clientY < 24 ? 1 : 0;
      lastOver = performance.now();
      if (bridge.log.length < 400) bridge.log.push(`over y=${Math.round(e.clientY)} top=${Math.round(r.top)} bottom=${Math.round(r.bottom)} dir=${dir} st=${Math.round(t.scrollTop)} sh=${t.scrollHeight} ch=${t.clientHeight}`);
      if (dir !== 0 && raf === 0) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('dragover', over, true);
    return () => window.removeEventListener('dragover', over, true);
  }, []);

  useEffect(() => {
    if (!SWEEP) return;
    const sweep = () => {
      // useDrop counts the elements the drag entered and exits when each has left: tell every element in the marked collection.
      const scopes = new Set([...document.querySelectorAll('[data-drop-target]')].map((el) => el.closest('[role="treegrid"]') ?? el));
      for (const scope of scopes) for (const el of [scope, ...scope.querySelectorAll('*')]) el.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
    };
    window.addEventListener('dragend', sweep, true);
    return () => window.removeEventListener('dragend', sweep, true);
  }, []);

  // Stand-in for the window keymap: the real keyCommand, with the rule Task 8 adds — nothing runs while a drag is on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = keyCommand(e, isEditing(e.target));
      if (id === null) return;
      if (bridge.dragging) bridge.keymap.blocked++;
      else bridge.keymap.fired++;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ---- test window ---------------------------------------------------------------------------------------------
  useEffect(() => {
    const scroller = () => document.querySelector<HTMLElement>('[data-testid="library-table"]')!;
    bridge.api = {
      selectRange: ((from: number, count: number) => useLibrary.getState().setSelected(rowsRef.current.slice(from, from + count).map((r) => r.id))) as never,
      scrollTable: ((top: number) => void (scroller().scrollTop = top)) as never,
      removeItem: ((id: string) => setRows((r) => r.filter((x) => x.id !== id))) as never,
      refetch: (() => setRows((r) => r.map((x) => ({ ...x })))) as never,
      startRename: ((id: string) => setEditing(id)) as never,
      expanded: (() => [...expanded]) as never,
      selected: (() => [...selectedRef.current]) as never,
      parentOf: ((id: string) => parentsRef.current.get(id) ?? null) as never,
      filesDrops: (() => filesDropsRef.current) as never,
      treeFocus: (() => document.activeElement?.closest('[data-key]')?.getAttribute('data-key') ?? null) as never,
      setExpanded: ((keys: string[]) => setExpanded(new Set(keys))) as never,
      expandAll: (() => setExpanded(new Set(byId.keys()))) as never,
      remountTree: (() => setTreeKey((k) => k + 1)) as never,
      selectionSize: (() => useLibrary.getState().selected.size) as never,
      timeRemount: (() =>
        new Promise<number>((res) => {
          const t0 = performance.now();
          timing.current = () => afterPaint(() => res(performance.now() - t0));
          setTreeKey((k) => k + 1);
        })) as never,
      timeToggleOne: ((id: string) =>
        new Promise<number>((res) => {
          const t0 = performance.now();
          timing.current = () => afterPaint(() => res(performance.now() - t0));
          toggle(id);
        })) as never,
      syncRender: ((kind: string) => {
        const t0 = performance.now();
        flushSync(() => (kind === 'expandAll' ? setExpanded(new Set(byId.keys())) : kind === 'collapse' ? setExpanded(new Set(['c000'])) : setTreeKey((k) => k + 1)));
        return performance.now() - t0;
      }) as never,
      timeExpandAll: (() =>
        new Promise<number>((res) => {
          const t0 = performance.now();
          timing.current = () => afterPaint(() => res(performance.now() - t0));
          setExpanded(new Set(byId.keys()));
        })) as never,
      editing: (() => editingRef.current) as never,
    };
  });
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const filesDropsRef = useRef(filesDrops);
  filesDropsRef.current = filesDrops;

  return (
    <div className="dnd-spike">
      <aside
        className="dnd-sidebar"
        data-sidebar=""
        data-testid="sidebar"
        onKeyDownCapture={(e) => {
          const target = e.target as HTMLElement;
          // The rename <input> inside a row: RAC's row handles arrows, Home/End and Space in the capture phase (it would move
          // the focus out and unmount the input), so what the input needs is decided here, above the Tree.
          if (RENAME === 'own' && target instanceof HTMLInputElement && target.dataset['testid'] === 'rename-input') {
            if ((e.key === 'Enter' || e.key === 'Escape') && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) setEditing(null);
            e.stopPropagation();
            return;
          }
          const row = target.closest<HTMLElement>('[role="row"][data-key]');
          if (e.target !== row || row === null || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
          // Letters, digits and punctuation on a tree row are not type-ahead; Space, arrows, Enter, Home/End are kept.
          if (TYPEAHEAD === 'wrap' && e.key.length === 1 && e.key !== ' ') return void e.stopPropagation();
          // → on an expanded row goes to its first child (RAC only expands).
          if (e.key === 'ArrowRight' && row.getAttribute('aria-expanded') === 'true') {
            const next = row.nextElementSibling as HTMLElement | null;
            if (next && Number(next.getAttribute('aria-level')) > Number(row.getAttribute('aria-level'))) {
              e.preventDefault();
              e.stopPropagation();
              next.focus();
            }
          }
        }}
        // Selection follows focus, whichever key moved it (RAC's ← to the parent moves focus only).
        onFocus={(e) => {
          const row = e.target as HTMLElement;
          if (row.getAttribute('role') === 'row' && row.dataset['key'] !== undefined) setSelected((cur) => (cur.size === 1 && cur.has(row.dataset['key']!) ? cur : new Set([row.dataset['key']!])));
        }}
      >
        <RootHeader onRoot={(id) => moveCollection(id, null)} />
        {VIRTUAL ? (
          <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 28 }}>
            <Tree
              key={treeKey}
              ref={treeRef}
              aria-label="컬렉션"
              className="dnd-tree nav-list"
              data-testid="tree"
              selectionMode="single"
              selectionBehavior="replace"
              disallowEmptySelection
              {...(TYPEAHEAD === 'prop' ? ({ disallowTypeAhead: true } as object) : {})}
              selectedKeys={selected}
              onSelectionChange={(keys) => keys !== 'all' && setSelected(new Set(keys))}
              expandedKeys={expanded}
              onExpandedChange={(keys) => setExpanded(new Set(keys))}
              dragAndDropHooks={dragAndDropHooks}
            >
              {roots.map((n) => (
                <Node key={n.id} node={n} editing={editing} onEdit={setEditing} onToggle={toggle} />
              ))}
            </Tree>
          </Virtualizer>
        ) : (
          <Tree
            key={treeKey}
            ref={treeRef}
            aria-label="컬렉션"
            className="dnd-tree nav-list"
            data-testid="tree"
            selectionMode="single"
            selectionBehavior="replace"
            disallowEmptySelection
            {...(TYPEAHEAD === 'prop' ? ({ disallowTypeAhead: true } as object) : {})}
            selectedKeys={selected}
            onSelectionChange={(keys) => keys !== 'all' && setSelected(new Set(keys))}
            expandedKeys={expanded}
            onExpandedChange={(keys) => setExpanded(new Set(keys))}
            dragAndDropHooks={dragAndDropHooks}
          >
            {roots.map((n) => (
              <Node key={n.id} node={n} editing={editing} onEdit={setEditing} onToggle={toggle} />
            ))}
          </Tree>
        )}
        <div className="dnd-tags">
          {TAGS.map((t) => (
            <Chip key={t.id} id={t.id} name={t.name} />
          ))}
        </div>
      </aside>
      <main className="dnd-main" data-testid="main">
        <LibraryTable rows={rows} columns={columns} sort={sort} onSortChange={setSort} onColumnsChange={() => {}} onOpen={() => {}} onContextMenu={() => {}} />
        {overlay && (
          <div className="dnd-overlay" data-testid="drop-overlay">
            파일 놓기
          </div>
        )}
      </main>
    </div>
  );
}

