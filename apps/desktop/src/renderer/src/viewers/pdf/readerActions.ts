import type { ImageBackground, PageColor, ScrollModeName, SpreadModeName } from '@learn/domain';
import type { CommandEnv } from '../../commands/registry';
import { saveSetting } from '../../data/saveSetting';
import { useShell } from '../../state/shell-store';
import { sidebarHidden, toggledSidebar } from '../../shell/layout';
import { keepFocusAcross } from '../../shell/useSidebar';
import { dispatchFind, selectionQuery } from './findControl';
import { useFind } from './findStore';
import { focusPageField } from './pageField';
import type { ImageZoom } from '../image/imageFit';
import { useReader, type ZoomValue } from './readerStore';

/** The PDF's fit names as the picture's: a whole page is the whole picture, the page's width the picture's; a picture has no automatic fit. */
const imageZoomOf = (zoom: ZoomValue): ImageZoom | null => (zoom === 'page-fit' ? 'fit' : zoom === 'page-width' ? 'width' : zoom === 'auto' ? null : zoom);

/**
 * What the reader's commands do to the open document (the CommandEnv's reader part): through its handle, so nothing runs without
 * a viewer. The zoom and the turns go to the picture when one is drawn, else to the PDF.
 */
export const readerActions: Pick<CommandEnv, 'zoom' | 'setZoom' | 'rotate' | 'setPageColor' | 'setImageBackground' | 'setScroll' | 'setSpread' | 'goToPage' | 'history' | 'openFind' | 'findAgain' | 'findSelection' | 'showReaderNav'> = {
  zoom: (dir) => {
    const { handle, imageHandle } = useReader.getState();
    const target = imageHandle ?? handle;
    if (!target) return;
    if (dir === 'in') target.zoomIn();
    else if (dir === 'out') target.zoomOut();
    else target.setZoom(1);
  },
  setZoom: (zoom) => {
    const { handle, imageHandle } = useReader.getState();
    if (!imageHandle) return handle?.setZoom(zoom);
    const z = imageZoomOf(zoom);
    if (z !== null) imageHandle.setZoom(z);
  },
  rotate: (delta) => {
    const { handle, imageHandle } = useReader.getState();
    (imageHandle ?? handle)?.rotate(delta);
  },
  setPageColor: (color: PageColor) => saveSetting('reader.pageColor', color),
  setImageBackground: (bg: ImageBackground) => saveSetting('reader.imageBackground', bg),
  setScroll: (mode: ScrollModeName) => useReader.getState().handle?.setScroll(mode),
  setSpread: (mode: SpreadModeName) => useReader.getState().handle?.setSpread(mode),
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
