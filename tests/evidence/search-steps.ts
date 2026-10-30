// The quick-search inputs the 10,000-item @perf test times: taken from the rows it seeds (tests/e2e/helpers.ts seedRows),
// so they hit real titles.
import { initialOf } from '../../apps/desktop/src/renderer/src/palette/hangul';

export interface SearchStep {
  group: 'ko' | 'initials' | 'en' | 'creator' | 'tag' | 'collection';
  /** Typed one by one, then erased one by one (each a timed input). */
  chars: string[];
}

const KO_RUN = /[가-힣]{2,}/u;
const LATIN_WORD = /[A-Za-z]{4,}/g;

/**
 * Two Korean title runs (up to 3 syllables each, from titles that start them differently), the 초성 of the first, two
 * Latin words (4 letters), one creator (2 characters): about 22 inputs typed and as many erased. Missing kinds are
 * left out; the test asks for enough inputs.
 */
export function searchSteps(items: ReadonlyArray<{ title: string; creators: readonly string[] }>): SearchStep[] {
  const ko: string[][] = [];
  const en: string[][] = [];
  for (const { title } of items) {
    const run = KO_RUN.exec(title)?.[0];
    if (run && ko.length < 2 && !ko.some((r) => r[0] === run[0])) ko.push([...run].slice(0, 3));
    for (const word of title.match(LATIN_WORD) ?? []) {
      if (en.length < 2 && !en.some((w) => w.join('') === word.slice(0, 4))) en.push([...word.slice(0, 4)]);
    }
    if (ko.length === 2 && en.length === 2) break;
  }
  const creator = items.flatMap((i) => i.creators).find((c) => [...c.replace(/\s/gu, '')].length >= 2);
  return [
    ...(ko[0] ? [{ group: 'ko' as const, chars: ko[0] }, { group: 'initials' as const, chars: ko[0].slice(0, 2).map(initialOf) }] : []),
    ...(ko[1] ? [{ group: 'ko' as const, chars: ko[1] }] : []),
    ...en.map((chars) => ({ group: 'en' as const, chars })),
    ...(creator ? [{ group: 'creator' as const, chars: [...creator.replace(/\s/gu, '')].slice(0, 2) }] : []),
  ];
}

/**
 * Two more typed steps for a library with the organise fixture: the first two characters of a tag name (the quick search
 * reads tag names) and of a top-level collection name (the palette lists collections). The fixture names the first two of
 * each so they share a first character and differ in the second: the second input narrows the result, so every input
 * redraws the rows the test waits for.
 */
export function organizeSteps(names: { tag: string; collection: string }): { tag: SearchStep[]; collection: SearchStep[] } {
  const two = (name: string) => [...name.replace(/\s/gu, '')].slice(0, 2);
  return { tag: [{ group: 'tag', chars: two(names.tag) }], collection: [{ group: 'collection', chars: two(names.collection) }] };
}
