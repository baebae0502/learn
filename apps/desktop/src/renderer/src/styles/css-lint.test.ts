import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.dirname(fileURLToPath(import.meta.url));
const LAYERS = ['reset', 'tokens', 'base', 'components', 'screens', 'utilities'];

function cssFiles(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : [],
  );
}
const layered = cssFiles(dir).filter((f) => path.basename(f) !== 'layers.css');
const rel = (f: string) => path.relative(dir, f);
const withoutComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('renderer CSS architecture', () => {
  it('declares the cascade layer order once, imported before the tokens', () => {
    const order = /@layer ([^;]+);/.exec(fs.readFileSync(path.join(dir, 'layers.css'), 'utf8'))?.[1]?.split(',').map((s) => s.trim());
    expect(order).toEqual(LAYERS);
    const index = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
    expect(index.indexOf("import './layers.css';")).toBe(index.search(/import /));
    expect(index.indexOf("import './layers.css';")).toBeLessThan(index.indexOf("import '../design/tokens.css';"));
  });

  it.each(layered.map((f) => [rel(f), f]))('%s puts every rule inside one known layer', (_name, file) => {
    const body = withoutComments(fs.readFileSync(file, 'utf8')).trim();
    const layer = /^@layer ([a-z]+) \{/.exec(body)?.[1];
    expect(layer && LAYERS.includes(layer)).toBe(true);
    expect(body.endsWith('}')).toBe(true);
    // Exactly one top-level block: braces balance only at the very end.
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '{') depth++;
      if (body[i] === '}') depth--;
      if (depth === 0 && i > body.indexOf('{') && i < body.length - 1) throw new Error(`${rel(file)}: rule outside the layer at offset ${i}`);
    }
  });

  it.each(layered.map((f) => [rel(f), f]))('%s takes colours and type sizes from tokens (literals only on /* local */ lines)', (_name, file) => {
    const offenders = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => !line.includes('local'))
      .filter(({ line }) => {
        const code = line.replace(/\/\*.*?\*\//g, '');
        return /#[0-9a-fA-F]{3,8}\b/.test(code) || /\b(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/.test(code) || /\bfont(-size)?\s*:[^;]*\b\d+(\.\d+)?px/.test(code) || /font-weight\s*:\s*(700|800|900|bold)/.test(code) ||
          // Semibold comes from --weight-semibold (tokens.ts fontWeight), never a literal 600 (Task 8 n6).
          /font-weight\s*:\s*600\b/.test(code);
      })
      .map(({ line, n }) => `${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});

/** The declarations of the rule whose selector list holds `selector` (comments dropped, white space folded): a text pin for what no Linux render can show. */
function declarationsOf(file: string, selector: string): string {
  const css = withoutComments(fs.readFileSync(path.join(dir, file), 'utf8'));
  const fold = (t: string) => t.replace(/\s+/g, ' ').trim();
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selectors: fold(m[1]!).split(/,(?![^(]*\))/).map((x) => fold(x)), body: fold(m[2]!) }));
  const found = rules.find((r) => r.selectors.includes(selector));
  if (!found) throw new Error(`${file}: no rule for ${selector}`);
  return found.body;
}

describe('the drop row\'s count colour (dark vibrancy material: nothing fails on Linux when it is lost)', () => {
  const COLOUR = 'color: var(--sidebar-count-selected, var(--text-secondary));';
  it.each([
    ['screens/dnd.css', ".nav-row:is([data-drop-target], [data-force~='drop']) .count"],
    ['screens/dnd.css', ".heading-drop:is([data-drop-target], [data-force~='drop']) .heading-label"],
    ['utilities.css', ':root[data-window-not-main] .sidebar .nav-list .nav-row[data-drop-target] .count'],
    ['utilities.css', ':root[data-window-not-main] .sidebar .heading-drop[data-drop-target] .heading-label'],
  ])('%s: %s takes the selected row\'s count colour, secondary text as the fallback', (file, selector) => {
    expect(declarationsOf(file, selector)).toBe(COLOUR);
  });
});
