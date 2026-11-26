import { isAllowedAppUrl } from './url-policy';

/**
 * What our own pages may use, by Electron's permission names: clipboard writes for the item panel's copy button
 * (navigator.clipboard.writeText). Reading the clipboard and everything else stay denied — HTML full screen too: the
 * video's full screen is the window's, asked of main's stage controller, so no page may request its own.
 */
export const APP_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export const appMayUse = (permission: string, requestingUrl: string, devOrigin: string | null): boolean =>
  APP_PERMISSIONS.has(permission) && isAllowedAppUrl(requestingUrl, devOrigin);
