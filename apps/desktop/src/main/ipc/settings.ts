import { Channels, emptyInput, prefsSetInput, settingGetInput, settingSetInput } from '@learn/domain';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

export function registerSettingsIpc(handle: Handle, deps: IpcDeps): void {
  // Library-scoped settings (library DB). Unset → null.
  handle(Channels.settings.get, settingGetInput, ({ key }) => deps.getContext().settings.get(key) ?? null);
  handle(Channels.settings.set, settingSetInput, ({ key, value }) => {
    deps.getContext().settings.set(key, value);
    broadcast('settingsChanged', { keys: [key] });
  });

  // Per-device preferences (userData/preferences.json); available even when the library failed to open.
  handle(Channels.prefs.get, emptyInput, () => deps.prefs.get());
  handle(Channels.prefs.set, prefsSetInput, (patch) => {
    const before = deps.prefs.get().theme;
    const prefs = deps.prefs.set(patch);
    // The pages change first; the native theme follows them (T13R4-m1).
    if (prefs.theme !== before) deps.theme.changed(prefs.theme);
    broadcast('prefsChanged', { prefs });
    return prefs;
  });
}
