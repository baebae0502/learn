import { describe, expect, it } from 'vitest';
import { seedE2ESettings, type SettingsStore } from './e2e-settings';

const memory = (initial: Record<string, unknown> = {}): SettingsStore & { all: Record<string, unknown> } => {
  const all = { ...initial };
  return { all, get: (k) => all[k], set: (k, v) => void (all[k] = v) };
};

describe('E2E settings seed', () => {
  it('writes the settings that are not stored yet', () => {
    const s = memory();
    expect(seedE2ESettings(s, JSON.stringify({ 'reader.inspectorMode': 'info', 'reader.nav': 'outline' }))).toEqual(['reader.inspectorMode', 'reader.nav']);
    expect(s.all).toEqual({ 'reader.inspectorMode': 'info', 'reader.nav': 'outline' });
  });
  it('throws, naming the key, for a mistyped key or a value that is not valid; a failing store is its own error', () => {
    expect(() => seedE2ESettings(memory(), JSON.stringify({ 'reader.inspectorMod': 'info' }))).toThrow('unknown setting "reader.inspectorMod"');
    expect(() => seedE2ESettings(memory(), JSON.stringify({ 'reader.nav': 'sideways' }))).toThrow('the value for "reader.nav" is not valid');
    const broken: SettingsStore = { get: () => undefined, set: () => { throw new Error('disk full'); } };
    expect(() => seedE2ESettings(broken, JSON.stringify({ 'reader.inspectorMode': 'info' }))).toThrow('disk full');
  });
  it('never overwrites what the library already has', () => {
    const s = memory({ 'reader.inspectorMode': 'tutor' });
    expect(seedE2ESettings(s, JSON.stringify({ 'reader.inspectorMode': 'info' }))).toEqual([]);
    expect(s.all).toEqual({ 'reader.inspectorMode': 'tutor' });
  });
  it('an empty or missing variable seeds nothing; text that is no JSON object throws', () => {
    for (const raw of [undefined, '', '  ']) expect(seedE2ESettings(memory(), raw)).toEqual([]);
    for (const raw of ['{', '[]', 'null', '3']) expect(() => seedE2ESettings(memory(), raw)).toThrow('LEARN_E2E_SETTINGS');
  });
});
