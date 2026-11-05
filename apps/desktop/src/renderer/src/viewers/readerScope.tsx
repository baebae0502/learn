import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useStore, type StoreApi } from 'zustand';
import { createFindStore, type FindStore } from './pdf/findStore';
import { createReaderStore, type ReaderStore } from './pdf/readerStore';
import { readWindowParams } from '../ui/platform';
import { createSelectionStore, type SelectionStore } from '../translation/useSelectionText';
import { createTranslationStore, type TranslationStore } from '../translation/store';

/**
 * Everything one open document keeps on screen: its reader state, its find bar, its text selection and the translation of it,
 * and the toolbar's page field. Several readers can be mounted at once; each has its own scope.
 */
export interface ReaderScope {
  readonly id: string;
  readonly reader: StoreApi<ReaderStore>;
  readonly find: StoreApi<FindStore>;
  readonly selection: StoreApi<SelectionStore>;
  readonly translation: StoreApi<TranslationStore>;
  readonly pageField: { current: HTMLInputElement | null };
}

export function createReaderScope(id: string): ReaderScope {
  return { id, reader: createReaderStore(), find: createFindStore(), selection: createSelectionStore(), translation: createTranslationStore(), pageField: { current: null } };
}

/**
 * The scope of each tab's document, made on first ask and kept while the tab is open: a reader that left the mounted set and
 * comes back finds its find query and translation as it left them (the view itself is made again, at the saved place).
 */
export const readerScopes = (() => {
  const all = new Map<string, ReaderScope>();
  return {
    get(id: string): ReaderScope {
      let scope = all.get(id);
      if (!scope) all.set(id, (scope = createReaderScope(id)));
      return scope;
    },
    /** The tab was closed or its item is gone for good. */
    drop(id: string): void {
      const scope = all.get(id);
      if (!scope) return;
      all.delete(id);
      if (active === scope) setActiveReaderScope(null);
    },
    ids: (): string[] => [...all.keys()],
  };
})();

const Context = createContext<ReaderScope | null>(null);
/** Whether the reader around the component has the screen: a kept tab that is not shown stops watching sizes and playing. */
const ShownContext = createContext(true);

export function ReaderScopeProvider({ scope, shown = true, children }: { scope: ReaderScope; shown?: boolean; children: ReactNode }) {
  return (
    <Context.Provider value={scope}>
      <ShownContext.Provider value={shown}>{children}</ShownContext.Provider>
    </Context.Provider>
  );
}

export const useReaderShown = (): boolean => useContext(ShownContext);

let active: ReaderScope | null = null;
const listeners = new Set<() => void>();

export const activeReaderScope = (): ReaderScope | null => active;

/** The reader that has the screen: what the shell's toolbar, sidebar, panel and commands talk to. */
export function setActiveReaderScope(scope: ReaderScope | null): void {
  if (active === scope) return;
  active = scope;
  for (const fn of [...listeners]) fn();
}

export function subscribeActiveReaderScope(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Outside a reader, with no reader active: stores in their starting state. Made when first needed. */
let standby: ReaderScope | null = null;
const standbyScope = (): ReaderScope => (standby ??= createReaderScope(''));

/** The scope a plain function (no component) talks to: the active one, or the standby. */
export const currentScope = (): ReaderScope => active ?? standbyScope();

const noSubscription = (): (() => void) => () => undefined;

/** The scope of the reader around the component; outside any, the active one (re-rendering when that changes). */
export function useReaderScope(): ReaderScope {
  const own = useContext(Context);
  const current = useSyncExternalStore(own ? noSubscription : subscribeActiveReaderScope, activeReaderScope, activeReaderScope);
  return own ?? current ?? standbyScope();
}

/** The scope a component outside every reader follows, or null while none is active. */
export function useActiveReaderScope(): ReaderScope | null {
  return useSyncExternalStore(subscribeActiveReaderScope, activeReaderScope, activeReaderScope);
}

const identity = <T,>(x: T): T => x;

interface ScopedHook<S> {
  (): S;
  <U>(selector: (state: S) => U): U;
  /** Outside a component: the active scope's store. */
  getState(): S;
  setState(partial: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

function scopedHook<S>(pick: (scope: ReaderScope) => StoreApi<S>): ScopedHook<S> {
  const hook = <U,>(selector?: (state: S) => U): S | U => useStore(pick(useReaderScope()), (selector ?? identity) as (state: S) => S | U);
  return Object.assign(hook, {
    getState: () => pick(currentScope()).getState(),
    setState: (partial: Partial<S> | ((state: S) => Partial<S>)) => pick(currentScope()).setState(partial),
    subscribe: (listener: (state: S, previous: S) => void) => pick(currentScope()).subscribe(listener),
  }) as ScopedHook<S>;
}

export const useReader = scopedHook((s) => s.reader);
export const useFind = scopedHook((s) => s.find);
export const useSelection = scopedHook((s) => s.selection);
export const useTranslation = scopedHook((s) => s.translation);

/** What a function outside the reader needs: the page field of the active reader. */
export const activePageField = (): HTMLInputElement | null => currentScope().pageField.current;

/**
 * E2E only: the reader store of whichever reader is active, in the shape of the store hook (`getState`, `subscribe`).
 * A subscriber also hears of a change of the active reader.
 */
export function learnReaderHook(): { getState(): ReaderStore; subscribe(fn: () => void): () => void } {
  return {
    getState: () => currentScope().reader.getState(),
    subscribe: (fn) => {
      let stop = currentScope().reader.subscribe(fn);
      const stopActive = subscribeActiveReaderScope(() => {
        stop();
        stop = currentScope().reader.subscribe(fn);
        fn();
      });
      return () => {
        stop();
        stopActive();
      };
    },
  };
}

declare global {
  interface Window {
    /** E2E only (the page's address carries e2e=1 in an unpackaged test run): lets tests drive the active reader's handle. */
    __learnReader?: ReturnType<typeof learnReaderHook>;
  }
}
if (typeof window !== 'undefined' && readWindowParams(window.location.search).e2e) window.__learnReader = learnReaderHook();
