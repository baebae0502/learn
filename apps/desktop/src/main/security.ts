import { app, session, shell } from 'electron';
import { appMayUse } from './permissions';
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
  // Our own pages only, and only what APP_PERMISSIONS lists (permissions.ts). Both handlers: Chromium asks either.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => callback(appMayUse(permission, details.requestingUrl, devOrigin)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
    appMayUse(permission, details.requestingUrl ?? requestingOrigin, devOrigin),
  );
}
