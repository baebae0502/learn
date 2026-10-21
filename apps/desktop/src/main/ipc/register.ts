import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import { LearnError, failureFrom, ok, type AppInfo, type Channels, type CommandContextState, type LearnApi, type Result } from '@learn/domain';
import type { LibraryContext } from '../library-context';
import type { PrefsStore } from '../prefs';
import type { SheetHost } from '../sheets';
import { isAllowedAppUrl } from '../url-policy';

export interface IpcDeps {
  getContext(): LibraryContext;
  appInfo(): AppInfo;
  prefs: PrefsStore;
  /** The main window's renderer reports its command context; main derives menu availability from it. */
  uiContext: { report(sender: WebContents, ctx: CommandContextState): void; current(): CommandContextState };
  /** Modal sheet windows (duplicate question, ⌘/ shortcuts); the only callers of the sheet:* channels. */
  sheets: SheetHost;
  /** Whether `sender` is the main window's renderer (sheets and the settings window are not). */
  isMainWindow(sender: WebContents): boolean;
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

/**
 * The single IPC entry point (moved unchanged from the former main/ipc.ts): sender URL check, zod
 * validation, `Result` envelope, and error-code-only logging. The signature additionally ties each
 * channel to the result type LearnApi declares for it.
 */
export function createHandle(devOrigin: string | null): Handle {
  return function handle<S extends z.ZodType, T>(channel: string, schema: S, fn: Handler<S, T>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<T>> => {
      try {
        if (!isAllowedAppUrl(event.senderFrame?.url ?? '', devOrigin)) {
          throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
        }
        const parsed = schema.safeParse(raw ?? undefined);
        if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '잘못된 요청입니다.');
        return ok(await fn(parsed.data, event));
      } catch (e) {
        const failure = failureFrom(e);
        console.error(`[ipc] ${channel} failed: ${failure.code}`);
        return failure;
      }
    });
  } as Handle;
}
