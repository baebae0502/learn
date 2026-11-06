import type { PageColor } from '@learn/domain';
import type { CommandEnv } from '../../commands/registry';
import { saveSetting } from '../../data/saveSetting';
import { useShell } from '../../state/shell-store';
import { sidebarHidden, toggledSidebar } from '../../shell/layout';
import { keepFocusAcross } from '../../shell/useSidebar';
import { dispatchFind, selectionQuery } from './findControl';
import { useFind } from './findStore';
import { focusPageField } from './pageField';
import { useReader } from './readerStore';

/** What the reader's commands do to the open PDF (the CommandEnv's reader part): through the handle, so nothing runs without a viewer. */
export const readerActions: Pick<CommandEnv, 'zoom' | 'setZoom' | 'rotate' | 'setPageColor' | 'goToPage' | 'history' | 'openFind' | 'findAgain' | 'findSelection' | 'showReaderNav'> = {
  zoom: (dir) => {
    const handle = useReader.getState().handle;
    if (!handle) return;
    if (dir === 'in') handle.zoomIn();
    else if (dir === 'out') handle.zoomOut();
    else handle.setZoom(1);
  },
  setZoom: (zoom) => useReader.getState().handle?.setZoom(zoom),
  rotate: (delta) => useReader.getState().handle?.rotate(delta),
  setPageColor: (color: PageColor) => saveSetting('reader.pageColor', color),
  goToPage: focusPageField,
  history: (direction) => {
    const handle = useReader.getState().handle;
    if (direction === 'back') handle?.historyBack();
    else handle?.historyForward();
  },
  openFind: () => {
    if (useReader.getState().handle) useFind.getState().openBar();
  },
  findAgain: (previous) => {
    const bus = useReader.getState().handle?.eventBus();
    if (!bus) return;
    const { query, open, openBar } = useFind.getState();
    // The focus goes to the field only when the bar had to open: while it is open ⌘G leaves it where it is.
    if (!open) openBar();
    if (query.trim() !== '') dispatchFind(bus, query, 'again', previous);
  },
  findSelection: () => {
    const bus = useReader.getState().handle?.eventBus();
    if (!bus) return;
    const query = selectionQuery(window.getSelection());
    // No selection: the bar only opens, with what it held.
    useFind.getState().openBar(query === '' ? undefined : query);
    if (query !== '') dispatchFind(bus, query, '');
  },
  showReaderNav: (kind) => {
    saveSetting('reader.nav', kind);
    // The list is for looking at: a folded sidebar opens (the same fold ⌃⌘S undoes).
    const { sidebar, setSidebar } = useShell.getState();
    if (!sidebarHidden(sidebar, innerWidth)) return;
    keepFocusAcross(false);
    setSidebar(toggledSidebar(sidebar, innerWidth));
  },
};
