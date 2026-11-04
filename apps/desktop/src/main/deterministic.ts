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

/**
 * LEARN_TRANSLATION_NET=intercept: the real translation engine runs over net.fetch and a handler of the test's answers the
 * translation host (translation/net-intercept.ts). It needs LEARN_E2E=1 as well, and an unpackaged build: a packaged build
 * (and a plain run, and a CI that sets neither) never installs the handler and never reaches the fake engine's replacement.
 */
export const isTranslationNetIntercept = (isPackaged: boolean, env: NodeJS.ProcessEnv): boolean => isE2E(isPackaged, env) && env['LEARN_TRANSLATION_NET'] === 'intercept';
