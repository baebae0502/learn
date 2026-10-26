/**
 * The kind of every window main creates, by its webContents id. IPC trusts this, never the page's URL: a page can
 * change its own URL within learn://app (will-navigate allows any app URL, history.pushState needs no navigation), and
 * the main window also shows the gallery board (?window=gallery) with the main window's preload.
 */
export type WindowKind = 'main' | 'settings' | 'sheet';

/** The part of a WebContents the registry needs (unit-testable without Electron). */
export interface KindedContents {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
}

const kinds = new Map<number, WindowKind>();

/**
 * Records the kind of a window main has just created, before its page loads; the entry goes with its webContents.
 * A webContents keeps one kind for its whole life: a second, different kind is a bug.
 */
export function registerWindowKind(contents: KindedContents, kind: WindowKind): void {
  const known = kinds.get(contents.id);
  if (known === kind) return;
  if (known !== undefined) throw new Error(`webContents ${contents.id} is a ${known} window, not a ${kind} window`);
  kinds.set(contents.id, kind);
  contents.once('destroyed', () => kinds.delete(contents.id));
}

/** The kind main registered for this webContents id; undefined for any other (one main did not create, or one gone). */
export const windowKindOf = (id: number | undefined): WindowKind | undefined => (id === undefined ? undefined : kinds.get(id));
