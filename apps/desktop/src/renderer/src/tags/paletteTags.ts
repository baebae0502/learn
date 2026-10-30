import { tagSlot, type CommandSpec } from '@learn/domain';
import { t } from '../strings';

/**
 * The palette's colour keys, each named by the tag at its slot — "색 태그 3 · 중요" (spec 4.2). A slot whose tag is not known
 * (yet) is left out; every other command passes unchanged. The copies keep their ids, so a run, the recent list and the
 * ranking are unaffected, and the registry's own labels stay what the menus and the ⌘/ sheet show.
 */
export function tagPaletteCommands(commands: readonly CommandSpec[], nameAt: (slot: number) => string | undefined): CommandSpec[] {
  return commands.flatMap((c): CommandSpec[] => {
    const slot = tagSlot(c.id);
    if (slot === null) return [c];
    const name = nameAt(slot);
    return name === undefined ? [] : [{ ...c, label: t.organize.tags.paletteName(slot, name) }];
  });
}
