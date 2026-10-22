/**
 * The demo overlay (pointer ring and shortcut pills for screen recordings, M0 design 4): LEARN_DEMO_OVERLAY=1 in an
 * unpackaged build only. A packaged app never draws it, whatever its environment says.
 */
export const isDemoOverlay = (isPackaged: boolean, env: NodeJS.ProcessEnv): boolean => !isPackaged && env['LEARN_DEMO_OVERLAY'] === '1';
