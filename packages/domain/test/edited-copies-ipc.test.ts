import { describe, expect, expectTypeOf, it } from 'vitest';
import { commandContextInput, editedCopyInput, type EditedCopyInput, type ItemIdInput, type LearnApi } from '../src/ipc';
import { Channels } from '../src/ipc-channels';
import type { EditedCopy } from '../src/library';
import type { Result } from '../src/result';

const ITEM = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const NAME = '세포생물학 3장 (수정본 2026-10-30 1412).pdf';

describe('edited copies over IPC (M6 spec 6, P-15)', () => {
  it('names three channels in the library namespace', () => {
    expect([Channels.library.editedCopies, Channels.library.importEditedCopy, Channels.library.revealEditedCopy]).toEqual([
      'library:editedCopies', 'library:importEditedCopy', 'library:revealEditedCopy',
    ]);
  });

  it('takes a copy by its bare file name in NFC, never a path or a dot name, and nothing more', () => {
    expect(editedCopyInput.parse({ itemId: ITEM, name: NAME.normalize('NFD') })).toEqual({ itemId: ITEM, name: NAME });
    for (const name of ['', '.', '..', 'a/b.pdf', '..\\x.pdf', 'x\u0000.pdf', `${'가'.repeat(256)}.pdf`]) {
      expect(editedCopyInput.safeParse({ itemId: ITEM, name }).success, JSON.stringify(name)).toBe(false);
    }
    expect(editedCopyInput.safeParse({ itemId: 'not-a-uuid', name: NAME }).success).toBe(false);
    expect(editedCopyInput.safeParse({ itemId: ITEM, name: NAME, path: '/tmp/x.pdf' }).success).toBe(false);
  });

  it('types the three verbs', () => {
    type In<F> = F extends (input: infer I) => unknown ? I : never;
    expectTypeOf<In<LearnApi['library']['editedCopies']>>().toEqualTypeOf<ItemIdInput>();
    expectTypeOf<In<LearnApi['library']['importEditedCopy']>>().toEqualTypeOf<EditedCopyInput>();
    expectTypeOf<In<LearnApi['library']['revealEditedCopy']>>().toEqualTypeOf<EditedCopyInput>();
    expectTypeOf<ReturnType<LearnApi['library']['editedCopies']>>().toEqualTypeOf<Promise<Result<EditedCopy[]>>>();
    expectTypeOf<ReturnType<LearnApi['library']['importEditedCopy']>>().toEqualTypeOf<Promise<Result<{ queued: number }>>>();
    expectTypeOf<ReturnType<LearnApi['library']['revealEditedCopy']>>().toEqualTypeOf<Promise<Result<void>>>();
  });
});

describe('the reported context carries the duplicate groups (spec 11.1: 중복 N묶음 모두 정리)', () => {
  it('a count of groups, or none; never negative or fractional', () => {
    const field = commandContextInput.shape.duplicateGroups;
    expect(field.safeParse(2).success).toBe(true);
    expect(field.safeParse(undefined).success).toBe(true);
    for (const n of [-1, 1.5]) expect(field.safeParse(n).success, String(n)).toBe(false);
  });
});
