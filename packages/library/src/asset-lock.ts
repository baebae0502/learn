/**
 * One at a time per managed path (`assets/<xx>/<sha256>`): an import, from its look-up of the file's assets to its
 * commit, and a purge's removal of that copy. Without it, a purge committed while an import of the same file was on its
 * way could remove the copy the import had just found in place and kept (ADR-0006). In-process: main is the only writer.
 */
const held = new Map<string, Promise<void>>();

export function withManagedPath<T>(relativePath: string, work: () => Promise<T>): Promise<T> {
  const run = (held.get(relativePath) ?? Promise.resolve()).then(work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  held.set(relativePath, settled);
  void settled.then(() => {
    if (held.get(relativePath) === settled) held.delete(relativePath);
  });
  return run;
}

/** True while an import, a purge, a cleanup or a backup holds this path: a copy there may be placed but not yet committed. */
export function isManagedPathHeld(relativePath: string): boolean {
  return held.has(relativePath);
}
