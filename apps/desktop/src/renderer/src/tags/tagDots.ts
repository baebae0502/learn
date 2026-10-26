import type { OrganizeTag } from '@learn/domain';
import { t } from '../strings';

/** The tags a table row draws a dot for: the coloured ones, by slot (the model already lists them so; sorted again for any caller). */
export function dotTags(tags: readonly OrganizeTag[]): readonly OrganizeTag[] {
  const coloured = tags.filter((tag) => tag.position !== null);
  return coloured.every((tag, i) => i === 0 || coloured[i - 1]!.position! <= tag.position!) ? coloured : [...coloured].sort((a, b) => a.position! - b.position!);
}

/** The row's accessible description (spec 5.1): the dots say it by colour, this says it by name. Null when there is no dot. */
export function tagsDescription(tags: readonly OrganizeTag[]): string | null {
  const dots = dotTags(tags);
  return dots.length === 0 ? null : t.organize.tags.description(dots.map((tag) => tag.name).join(', '));
}
