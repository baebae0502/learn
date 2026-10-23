import { t } from '../strings';

/**
 * The window title while reading (design-spec 2.1). Once the item is known, it is the item's title: on the reader,
 * and on the missing and open-failed notices too. When the item could not be read it is "Learn". While the item is
 * still loading it is null, which keeps the previous title rather than showing a blank or a wrong one.
 */
export function readerWindowTitle(item: { data?: { title: string } | null; isError: boolean }): string | null {
  if (item.data?.title) return item.data.title;
  return item.isError ? t.shell.appName : null;
}
