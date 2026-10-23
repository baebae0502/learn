/** Chromium switches that make screenshots repeatable (visual tour, evidence page shots). */
export const DETERMINISTIC_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ['force-color-profile', 'srgb'],
  ['disable-lcd-text'],
  ['disable-gpu-compositing'],
  ['font-render-hinting', 'none'],
];

/**
 * Test switches for unpackaged builds only (final review m3): a packaged build ignores them, as it ignores
 * LEARN_DEMO_OVERLAY. LEARN_DETERMINISTIC=1 forces software compositing and turns motion and the caret off;
 * LEARN_E2E=1 ships the menu without 개발자 도구 and only records a relaunch (Playwright cannot follow one). The
 * location overrides LEARN_LIBRARY_DIR and LEARN_USER_DATA_DIR are not test switches and stay honoured.
 */
export const isDeterministic = (isPackaged: boolean, env: NodeJS.ProcessEnv): boolean => !isPackaged && env['LEARN_DETERMINISTIC'] === '1';
export const isE2E = (isPackaged: boolean, env: NodeJS.ProcessEnv): boolean => !isPackaged && env['LEARN_E2E'] === '1';
