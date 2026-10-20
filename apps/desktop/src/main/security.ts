import { app, session, shell } from 'electron';
import { isAllowedAppUrl } from './url-policy';

/** Must be called once, after 'ready' and before the first window is created. */
export function hardenApp(devOrigin: string | null): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedAppUrl(url, devOrigin)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  // Only fullscreen (video viewer) is allowed, and only for our own pages. Everything else stays denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(permission === 'fullscreen' && isAllowedAppUrl(details.requestingUrl, devOrigin)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin, details) =>
      permission === 'fullscreen' && isAllowedAppUrl(details.requestingUrl ?? requestingOrigin, devOrigin),
  );
}
