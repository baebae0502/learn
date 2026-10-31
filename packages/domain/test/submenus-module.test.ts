import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
// submenus.ts first on purpose: the one load order no other file uses (index.ts loads commands.ts first). Either module
// has to be able to load before the other.
import { SUBMENUS, SUBMENU_SOURCES, submenuProblems, type SubmenuSource, type SubmenuSpec } from '../src/submenus';
import * as registry from '../src/commands';
import * as domain from '../src/index';
import { COLOR_SLOTS } from '../src/tag-colors';

describe('submenus.ts holds the registry\'s submenu definitions (E1)', () => {
  it('loads before the registry and holds the colour group and the value-submenu sources', () => {
    expect(SUBMENUS.map((s) => s.id)).toEqual(['colorTags']);
    expect(SUBMENUS[0]!.commands).toEqual(COLOR_SLOTS.map((n) => `tag.color${n}`));
    expect(Object.keys(SUBMENU_SOURCES).sort()).toEqual(['collections', 'sortColumns', 'tagColors']);
    expect(submenuProblems(registry.COMMANDS, SUBMENUS)).toEqual([]);
  });

  it('is what commands.ts and the package index export: the same bindings, not copies', () => {
    expect(registry.SUBMENUS).toBe(SUBMENUS);
    expect(registry.SUBMENU_SOURCES).toBe(SUBMENU_SOURCES);
    expect(registry.submenuProblems).toBe(submenuProblems);
    expect(domain.SUBMENUS).toBe(SUBMENUS);
    expect(registry.COLOR_SLOTS).toBe(COLOR_SLOTS);
    expect(domain.COLOR_SLOTS).toBe(COLOR_SLOTS);
    const source: SubmenuSource = 'collections';
    const spec: SubmenuSpec = SUBMENUS[0]!;
    expect([source, spec.id]).toEqual(['collections', 'colorTags']);
  });

  it('leaves only the re-export in commands.ts', () => {
    const hub = fs.readFileSync(new URL('../src/commands.ts', import.meta.url), 'utf8');
    for (const definition of [
      /export const SUBMENUS\b/, /export const SUBMENU_SOURCES\b/, /export function submenuProblems\b/,
      /export interface SubmenuSpec\b/, /export type SubmenuSource\b/, /export const COLOR_SLOTS\b/,
    ]) {
      expect(hub, String(definition)).not.toMatch(definition);
    }
    expect(hub).toMatch(/^export \* from '\.\/submenus';$/m);
  });
});
