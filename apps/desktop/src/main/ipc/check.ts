import { BrowserWindow } from 'electron';
import { Channels, LearnError, checkInput } from '@learn/domain';
import { mainStrings } from '../strings';
import type { Handle, IpcDeps } from './register';

/** 파일 › 라이브러리 점검… and the automatic sheet the main window asks for (recovery:show): main checks, shows, and answers once it closed. */
export function registerCheckIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.library.check, checkInput, async (input, event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent) throw new LearnError('NOT_FOUND', mainStrings.windowGone);
    await deps.checks.open(parent, input?.auto === true ? 'auto' : 'manual');
  });
}
