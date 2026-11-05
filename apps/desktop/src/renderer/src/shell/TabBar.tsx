import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Clapperboard, FileText, LibraryBig, X } from 'lucide-react';
import { useItem, useItems } from '../data/queries';
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

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
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
      <div ref={listRef} className="tabs" role="tablist" aria-label={t.shell.tabs} aria-orientation="horizontal" onKeyDown={onKeyDown}>
        <Tab id="library" selected={active === 'library'} title={t.shell.libraryTab} icon={LibraryBig} home onChoose={() => selectTab('library')} />
        <span className="tabs-sep" aria-hidden="true" />
        <div ref={scrollRef} className="tabs-scroll" data-testid="tab-scroll" data-fade-start={fade.start ? 1 : undefined} data-fade-end={fade.end ? 1 : undefined} onScroll={measure}>
          {tabs.tabs.map((id) => (
            <ReaderTab key={id} itemId={id} selected={active === id} onChoose={() => selectTab(id)} onClose={() => closeTab(id)} />
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

function ReaderTab({ itemId, selected, onChoose, onClose }: { itemId: string; selected: boolean; onChoose(): void; onClose(): void }) {
  const query = useItem(itemId);
  // A trashed item no longer reads from the library; its row in the list (or the last read) still names it.
  const listed = useItems().data?.find((i) => i.id === itemId);
  const item = query.data ?? listed;
  const title = item?.title ?? '';
  return <Tab id={itemId} selected={selected} title={title} icon={item?.type === 'video' ? Clapperboard : FileText} onChoose={onChoose} onClose={onClose} />;
}

function Tab(props: { id: string; selected: boolean; title: string; icon: typeof FileText; home?: boolean; onChoose(): void; onClose?(): void }) {
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
    <div className={cx('tab-item', home && 'home', selected && 'is-active')}>
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
        <span className="close" aria-hidden="true" title={t.shell.closeTab(title)} data-testid="tab-close" onClick={props.onClose}>
          <Icon icon={X} size="sm" />
        </span>
      )}
    </div>
  );
}
