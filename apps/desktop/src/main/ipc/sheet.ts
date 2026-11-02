import { Channels, emptyInput, sheetActInput, sheetResultInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

/** Sheet windows only: the host rejects any other sender (PERMISSION_DENIED). */
export function registerSheetIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.sheet.payload, emptyInput, (_input, event) => deps.sheets.payloadFor(event.sender));
  handle(Channels.sheet.resolve, sheetResultInput, (result, event) => deps.sheets.resolve(event.sender, result));
  // An open sheet's own action (the library check's rows, P-17): main does it, the sheet shows the answer.
  handle(Channels.sheet.act, sheetActInput, ({ action }, event) => deps.sheets.act(event.sender, action));
}
