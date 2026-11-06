import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Clapperboard, FileText, LibraryBig, X } from 'lucide-react';
import { acceleratorLabel, commandById, commandLabel, type CommandId } from '@learn/domain';
import { unwrap, api } from '../api';
import { useCommands } from '../commands/CommandProvider';
import { runPicked } from '../commands/registry';
import { useItem, useItems } from '../data/queries';
import { currentPlatform } from '../ui/platform';
import { showToast } from '../ui/toasts';
import { useTabReorder } from './useTabReorder';
import { readerWindowTitle } from '../viewers/readerTitle';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { cx } from '../ui/cx';
import { Icon } from '../ui/Icon';
import { SidebarToggle } from './SidebarToggle';
import { useSidebarHidden } from './useSidebar';

/** What the next tab beyond the strip's edge shows of itself when the active one is scrolled into view. */
const EDGE = 24;

/**
 * The tab strip (spec 3.2): the content column's top 52 px while a reader tab exists. The library tab is pinned at the start
 * and the reader tabs scroll in their own box, which is as tall as the strip so the active tab's ring and shadow are not cut.
 * One tab list for the arrow keys across both parts; a tab is chosen with ↩ or space (a focused tab is not yet a chosen one).
 */
export function TabBar({ trailing }: { trailing: ReactNode }) {
  const tabs = useShell((s) => s.tabs);
  const selectTab = useShell((s) => s.selectTab);
  const closeTab = useShell((s) => s.closeTab);
  const moveTab = useShell((s) => s.moveTab);
  const { env } = useCommands();
  const envRef = useRef(env);
  envRef.current = env;
  /** The tab that takes the focus once the strip has been redrawn: a moved tab keeps it, a closed one passes it on. */
  const refocus = useRef<string | null>(null);
  const hidden = useSidebarHidden();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  const measure = () => {
    const box = scrollRef.current;
    if (!box) return;
    const start = box.scrollLeft > 1;
    const end = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    setFade((f) => (f.start === start && f.end === end ? f : { start, end }));
  };
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [tabs.tabs.length]);

  // The active tab is always in view: scrolled in by the least that shows it with a little of its neighbour.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const tab = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !tab) return;
    const b = box.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.left < b.left + EDGE) box.scrollLeft -= b.left + EDGE - r.left;
    else if (r.right > b.right - EDGE) box.scrollLeft += r.right - (b.right - EDGE);
    measure();
  }, [tabs.active, tabs.tabs.length]);

  const reorder = useTabReorder(scrollRef, (id, to) => {
    refocus.current = id;
    moveTab(id, to);
  });

  /** The focus was just given to a tab by a close or a move: the next effect must not take it for a command's switch. */
  const handedOver = useRef(false);
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    handedOver.current = true;
    listRef.current?.querySelector<HTMLElement>(`[role="tab"][data-item-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, [tabs.tabs]);

  // A tab chosen by a command (⌘2, ⌃⇥) while the focus is on a tab of the strip takes the focus with it; a reader that took the
  // focus for itself (a tab chosen with the pointer) is left alone.
  useEffect(() => {
    if (handedOver.current) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !focused.matches('[role="tab"]') || !listRef.current?.contains(focused)) return;
    const next = listRef.current.querySelector<HTMLElement>(`[role="tab"][data-item-id="${CSS.escape(tabs.active)}"]`);
    if (next && next !== focused) next.focus({ preventScroll: true });
  }, [tabs.active]);

  useEffect(() => {
    handedOver.current = false;
  });

  /** A tab command run for the tab with the focus (the strip's keys; its menu): not the shown tab, which a command would take. */
  const runFor = (commandId: CommandId, itemId: string): boolean => {
    const ran = runPicked({ commandId }, envRef.current, { itemIds: [itemId] });
    if (!ran) refocus.current = null; // refused (the window is held): nothing changes, so nothing takes the focus later
    return ran;
  };
  const showMenu = useCallback(async (itemId: string, e: MouseEvent) => {
    e.preventDefault();
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'tab', itemId, active: useShell.getState().tabs.active === itemId, x: e.clientX, y: e.clientY }));
      if (picked) runPicked(picked, envRef.current, { itemIds: [itemId] });
    } catch (err) {
      showToast({ kind: 'error', title: t.toast.actionFailed, body: (err as Error).message, testId: 'action-error' });
    }
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const itemId = all[at]!.dataset['itemId'];
    const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
    if (itemId !== undefined && itemId !== 'library') {
      // ⌥⇧← / ⌥⇧→ move the tab (tab.moveLeft / tab.moveRight); the key is the strip's, as the command has no menu item.
      if (e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        refocus.current = itemId;
        runFor(e.key === 'ArrowLeft' ? 'tab.moveLeft' : 'tab.moveRight', itemId);
        return;
      }
      // Delete and Backspace close the tab (the tabs-with-deletion pattern); the focus goes to its neighbour.
      if (plain && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const readers = tabs.tabs;
        refocus.current = readers[readers.indexOf(itemId) + 1] ?? readers[readers.indexOf(itemId) - 1] ?? 'library';
        runFor('tab.close', itemId);
        return;
      }
    }
    if (!plain) return;
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  };

  // The window is named after the tab that shows: a reader's title, or the library's own heading (its head sets that).
  const active = tabs.active;
  return (
    <header className="titlebar tab-bar" data-testid="tab-bar">
      {hidden && <SidebarToggle place="toolbar" />}
      <div ref={listRef} className="tabs" role="tablist" aria-label={t.shell.tabs} aria-orientation="horizontal" onKeyDown={onKeyDown} onPointerDown={reorder.onPointerDown} onClickCapture={reorder.onClickCapture}>
        <Tab id="library" selected={active === 'library'} title={t.shell.libraryTab} icon={LibraryBig} home onChoose={() => selectTab('library')} />
        <span className="tabs-sep" aria-hidden="true" />
        <div ref={scrollRef} className="tabs-scroll" data-testid="tab-scroll" data-fade-start={fade.start ? 1 : undefined} data-fade-end={fade.end ? 1 : undefined} onScroll={measure}>
          {tabs.tabs.map((id) => (
            <ReaderTab key={id} itemId={id} selected={active === id} onChoose={() => selectTab(id)} onClose={() => closeTab(id)} onMenu={(e) => void showMenu(id, e)} />
          ))}
        </div>
      </div>
      {hidden && trailing}
      {active !== 'library' && <ActiveTitle itemId={active} />}
    </header>
  );
}

/** Names the window after the shown reader tab (Electron follows document.title); renders nothing. */
function ActiveTitle({ itemId }: { itemId: string }) {
  const query = useItem(itemId);
  const title = readerWindowTitle(query);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
  return null;
}

function ReaderTab({ itemId, selected, onChoose, onClose, onMenu }: { itemId: string; selected: boolean; onChoose(): void; onClose(): void; onMenu(e: MouseEvent): void }) {
  const query = useItem(itemId);
  // A trashed item no longer reads from the library; its row in the list (or the last read) still names it.
  const listed = useItems().data?.find((i) => i.id === itemId);
  const item = query.data ?? listed;
  const title = item?.title ?? '';
  return <Tab id={itemId} selected={selected} title={title} icon={item?.type === 'video' ? Clapperboard : FileText} onChoose={onChoose} onClose={onClose} onMenu={onMenu} />;
}

/** 탭 닫기 ⌘W: the command's name and its key as this platform spells it. */
function closeHint(): string {
  const c = commandById('tab.close');
  return `${commandLabel(c, currentPlatform())} ${acceleratorLabel(c.accelerator!, currentPlatform())}`;
}

function Tab(props: { id: string; selected: boolean; title: string; icon: typeof FileText; home?: boolean; onChoose(): void; onClose?(): void; onMenu?(e: MouseEvent): void }) {
  const { id, selected, title, home } = props;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onChoose();
    }
  };
  // The close mark is the tab's neighbour inside the same box, a pointer affordance only: a tab list may own tabs and nothing else
  // (a button in it, or in a tab, is a serious axe violation), so the keyboard and assistive technology close a tab by its command.
  return (
    <div className={cx('tab-item', home && 'home', selected && 'is-active')} onContextMenu={props.onMenu}>
      <div
        role="tab"
        className="tab"
        data-testid="tab"
        data-item-id={id}
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        title={title}
        onClick={props.onChoose}
        onKeyDown={onKeyDown}
      >
        <Icon icon={props.icon} />
        <span className="title ellipsis">{title}</span>
      </div>
      {props.onClose && (
        <span className="close" aria-hidden="true" title={closeHint()} data-testid="tab-close" onClick={props.onClose}>
          <Icon icon={X} size="sm" />
        </span>
      )}
    </div>
  );
}
