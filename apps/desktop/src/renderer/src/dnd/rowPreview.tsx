import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { LibraryItem } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { timed } from '../ui/perfMarks';
import { DragPreview } from './DragPreview';
import { MIME_ITEMS, parseItemsPayload } from './mime';
import { previewFacts } from './previewFacts';

/** The shape React Aria's `useDrag({ preview })` takes: it gives the drag's items and wants a node (and where the pointer sits on it) back. */
export type DragImageRenderer = (items: Array<Record<string, string>>, done: (node: HTMLElement | null, x?: number, y?: number) => void) => void;

/** Where the pointer sits on the image, from its top left: over the kind icon. */
const GRAB = { x: 12, y: 12 };

/**
 * The image of a row drag. `done` must be called at once (React Aria hands the node to the browser in it), so the preview is
 * rendered synchronously into a node off screen — by a React root of its own, which is why the same component can draw the
 * state board — and taken away the tick after.
 */
export const renderRowPreview: DragImageRenderer = (items, done) => {
  timed('dnd:preview', () => {
    const ids = parseItemsPayload(items[0]?.[MIME_ITEMS] ?? '') ?? [];
    const facts = previewFacts(ids, queryClient.getQueryData<LibraryItem[]>(keys.items));
    const host = document.createElement('div');
    host.className = 'dnd-preview-host';
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(<DragPreview {...facts} />));
    done(host, GRAB.x, GRAB.y);
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  });
};
