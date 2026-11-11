import { describe, expect, it } from 'vitest';
import { seedE2ESettings, type SettingsStore } from './e2e-settings';

const memory = (initial: Record<string, unknown> = {}): SettingsStore & { all: Record<string, unknown> } => {
  const all = { ...initial };
  return { all, get: (k) => all[k], set: (k, v) => void (all[k] = v) };
};

describe('E2E settings seed', () => {
  it('writes the settings that are not stored yet, and only valid ones', () => {
    const s = memory();
    expect(seedE2ESettings(s, JSON.stringify({ 'reader.inspectorMode': 'info', 'reader.nav': 'sideways', 'no.such': 1 }))).toEqual(['reader.inspectorMode']);
    expect(s.all).toEqual({ 'reader.inspectorMode': 'info' });
  });
  it('never overwrites what the library already has', () => {
    const s = memory({ 'reader.inspectorMode': 'tutor' });
    expect(seedE2ESettings(s, JSON.stringify({ 'reader.inspectorMode': 'info' }))).toEqual([]);
    expect(s.all).toEqual({ 'reader.inspectorMode': 'tutor' });
  });
  it('an empty, missing or unreadable variable seeds nothing', () => {
    for (const raw of [undefined, '', '  ', '{', '[]', 'null', '3']) {
      const s = memory();
      expect(seedE2ESettings(s, raw)).toEqual([]);
      expect(s.all).toEqual({});
    }
  });
});
