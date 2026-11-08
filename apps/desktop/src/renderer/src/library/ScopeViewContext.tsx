import { createContext, useContext, type ReactNode } from 'react';
import type { ScopeView } from './useScopeView';

const Context = createContext<ScopeView | null>(null);

/** The window's scope view (MainWindow computes it once), for the table, the info pane and the tag selector to read. */
export function ScopeViewProvider(props: { view: ScopeView; children: ReactNode }) {
  return <Context.Provider value={props.view}>{props.children}</Context.Provider>;
}

export function useScopeViewContext(): ScopeView {
  const view = useContext(Context);
  if (view === null) throw new Error('useScopeViewContext needs a ScopeViewProvider above it');
  return view;
}
