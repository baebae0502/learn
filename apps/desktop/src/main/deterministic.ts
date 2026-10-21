/** Chromium switches that make screenshots repeatable (visual tour, evidence page shots). */
export const DETERMINISTIC_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ['force-color-profile', 'srgb'],
  ['disable-lcd-text'],
  ['disable-gpu-compositing'],
  ['font-render-hinting', 'none'],
];

export const isDeterministic = (env: NodeJS.ProcessEnv): boolean => env['LEARN_DETERMINISTIC'] === '1';
