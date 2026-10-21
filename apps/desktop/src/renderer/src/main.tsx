import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './data/query-client';
import { Gallery } from './gallery/Gallery';
import { SheetApp } from './sheets/SheetApp';
import { installInputModality } from './ui/inputModality';
import { readWindowParams, type RendererWindow } from './ui/platform';
import './styles';

// Dropping a file outside a drop target must never navigate the window.
for (const type of ['dragover', 'drop'] as const) document.addEventListener(type, (e) => e.preventDefault());
installInputModality(document);

const params = readWindowParams(location.search);
const root = document.documentElement;
root.dataset['window'] = params.window;
root.dataset['platform'] = params.platform;
if (params.deterministic) root.dataset['deterministic'] = '1';
if (params.vibrancy) root.dataset['vibrancy'] = '1';

const VIEWS: Partial<Record<RendererWindow, ComponentType>> = { main: App, gallery: Gallery, sheet: SheetApp };
const View = VIEWS[params.window] ?? App;

// Errors React catches or can't recover from are logged by name only: messages can carry paths or document text.
const errorName = (e: unknown): string => (e instanceof Error ? e.name : 'unknown');
createRoot(document.getElementById('root')!, {
  onCaughtError: (e) => console.error(`[app] caught ${errorName(e)}`),
  onUncaughtError: (e) => console.error(`[app] uncaught ${errorName(e)}`),
}).render(
  <StrictMode>
    <I18nProvider locale="ko-KR">
      <QueryClientProvider client={queryClient}>
        <View />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
