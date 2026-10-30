import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import { LearnError, failureFrom, ok, type AppInfo, type Channels, type CommandContextState, type LearnApi, type Prefs, type Result } from '@learn/domain';
import type { LibraryContext } from '../library-context';
import type { PrefsStore } from '../prefs';
import type { SheetHost } from '../sheets';
import { isAllowedAppUrl } from '../url-policy';
import { mainStrings } from '../strings';
import { windowKindOf } from '../window-kinds';
import { CHANNEL_KINDS } from './channel-kinds';

export interface IpcDeps {
  getContext(): LibraryContext;
  appInfo(): AppInfo;
  prefs: PrefsStore;
  /** The main window's renderer reports its command context; main derives menu availability from it. */
  uiContext: { report(sender: WebContents, ctx: CommandContextState): void; current(): CommandContextState };
  /** Modal sheet windows (duplicate question, ⌘/ shortcuts); the only callers of the sheet:* channels. */
  sheets: SheetHost;
  /**
   * Whether `sender` is the current main window's renderer. createHandle has checked its kind already; this is the
   * window itself (a main window being closed still has the kind, and its last report must not drive the menu).
   */
  isMainWindow(sender: WebContents): boolean;
  /** Whether `sender` is the current settings window's renderer (its kind is checked by createHandle already). */
  isSettingsWindow(sender: WebContents): boolean;
  windows: {
    /** ⌘, (main-owned): opens the settings window, or brings it to the front. */
    openSettings(): void;
    /**
     * Runs a native dialog that macOS attaches to `owner` as a sheet (showOpenDialog / showMessageBox with a parent):
     * `owner` stays the main window meanwhile, and its window state is re-read once it is key again (38e3a9e) —
     * whichever window it is: the settings window's folder dialog and restart confirmation, the main window's open
     * panels (파일 가져오기, 다시 연결…). Every dialog with a parent window goes through it.
     */
    asSheet<T>(owner: BrowserWindow, show: () => Promise<T>): Promise<T>;
  };
  /**
   * Theme changes made in a page: the native theme follows the pages' reports (theme-follow.ts, T13R4-m1). `changed`
   * is called by prefs.set when the theme pref changed; `shown` when a page reports the theme it shows.
   */
  theme: { changed(theme: Prefs['theme']): void; shown(sender: WebContents, shade: 'light' | 'dark'): void };
  /** ui.reportIdle: the settings window is made, loaded and measured hidden now; nothing when one exists. */
  prepareSettings(): void;
  /** Restarts into the library location just saved. Under E2E (LEARN_E2E=1) it only records the request. */
  relaunch(): void;
}

/** The request half of LearnApi (everything but `on` / `pathForFile`). */
type Api = Omit<LearnApi, 'on' | 'pathForFile'>;
type ResultOf<F> = F extends (...args: never[]) => Promise<Result<infer T>> ? T : never;
/** One entry per request channel: its name and the data type LearnApi promises for it. */
type Contract = {
  [N in keyof Api]: {
    [V in keyof Api[N]]: { channel: V extends keyof (typeof Channels)[N] ? (typeof Channels)[N][V] : never; result: ResultOf<Api[N][V]> };
  }[keyof Api[N]];
}[keyof Api];
export type Channel = Contract['channel'];
export type ChannelResult<C extends Channel> = Extract<Contract, { channel: C }>['result'];

type Handler<S extends z.ZodType, T> = (input: z.output<S>, event: IpcMainInvokeEvent) => Promise<T> | T;
export type Handle = <C extends Channel, S extends z.ZodType>(channel: C, schema: S, fn: Handler<S, ChannelResult<C>>) => void;

/** E2E only (test-hooks.ts installs the counter): which channels a change really called. Nothing is kept otherwise. */
function countCall(channel: string): void {
  const calls = (globalThis as { __learnIpcCalls?: Record<string, number> }).__learnIpcCalls;
  if (calls) calls[channel] = (calls[channel] ?? 0) + 1;
}

/**
 * The single IPC entry point: sender URL check, window-kind check (CHANNEL_KINDS, by the sender's webContents), zod
 * validation, `Result` envelope, and error-code-only logging. A sender the channel does not allow is refused before
 * its input is read. The signature additionally ties each channel to the result type LearnApi declares for it.
 */
export function createHandle(devOrigin: string | null): Handle {
  return function handle<S extends z.ZodType, T>(channel: Channel, schema: S, fn: Handler<S, T>): void {
    const kinds = CHANNEL_KINDS[channel];
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<T>> => {
      try {
        const kind = windowKindOf(event.sender?.id);
        if (!isAllowedAppUrl(event.senderFrame?.url ?? '', devOrigin) || kind === undefined || !kinds.includes(kind)) {
          throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
        }
        const parsed = schema.safeParse(raw ?? undefined);
        if (!parsed.success) throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
        countCall(channel);
        return ok(await fn(parsed.data, event));
      } catch (e) {
        const failure = failureFrom(e);
        console.error(`[ipc] ${channel} failed: ${failure.code}`);
        return failure;
      }
    });
  } as Handle;
}
