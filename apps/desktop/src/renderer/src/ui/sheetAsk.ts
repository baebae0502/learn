import { useShell } from '../state/shell-store';

/**
 * A question main asks in one of our sheets (the purge sheet, P-25): from the request to the answer the window counts as
 * held — every command refused at once, nothing greyed until the sheet is on screen (MainWindow's `held` and `sheetOpen`,
 * as for ⌘/).
 */
export async function askInSheet<T>(ask: () => Promise<T>): Promise<T> {
  useShell.getState().countSheetAsk(1);
  try {
    return await ask();
  } finally {
    useShell.getState().countSheetAsk(-1);
  }
}
