import { isAllowedAppUrl } from './url-policy';

/**
 * What our own pages may use, by Electron's permission names: full screen for the video viewer, clipboard writes for
 * the item panel's copy button (navigator.clipboard.writeText). Reading the clipboard and everything else stay denied.
 */
export const APP_PERMISSIONS: ReadonlySet<string> = new Set(['fullscreen', 'clipboard-sanitized-write']);

export const appMayUse = (permission: string, requestingUrl: string, devOrigin: string | null): boolean =>
  APP_PERMISSIONS.has(permission) && isAllowedAppUrl(requestingUrl, devOrigin);
