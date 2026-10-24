import { describe, expect, it } from 'vitest';
import { Channels } from '@learn/domain';
import type { WindowKind } from '../window-kinds';
import { CHANNEL_KINDS } from './channel-kinds';

const ALL = Object.values(Channels)
  .flatMap((verbs) => Object.values(verbs) as string[])
  .sort();
const callableFrom = (kind: WindowKind) =>
  Object.entries(CHANNEL_KINDS)
    .filter(([, kinds]) => kinds.includes(kind))
    .map(([channel]) => channel)
    .sort();

describe('CHANNEL_KINDS', () => {
  it('names every declared channel, each for at least one kind', () => {
    expect(Object.keys(CHANNEL_KINDS).sort()).toEqual(ALL);
    expect(Object.entries(CHANNEL_KINDS).filter(([, kinds]) => kinds.length === 0)).toEqual([]);
  });

  it('a sheet: its payload and its answer, nothing else', () => {
    expect(callableFrom('sheet')).toEqual(['sheet:payload', 'sheet:resolve']);
  });

  it('the settings window: what SettingsApp calls — app info and the library location, the device prefs, its window state and theme', () => {
    expect(callableFrom('settings')).toEqual([
      'app:chooseLibraryFolder', 'app:info', 'app:showLibraryFolder', 'prefs:get', 'prefs:set', 'ui:themeShown', 'ui:windowState',
    ]);
  });

  it("the main window: everything but the settings window's library location and the sheets' own channels", () => {
    const elsewhere = ['app:chooseLibraryFolder', 'app:showLibraryFolder', 'sheet:payload', 'sheet:resolve'];
    expect(callableFrom('main')).toEqual(ALL.filter((c) => !elsewhere.includes(c)));
  });
});
