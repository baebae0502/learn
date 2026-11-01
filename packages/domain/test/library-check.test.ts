import { describe, expect, expectTypeOf, it } from 'vitest';
import { MAIN_WRITTEN_SETTINGS, NO_LIBRARY_VIEW, SETTINGS, checkInput, commandById, isCommandAvailable, parseSetting, type CheckInput, type CommandContextState, type LearnApi } from '../src/index';
import { EventChannels } from '../src/event-channels';
import type { LearnEventMap } from '../src/events';
import { Channels } from '../src/ipc-channels';
import type { Result } from '../src/result';

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };

describe('파일 › 라이브러리 점검… (spec 7.1, 11.1)', () => {
  it('is 파일\'s third group and a palette command, on in the library and the reader, off while the window is held', () => {
    expect(commandById('file.checkLibrary')).toMatchObject({ label: '라이브러리 점검…', menu: { menu: 'file', group: 3, order: 1 }, contexts: ['app'] });
    expect(commandById('file.checkLibrary').accelerator).toBeUndefined();
    expect(isCommandAvailable('file.checkLibrary', LIB)).toBe(true);
    expect(isCommandAvailable('file.checkLibrary', { ...LIB, view: 'viewer' })).toBe(true);
    expect(isCommandAvailable('file.checkLibrary', { ...LIB, blocked: true })).toBe(false);
  });
  it('library:check takes { auto } or nothing and answers when the sheet closed; the recovery report is gone (P-16)', () => {
    expect(Channels.library.check).toBe('library:check');
    expect('recoveryReport' in Channels.library).toBe(false);
    expect(checkInput.parse(undefined)).toBeUndefined();
    expect(checkInput.parse({ auto: true })).toEqual({ auto: true });
    expect(checkInput.safeParse({ auto: 'yes' }).success).toBe(false);
    expect(checkInput.safeParse({ auto: true, path: '/tmp' }).success).toBe(false);
    expectTypeOf<Parameters<LearnApi['library']['check']>>().toEqualTypeOf<[input?: CheckInput]>();
    expectTypeOf<ReturnType<LearnApi['library']['check']>>().toEqualTypeOf<Promise<Result<void>>>();
  });
  it('main asks the main window for the automatic sheet with recovery:show (Q-8d)', () => {
    expect(EventChannels['recovery:show']).toBe('evt:recovery-show');
    expectTypeOf<LearnEventMap['recovery:show']>().toEqualTypeOf<Record<string, never>>();
  });
});

describe('recovery.lastShown (spec 7.1, 12; ADR-0007 rule (b))', () => {
  it('is a library setting holding a sha-256 fingerprint, which main writes and a page may not (Q-8e)', () => {
    expect(Object.hasOwn(SETTINGS, 'recovery.lastShown')).toBe(true);
    expect(parseSetting('recovery.lastShown', 'a'.repeat(64))).toBe('a'.repeat(64));
    for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), 7, null]) expect(() => parseSetting('recovery.lastShown', bad), String(bad)).toThrow();
    expect(MAIN_WRITTEN_SETTINGS.has('recovery.lastShown')).toBe(true);
    expect(MAIN_WRITTEN_SETTINGS.has('library.sort')).toBe(false);
  });
});
