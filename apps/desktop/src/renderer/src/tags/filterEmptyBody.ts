import { t } from '../strings';
import { cloudChips, type CloudInput } from './tagCloud';

/** Chosen tags up to this many are named under the empty filter; more are only counted. */
const NAMED_MAX = 3;

/** The description of the empty-filter state (spec 3.6): how many tags were chosen, and their names when there are few. */
export function filterEmptyBody(names: readonly string[]): string {
  return t.organize.tags.filterEmptyBody(names.length, names.length <= NAMED_MAX ? names.join(' · ') : '');
}

/** The names of the chosen tags in the tag cloud's order (the sort setting included), so the line reads like the chips above it. */
export function chosenTagNames(input: Omit<CloudInput, 'query'>): string[] {
  return cloudChips({ ...input, query: '' })
    .filter((chip) => chip.on)
    .map((chip) => chip.tag.name);
}
