import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import { App } from './App';
import { Gallery } from './gallery/Gallery';
import { readWindowParams, type RendererWindow } from './ui/platform';
import './styles';

// Dropping a file outside a drop target must never navigate the window.
for (const type of ['dragover', 'drop'] as const) document.addEventListener(type, (e) => e.preventDefault());

const params = readWindowParams(location.search);
const root = document.documentElement;
root.dataset['platform'] = params.platform;
if (params.deterministic) root.dataset['deterministic'] = '1';
if (params.vibrancy) root.dataset['vibrancy'] = '1';

const VIEWS: Partial<Record<RendererWindow, ComponentType>> = { main: App, gallery: Gallery };
const View = VIEWS[params.window] ?? App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider locale="ko-KR">
      <View />
    </I18nProvider>
  </StrictMode>,
);
