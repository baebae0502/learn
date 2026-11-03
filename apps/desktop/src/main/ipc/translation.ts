import { Channels, emptyInput, translateInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

export function registerTranslationIpc(handle: Handle, deps: IpcDeps): void {
  handle(Channels.translation.translate, translateInput, (input) => deps.translation.translate(input));
  handle(Channels.translation.cancel, emptyInput, () => {
    deps.translation.cancel();
  });
}
