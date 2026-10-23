import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './data/query-client';
import { SettingsApp } from './settings/SettingsApp';
import { SheetApp } from './sheets/SheetApp';
import { guardDocumentDrops } from './shell/drop';
import { installInputModality } from './ui/inputModality';
import { readWindowParams, type RendererWindow } from './ui/platform';
import './styles';

// Dropping a file outside a drop target must never navigate the window; where nothing takes it, the no-drop cursor.
guardDocumentDrops(document);
installInputModality(document);

const params = readWindowParams(location.search);
const root = document.documentElement;
root.dataset['window'] = params.window;
root.dataset['platform'] = params.platform;
if (params.deterministic) root.dataset['deterministic'] = '1';
if (params.vibrancy) root.dataset['vibrancy'] = '1';

// A sheet or the settings window does not load the main window's code (the reader, PDF.js: a megabyte of script), so
// it opens sooner (T13M-n4). Their own views are small and come with this file; the main window and the gallery load
// theirs as a chunk.
const VIEWS: Record<RendererWindow, () => Promise<ComponentType>> = {
  main: () => import('./App').then((m) => m.App),
  settings: () => Promise.resolve(SettingsApp),
  gallery: () => import('./gallery/Gallery').then((m) => m.Gallery),
  sheet: () => Promise.resolve(SheetApp),
};
const View = await VIEWS[params.window]();

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
