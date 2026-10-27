import { afterEach, describe, expect, it } from 'vitest';
import { countRender } from './renderCount';

type Counts = { __learnRenders?: Record<string, number> };
afterEach(() => {
  delete (globalThis as Counts).__learnRenders;
});

describe('render counts for the E2E (spec 7.1)', () => {
  it('counts nothing, and creates nothing, in a page that did not ask', () => {
    countRender('MainWindow');
    expect((globalThis as Counts).__learnRenders).toBeUndefined();
  });
  it('counts per component in a page that created the object', () => {
    (globalThis as Counts).__learnRenders = {};
    countRender('MainWindow');
    countRender('LibraryView');
    countRender('MainWindow');
    expect((globalThis as Counts).__learnRenders).toEqual({ MainWindow: 2, LibraryView: 1 });
  });
});
