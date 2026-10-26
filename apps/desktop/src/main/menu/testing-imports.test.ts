import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = path.resolve(__dirname, '..');

/** Every non-test source of main, as paths relative to it. */
function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(path.relative(MAIN, p));
  }
  return out;
}

describe('test helpers stay out of the shipped code', () => {
  // The strings check skips testing.ts files (their Korean is sample data, not screen copy): that is only safe while
  // nothing shipped can import one.
  it('no non-test source of main imports a testing module', () => {
    const files = sources(MAIN);
    expect(files.length).toBeGreaterThan(10);
    const importing = files.filter((f) => !/(^|\/)testing\.ts$/.test(f) && /from\s+['"][^'"]*\/testing(\.[jt]s)?['"]|import\(\s*['"][^'"]*\/testing(\.[jt]s)?['"]\s*\)|require\(\s*['"][^'"]*\/testing(\.[jt]s)?['"]\s*\)/.test(fs.readFileSync(path.join(MAIN, f), 'utf8')));
    expect(importing).toEqual([]);
  });
  it('the check can fail: a source that imports one is found by the same pattern', () => {
    const pattern = /from\s+['"][^'"]*\/testing(\.[jt]s)?['"]/;
    expect(pattern.test("import { LIBRARY } from './testing';")).toBe(true);
    expect(pattern.test("import { x } from '../menu/testing.js';")).toBe(true);
    expect(pattern.test("import { x } from './testing-imports';")).toBe(false);
  });
});
