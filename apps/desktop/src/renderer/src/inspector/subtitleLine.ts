import { t } from '../strings';

/** The 자막 line's value (spec 6.8): the tracks' names in their order, and from four on the first two and "외 N개". */
export function subtitleLine(names: readonly string[]): string {
  if (names.length > 3) return `${names.slice(0, 2).join(t.inspector.subtitleSeparator)}${t.inspector.subtitleMore(names.length - 2)}`;
  return names.join(t.inspector.subtitleSeparator);
}
