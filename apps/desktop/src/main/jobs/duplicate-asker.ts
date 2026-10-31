import type { MessageBoxOptions } from 'electron';
import type { SheetPayload, SheetResult } from '@learn/domain';
import { mainStrings } from '../strings';
import type { DuplicateAnswer, DuplicateQuestion } from './import-queue';

/** What the question needs of a window (a BrowserWindow fits). */
export interface AskWindow {
  readonly webContents: { readonly id: number };
  isFocused(): boolean;
  focus(): void;
}

export interface DuplicateAskerDeps<W extends AskWindow> {
  /** The window with this webContents id while it is a live main window; else null. */
  windowOf(webContentsId: number): W | null;
  /** The main window there is now, or null. */
  anyMainWindow(): W | null;
  /** The duplicate sheet over `parent` (SheetHost.open). */
  sheet(parent: W, payload: SheetPayload): Promise<SheetResult | null>;
  /** A native message box with no window (dialog.showMessageBox(options)). */
  messageBox(options: MessageBoxOptions): Promise<{ response: number; checkboxChecked: boolean }>;
}

const SKIP: DuplicateAnswer = { choice: 'skip', applyToRest: false, askedOn: null };

/**
 * One duplicate question: on the window that put the file in; that window gone, on the main window there is now; with
 * none, in a message box of its own, which offers 새 자료로 추가 and 건너뛰기 only — there is no window to open the
 * existing item in. A question that ends unanswered (the sheet closed, the import stopped) is 건너뛰기, for that file.
 */
export function createDuplicateAsker<W extends AskWindow>(deps: DuplicateAskerDeps<W>) {
  return async (owner: number, question: DuplicateQuestion, signal: AbortSignal): Promise<DuplicateAnswer> => {
    if (signal.aborted) return SKIP;
    // A sheet left open by a stopped import closes with the app; nothing else ends it but its own answer.
    const stopped = new Promise<null>((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
    const offer = question.remaining > 0;
    const parent = deps.windowOf(owner) ?? deps.anyMainWindow();
    if (parent !== null) {
      // Files dropped from Finder leave Finder the active app: the question must not wait unseen on a background window.
      if (!parent.isFocused()) parent.focus();
      const payload: SheetPayload = { kind: 'duplicate', fileName: question.fileName, existing: question.existing, remaining: question.remaining };
      const result = await Promise.race([deps.sheet(parent, payload), stopped]);
      if (result === null || result.kind !== 'duplicate') return SKIP;
      return { choice: result.choice, applyToRest: offer && result.applyToRest, askedOn: parent.webContents.id };
    }
    const words = mainStrings.duplicateQuestion;
    const options: MessageBoxOptions = {
      type: 'question',
      message: words.message,
      detail: words.detail(question.fileName, question.existing.title),
      buttons: [words.add, words.skip],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      // Ticked as it opens, like the sheet's box: one answer for every duplicate unless unticked.
      ...(offer ? { checkboxLabel: words.applyToRest(question.remaining), checkboxChecked: true } : {}),
    };
    const answer = await Promise.race([deps.messageBox(options), stopped]);
    if (answer === null) return SKIP;
    return { choice: answer.response === 0 ? 'add' : 'skip', applyToRest: offer && answer.checkboxChecked, askedOn: null };
  };
}
