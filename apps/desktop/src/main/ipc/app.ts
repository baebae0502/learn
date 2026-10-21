import { Channels, emptyInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

export function registerAppIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.app.info, emptyInput, () => deps.appInfo());
}
