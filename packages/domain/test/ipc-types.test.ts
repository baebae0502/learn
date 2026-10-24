import { describe, expectTypeOf, it } from 'vitest';
import type * as Ipc from '../src/ipc';
import type { LearnApi } from '../src/ipc';
import type { LibraryColumnId } from '../src/library-columns';
import type { Result } from '../src/result';

type P<F> = F extends (i: infer I) => unknown ? I : never;

describe('LearnApi inputs are the schema input types', () => {
  it('matches at the type level', () => {
    expectTypeOf<P<LearnApi['library']['detail']>>().toEqualTypeOf<Ipc.ItemIdInput>();
    expectTypeOf<P<LearnApi['library']['trash']>>().toEqualTypeOf<Ipc.ItemIdsInput>();
    expectTypeOf<P<LearnApi['library']['restore']>>().toEqualTypeOf<Ipc.ItemIdsInput>();
    expectTypeOf<P<LearnApi['library']['updateMetadata']>>().toEqualTypeOf<Ipc.UpdateMetadataInput>();
    expectTypeOf<P<LearnApi['library']['import']>>().toEqualTypeOf<Ipc.ImportPathsInput>();
    expectTypeOf<P<LearnApi['library']['pickAndRelink']>>().toEqualTypeOf<Ipc.AssetIdInput>();
    expectTypeOf<P<LearnApi['collections']['create']>>().toEqualTypeOf<Ipc.CreateCollectionInput>();
    expectTypeOf<P<LearnApi['collections']['rename']>>().toEqualTypeOf<Ipc.RenameCollectionInput>();
    expectTypeOf<P<LearnApi['collections']['move']>>().toEqualTypeOf<Ipc.MoveCollectionInput>();
    expectTypeOf<P<LearnApi['collections']['remove']>>().toEqualTypeOf<Ipc.CollectionIdInput>();
    expectTypeOf<P<LearnApi['collections']['addItems']>>().toEqualTypeOf<Ipc.CollectionItemsInput>();
    expectTypeOf<P<LearnApi['tags']['create']>>().toEqualTypeOf<Ipc.CreateTagInput>();
    expectTypeOf<P<LearnApi['tags']['rename']>>().toEqualTypeOf<Ipc.RenameTagInput>();
    expectTypeOf<P<LearnApi['tags']['setColor']>>().toEqualTypeOf<Ipc.SetTagColorInput>();
    expectTypeOf<P<LearnApi['tags']['remove']>>().toEqualTypeOf<Ipc.TagIdInput>();
    expectTypeOf<P<LearnApi['tags']['assign']>>().toEqualTypeOf<Ipc.TagItemsInput>();
    expectTypeOf<P<LearnApi['tags']['togglePosition']>>().toEqualTypeOf<Ipc.TogglePositionInput>();
    expectTypeOf<P<LearnApi['settings']['get']>>().toEqualTypeOf<Ipc.SettingGetInput>();
    expectTypeOf<P<LearnApi['settings']['set']>>().toEqualTypeOf<Ipc.SettingSetInput>();
    expectTypeOf<P<LearnApi['prefs']['set']>>().toEqualTypeOf<Ipc.PrefsSetInput>();
    expectTypeOf<P<LearnApi['reader']['open']>>().toEqualTypeOf<Ipc.ItemIdInput>();
    expectTypeOf<P<LearnApi['reader']['getPosition']>>().toEqualTypeOf<Ipc.ItemIdInput>();
    expectTypeOf<P<LearnApi['reader']['savePosition']>>().toEqualTypeOf<Ipc.SavePositionInput>();
    expectTypeOf<P<LearnApi['ui']['showContextMenu']>>().toEqualTypeOf<Ipc.ShowContextMenuInput>();
    expectTypeOf<P<LearnApi['ui']['showColumnMenu']>>().toEqualTypeOf<Ipc.ShowColumnMenuInput>();
    expectTypeOf<P<LearnApi['ui']['reportContext']>>().toEqualTypeOf<Ipc.CommandContextInput>();
    expectTypeOf<P<LearnApi['ui']['confirmDuplicate']>>().toEqualTypeOf<Ipc.ConfirmDuplicateInput>();
    expectTypeOf<P<LearnApi['sheet']['resolve']>>().toEqualTypeOf<Ipc.SheetResultInput>();
  });
  it('the renderer never sends a library path (R4): prefs.set takes no libraryRoot; main\'s own patch does', () => {
    expectTypeOf<Ipc.PrefsSetInput>().not.toHaveProperty('libraryRoot');
    expectTypeOf<Ipc.PrefsPatch>().toHaveProperty('libraryRoot');
    expectTypeOf<Parameters<LearnApi['app']['chooseLibraryFolder']>>().toEqualTypeOf<[]>();
    expectTypeOf<ReturnType<LearnApi['app']['chooseLibraryFolder']>>().toEqualTypeOf<Promise<Result<{ relaunching: boolean }>>>();
  });
  it('context menus are typed by kind; the column header has its own menu (P-9)', () => {
    expectTypeOf<Ipc.ShowContextMenuInput['kind']>().toEqualTypeOf<'item' | 'collection' | 'tag'>();
    expectTypeOf<ReturnType<LearnApi['ui']['showColumnMenu']>>().toEqualTypeOf<Promise<Result<{ toggle: LibraryColumnId } | { reset: true } | null>>>();
  });
  it('togglePosition reports which tag was toggled and how (null when nothing to toggle)', () => {
    expectTypeOf<ReturnType<LearnApi['tags']['togglePosition']>>()
      .toEqualTypeOf<Promise<Result<{ tagId: string; assigned: boolean } | null>>>();
  });
});
