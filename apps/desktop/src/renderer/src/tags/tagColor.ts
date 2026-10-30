import { TAG_COLORS, type TagColorId } from '@learn/domain';

/** The colour of slot N as a CSS value: the token tokens.css defines (the same in both themes). */
export function tagColorVar(position: number): string {
  return `var(--tag-${position})`;
}

/** Colour N is slot N (Zotero's order, design-spec 4): the domain colour a slot stands for. */
export function tagColorId(position: number): TagColorId {
  const color = TAG_COLORS[position - 1];
  if (!color) throw new RangeError(`no tag colour at slot ${position}`);
  return color.id;
}
