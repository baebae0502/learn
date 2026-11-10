import { registerAppIpc } from './app';
import { registerBackupIpc } from './backup';
import { registerCheckIpc } from './check';
import { registerEditedCopiesIpc } from './edited-copies';
import { registerLibraryIpc } from './library';
import { registerOrganizeIpc } from './organize';
import { registerReaderIpc } from './reader';
import { registerSearchIpc } from './search';
import type { Handle, IpcDeps } from './register';
import { registerSettingsIpc } from './settings';
import { registerSheetIpc } from './sheet';
import { registerTrashIpc } from './trash';
import { registerTranslationIpc } from './translation';
import { registerUiIpc } from './ui';

/** Every IPC module. all.test.ts checks that together they register exactly the channels in `Channels`. */
const MODULES = [registerAppIpc, registerLibraryIpc, registerOrganizeIpc, registerSettingsIpc, registerReaderIpc, registerSearchIpc, registerUiIpc, registerSheetIpc, registerTrashIpc, registerEditedCopiesIpc, registerCheckIpc, registerBackupIpc, registerTranslationIpc] as const;

export function registerAllIpc(handle: Handle, deps: IpcDeps): void {
  for (const register of MODULES) register(handle, deps);
}
