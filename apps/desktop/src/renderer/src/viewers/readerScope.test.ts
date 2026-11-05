import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({ translation: { cancel: async () => ({ ok: true, data: undefined }) } }) }));

const scopeModule = await import('./readerScope');
const { createReaderScope, setActiveReaderScope, activeReaderScope, subscribeActiveReaderScope, ReaderScopeProvider, useReaderScope, useReader, useFind, useSelection, useTranslation } = scopeModule;

afterEach(() => setActiveReaderScope(null));

describe('the reader scopes', () => {
  it('keep the four stores apart: what one document does is not seen in another', () => {
    const a = createReaderScope('a');
    const b = createReaderScope('b');
    a.reader.getState().setPdf({ ready: true, pageNumber: 7 });
    a.find.getState().openBar('attention');
    a.selection.setState({ text: 'x', open: true });
    a.translation.getState().setSource('hello');
    expect(b.reader.getState().pdf).toBeNull();
    expect(b.find.getState()).toMatchObject({ open: false, query: '' });
    expect(b.selection.getState()).toMatchObject({ text: '', open: false });
    expect(b.translation.getState().source).toBe('');
    expect(a.pageField).not.toBe(b.pageField);
    expect(a.id).toBe('a');
  });

  it('answer outside a reader from the active scope, and from empty defaults when there is none', () => {
    expect(activeReaderScope()).toBeNull();
    expect(useReader.getState().pdf).toBeNull();
    expect(useReader.getState().handle).toBeNull();
    expect(useFind.getState().open).toBe(false);
    expect(useSelection.getState().text).toBe('');
    expect(useTranslation.getState().view).toEqual({ kind: 'idle' });
    const a = createReaderScope('a');
    const b = createReaderScope('b');
    a.reader.getState().setPdf({ pageNumber: 3 });
    b.reader.getState().setPdf({ pageNumber: 9 });
    setActiveReaderScope(a);
    expect(useReader.getState().pdf?.pageNumber).toBe(3);
    setActiveReaderScope(b);
    expect(useReader.getState().pdf?.pageNumber).toBe(9);
    b.find.getState().openBar();
    expect(useFind.getState().open).toBe(true);
    setActiveReaderScope(null);
    expect(useReader.getState().pdf).toBeNull();
  });

  it('tell a subscriber once for each change of the active scope, and not for the same scope again', () => {
    const a = createReaderScope('a');
    const seen = vi.fn();
    const stop = subscribeActiveReaderScope(seen);
    setActiveReaderScope(a);
    expect(seen).toHaveBeenCalledTimes(1);
    setActiveReaderScope(a);
    expect(seen).toHaveBeenCalledTimes(1);
    setActiveReaderScope(null);
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
    setActiveReaderScope(a);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('give a component inside a provider its own scope, and one outside the active scope', () => {
    const a = createReaderScope('a');
    const b = createReaderScope('b');
    a.reader.getState().setPdf({ pageNumber: 3 });
    b.reader.getState().setPdf({ pageNumber: 9 });
    setActiveReaderScope(a);
    const Page = () => createElement('i', null, useReaderScope().id);
    expect(renderToString(createElement(Page))).toContain('>a<');
    expect(renderToString(createElement(ReaderScopeProvider, { scope: b, children: createElement(Page) }))).toContain('>b<');
  });

  it('give the E2E window the active scope`s reader state', () => {
    const a = createReaderScope('a');
    a.reader.getState().setPdf({ pageNumber: 5 });
    setActiveReaderScope(a);
    expect(scopeModule.learnReaderHook().getState().pdf?.pageNumber).toBe(5);
  });
});
