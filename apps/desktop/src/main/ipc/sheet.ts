import { Channels, emptyInput, sheetResultInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

/** Sheet windows only: the host rejects any other sender (PERMISSION_DENIED). */
export function registerSheetIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.sheet.payload, emptyInput, (_input, event) => deps.sheets.payloadFor(event.sender));
  handle(Channels.sheet.resolve, sheetResultInput, (result, event) => deps.sheets.resolve(event.sender, result));
}
