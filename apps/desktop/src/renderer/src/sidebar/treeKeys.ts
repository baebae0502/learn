/** What the tree knows about the row a key went to: from the model, never from the DOM (the next row may not be mounted). */
export interface TreeKeyRow {
  key: string;
  collection: boolean;
  expanded: boolean;
  hasChildren: boolean;
  firstChild: string | null;
  parent: string | null;
}

export interface TreeKeyInput {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** isComposing, or the keyCode 229 macOS IMEs send. */
  composing: boolean;
  /** The row itself, the name field inside a row, or anything else (a button in a row, the heading). */
  target: 'row' | 'rename' | 'other';
  /** ⇧F10 or the menu key (ui/contextMenuKey.ts). */
  contextMenuKey: boolean;
  /** The reader is showing: the sidebar is a way back, and moving the cursor changes no view. */
  reader: boolean;
  row: TreeKeyRow | null;
}

export type TreeKeyAction =
  | { do: 'none' } // not ours: React Aria's row handling and the browser go on
  | { do: 'swallow' } // stop it before the row sees it; the browser's default (typing) stays
  | { do: 'block' } // held back from type-ahead (design-spec 7.1)
  | { do: 'commit' }
  | { do: 'cancel' }
  | { do: 'rename'; key: string }
  | { do: 'menu'; key: string }
  | { do: 'ignoreMenu' }
  | { do: 'goto'; key: string }; // select this row and move the cursor there

const NONE: TreeKeyAction = { do: 'none' };

/**
 * One decision for a key in the sidebar (spec 3.3, 3.4), made from facts only so it is testable and does not depend on
 * what the virtualizer has mounted. The tree's wrapper runs it in the capture phase, before React Aria's row does:
 * a row handles Home/End/arrows/Space in the capture phase, which would take them from the name field inside it.
 */
export function treeKeyAction(i: TreeKeyInput): TreeKeyAction {
  if (i.target === 'rename') {
    if (i.composing) return { do: 'swallow' };
    if (i.key === 'Enter') return { do: 'commit' };
    if (i.key === 'Escape') return { do: 'cancel' };
    return { do: 'swallow' };
  }
  const row = i.row;
  if (i.target !== 'row' || row === null) return NONE;
  if (i.contextMenuKey) return row.collection ? { do: 'menu', key: row.key } : { do: 'ignoreMenu' };
  if (i.metaKey || i.ctrlKey || i.altKey || i.shiftKey) return NONE;
  if (i.key === 'Enter') return row.collection && !i.reader ? { do: 'rename', key: row.key } : NONE;
  if (!i.reader && row.collection) {
    if (i.key === 'ArrowRight' && row.hasChildren && row.expanded && row.firstChild !== null) return { do: 'goto', key: row.firstChild };
    if (i.key === 'ArrowLeft' && !(row.hasChildren && row.expanded) && row.parent !== null) return { do: 'goto', key: row.parent };
  }
  if (i.composing || i.key === 'Process' || (i.key.length === 1 && i.key !== ' ')) return { do: 'block' };
  return NONE;
}
