import type { FileDropItem } from 'react-aria-components';

/**
 * The location of every dropped file, and how many dropped things have none: a folder, a file that lives in memory. The
 * count goes to the same toast the window overlay uses for them (MainWindow.onDrop).
 */
export async function filesFromDrop(items: ReadonlyArray<{ kind: string }>, pathForFile: (file: File) => string): Promise<{ paths: string[]; unresolved: number }> {
  const files = items.filter((item): item is FileDropItem => item.kind === 'file');
  const found = await Promise.all(files.map((item) => item.getFile()));
  const paths = found.map(pathForFile).filter((p) => p.length > 0);
  return { paths, unresolved: items.length - paths.length };
}
