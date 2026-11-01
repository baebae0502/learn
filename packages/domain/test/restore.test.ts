import { describe, expect, it } from 'vitest';
import { IDLE_RESTORE_PROGRESS, RESTORE_COPY } from '../src/index';

describe('복원 in the domain (spec 9, P-20)', () => {
  it('a restore at rest is idle with nothing counted', () => {
    expect(IDLE_RESTORE_PROGRESS).toEqual({ kind: 'restore', state: 'idle', bytesDone: 0, bytesTotal: 0, done: 0, total: 0, name: null });
    expect(Object.isFrozen(IDLE_RESTORE_PROGRESS)).toBe(true);
  });

  it('what a backup folder can be refused for: each says the cause, then what to do next', () => {
    expect(Object.keys(RESTORE_COPY).sort()).toEqual(['damagedDatabase', 'damagedList', 'newerVersion', 'notEmpty', 'unknownFormat']);
    for (const [key, text] of Object.entries(RESTORE_COPY)) expect(text, key).toMatch(/^[^.]+\. [^.]+\.$/);
  });
});
