/** Characters kept whole before the extension (or at the end of a name without one). */
const KEEP = 8;
/** An extension longer than this is not one (a name with a dot in it). */
const EXTENSION_MAX = 6;

/**
 * Where a file name gives way when it does not fit (spec 3.3 "넘치면 가운데 줄임"): the head is cut with an ellipsis,
 * the tail — the extension and the few characters before it — stays. By code points, so Hangul and emoji are never split.
 */
export function middleParts(name: string): { head: string; tail: string } {
  const chars = [...name];
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? [...name.slice(dot)].length : 0;
  const tailLength = (ext > 0 && ext <= EXTENSION_MAX ? ext : 0) + KEEP;
  if (chars.length <= tailLength + 2) return { head: name, tail: '' };
  return { head: chars.slice(0, chars.length - tailLength).join(''), tail: chars.slice(chars.length - tailLength).join('') };
}
