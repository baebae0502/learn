import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = path.join(dir, '..', 'design', 'tokens.css');
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : []));
const files = walk(path.join(dir, '..'));
const sources = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(d, e.name)) : /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [path.join(d, e.name)] : []));
/** Properties the library sets itself on a popover (react-aria-components), not declared in any of our files. */
const LIBRARY_PROPERTIES = ['--trigger-width'];
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('renderer CSS custom properties', () => {
  it('every var(--x) without a fallback resolves to a token or to a property some CSS declares', () => {
    const declared = new Set<string>();
    for (const f of files) for (const m of strip(fs.readFileSync(f, 'utf8')).matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]!);
    // Set from the components' inline styles ('--row-cols': …) or by the UI library.
    for (const f of sources(path.join(dir, '..'))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) declared.add(m[1]!);
    for (const p of LIBRARY_PROPERTIES) declared.add(p);
    expect(fs.existsSync(tokensCss)).toBe(true);
    const missing: string[] = [];
    for (const f of files) {
      const text = strip(fs.readFileSync(f, 'utf8'));
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
        if (m[2] === ',') continue; // a fallback is given
        if (!declared.has(m[1]!)) missing.push(`${path.relative(dir, f)}: ${m[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
