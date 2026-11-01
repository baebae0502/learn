import { describe, expect, expectTypeOf, it } from 'vitest';
import type { KeepOneInput, KeepOneUndoInput, LearnApi, PurgeInput } from '../src/ipc';
import { keepOneInput, keepOneUndoInput, purgeInput } from '../src/ipc';
import { Channels } from '../src/ipc-channels';
import type { KeepOneResult, KeepOneUndo, PurgedRows, TrashView } from '../src/library';
import type { Result } from '../src/result';

const A = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const B = '1b6f5a52-2c1e-4d55-9a3e-0d2c6f7e8a90';
type P<F> = F extends (i: infer I) => unknown ? I : never;

describe('the trash channels (spec 12)', () => {
  it('replace library:listTrash with library:trashView and add purge, emptyTrash and the duplicate clean-up', () => {
    expect(Channels.library).not.toHaveProperty('listTrash');
    expect(Channels.library).toMatchObject({
      trashView: 'library:trashView', purge: 'library:purge', emptyTrash: 'library:emptyTrash',
      keepOneOfDuplicates: 'library:keepOneOfDuplicates', keepOneOfAllDuplicates: 'library:keepOneOfAllDuplicates', undoKeepOne: 'library:undoKeepOne',
    });
  });

  it('purge takes trashed item and collection ids, at least one, and nothing else', () => {
    expect(purgeInput.parse({ itemIds: [A], collectionIds: [] })).toEqual({ itemIds: [A], collectionIds: [] });
    expect(purgeInput.safeParse({ itemIds: [], collectionIds: [B] }).success).toBe(true);
    expect(purgeInput.safeParse({ itemIds: [], collectionIds: [] }).success).toBe(false);
    expect(purgeInput.safeParse({ itemIds: ['not-a-uuid'], collectionIds: [] }).success).toBe(false);
    expect(purgeInput.safeParse({ itemIds: [A] }).success).toBe(false);
    expect(purgeInput.safeParse({ itemIds: [A], collectionIds: [], paths: ['/x'] }).success).toBe(false);
  });

  it('keepOne takes the chosen rows, one at least', () => {
    expect(keepOneInput.parse({ itemIds: [A, B] })).toEqual({ itemIds: [A, B] });
    expect(keepOneInput.safeParse({ itemIds: [] }).success).toBe(false);
    expect(keepOneInput.safeParse({ itemIds: [A], all: true }).success).toBe(false);
  });

  it('the undo token is exactly what keepOne answered: ids, an ISO stamp, id pairs', () => {
    const token: KeepOneUndo = { trashed: [B], stamp: '2026-10-31T01:00:00.001Z', memberships: [[A, B]], tags: [[B, A]] };
    expect(keepOneUndoInput.parse(token)).toEqual(token);
    for (const bad of [
      { ...token, stamp: 'yesterday' },
      { ...token, memberships: [[A]] },
      { ...token, memberships: [[A, B, A]] },
      { ...token, tags: [['x', A]] },
      { ...token, extra: 1 },
      { trashed: [B], stamp: token.stamp, memberships: [] },
    ]) {
      expect(keepOneUndoInput.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });

  it('LearnApi takes the schema inputs and answers the trash types', () => {
    expectTypeOf<P<LearnApi['library']['purge']>>().toEqualTypeOf<PurgeInput>();
    expectTypeOf<P<LearnApi['library']['keepOneOfDuplicates']>>().toEqualTypeOf<KeepOneInput>();
    expectTypeOf<P<LearnApi['library']['undoKeepOne']>>().toEqualTypeOf<KeepOneUndoInput>();
    expectTypeOf<KeepOneUndoInput>().toEqualTypeOf<KeepOneUndo>();
    expectTypeOf<Parameters<LearnApi['library']['trashView']>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<LearnApi['library']['trashView']>>().toEqualTypeOf<Promise<Result<TrashView>>>();
    expectTypeOf<ReturnType<LearnApi['library']['purge']>>().toEqualTypeOf<Promise<Result<PurgedRows>>>();
    expectTypeOf<ReturnType<LearnApi['library']['emptyTrash']>>().toEqualTypeOf<Promise<Result<PurgedRows>>>();
    expectTypeOf<ReturnType<LearnApi['library']['keepOneOfAllDuplicates']>>().toEqualTypeOf<Promise<Result<KeepOneResult>>>();
    expectTypeOf<ReturnType<LearnApi['library']['undoKeepOne']>>().toEqualTypeOf<Promise<Result<number>>>();
  });
});
