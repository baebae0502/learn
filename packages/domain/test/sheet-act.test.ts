import { describe, expect, expectTypeOf, it } from 'vitest';
import { CHECK_ACTS, CHECK_ROW_KINDS, sheetActInput, sheetResultInput, type LearnApi, type SheetActInput, type SheetPayload } from '../src/index';
import { Channels } from '../src/ipc-channels';
import type { Result } from '../src/result';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';

describe('an open sheet\'s own actions (P-17)', () => {
  it('names sheet:act', () => {
    expect(Channels.sheet.act).toBe('sheet:act');
  });
  it('takes the library check\'s actions by row, and a relink by item id only — never a path or a key', () => {
    for (const act of CHECK_ACTS) expect(sheetActInput.parse({ action: { kind: 'libraryCheck', act } })).toEqual({ action: { kind: 'libraryCheck', act } });
    expect(sheetActInput.parse({ action: { kind: 'libraryCheck', act: 'relink', itemId: ID } })).toEqual({ action: { kind: 'libraryCheck', act: 'relink', itemId: ID } });
    const keys = ['assets/ab/x'];
    expect(sheetActInput.parse({ action: { kind: 'libraryCheck', act: 'cleanUnreferenced', keys } })).toEqual({ action: { kind: 'libraryCheck', act: 'cleanUnreferenced', keys } });
    const bad = [
      {},
      { action: { kind: 'libraryCheck', act: 'relink' } },
      { action: { kind: 'libraryCheck', act: 'relink', itemId: 'not-a-uuid' } },
      { action: { kind: 'libraryCheck', act: 'relink', itemId: ID, path: '/tmp/a.pdf' } },
      { action: { kind: 'libraryCheck', act: 'cleanUnreferenced' } },
      { action: { kind: 'libraryCheck', act: 'cleanUnreferenced', keys: [7] } },
      { action: { kind: 'libraryCheck', act: 'cleanUnreferenced', keys: ['assets/ab/x'], path: '/tmp' } },
      { action: { kind: 'libraryCheck', act: 'cleanStaging', keys: ['assets/ab/x'] } },
      { action: { kind: 'libraryCheck', act: 'delete' } },
      { action: { kind: 'duplicate', act: 'cleanStaging' } },
      { action: { kind: 'libraryCheck', act: 'cleanStaging' }, extra: true },
    ];
    for (const input of bad) expect(sheetActInput.safeParse(input).success, JSON.stringify(input)).toBe(false);
  });
  it('closes the check sheet by its kind; the rows go in the order of the spec\'s table (7.2)', () => {
    expect(sheetResultInput.parse({ kind: 'libraryCheck' })).toEqual({ kind: 'libraryCheck' });
    expect(CHECK_ROW_KINDS).toEqual(['staging', 'unreferenced', 'missingManaged', 'missingLinked', 'corrupt', 'orphanEdits']);
  });
  it('answers the payload the sheet shows now', () => {
    expectTypeOf<Parameters<LearnApi['sheet']['act']>[0]>().toEqualTypeOf<SheetActInput>();
    expectTypeOf<ReturnType<LearnApi['sheet']['act']>>().toEqualTypeOf<Promise<Result<SheetPayload>>>();
  });
});
