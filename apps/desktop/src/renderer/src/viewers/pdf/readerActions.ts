import type { PageColor } from '@learn/domain';
import type { CommandEnv } from '../../commands/registry';
import { saveSetting } from '../../data/saveSetting';
import { focusPageField } from './pageField';
import { useReader } from './readerStore';

/** What the reader's commands do to the open PDF (the CommandEnv's reader part): through the handle, so nothing runs without a viewer. */
export const readerActions: Pick<CommandEnv, 'zoom' | 'setZoom' | 'rotate' | 'setPageColor' | 'goToPage'> = {
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
};
