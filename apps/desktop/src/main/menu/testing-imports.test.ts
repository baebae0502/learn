import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MAIN = path.resolve(__dirname, '..');
/** An import of a testing module: `from './testing'`, a side-effect `import './testing'`, `import('./testing')`, `require('./testing')`. */
const TESTING_IMPORT = /(?:from\s+|import\s*\(?\s*|require\(\s*)['"][^'"]*\/testing(?:\.[jt]s)?['"]/;

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
  // The strings check skips main/menu/testing.ts (its Korean is sample data, not screen copy): that is only safe while
  // nothing shipped can import it.
  it('no non-test source of main imports a testing module', () => {
    const files = sources(MAIN);
    expect(files.length).toBeGreaterThan(10);
    const importing = files.filter((f) => !/(^|\/)testing\.ts$/.test(f) && TESTING_IMPORT.test(fs.readFileSync(path.join(MAIN, f), 'utf8')));
    expect(importing).toEqual([]);
  });
  it('the check can fail: the same pattern finds each way of importing one', () => {
    for (const code of ["import { LIBRARY } from './testing';", "import { x } from '../menu/testing.js';", "import './testing';", "await import('./testing')", "require('./testing')"]) {
      expect(TESTING_IMPORT.test(code), code).toBe(true);
    }
    expect(TESTING_IMPORT.test("import { x } from './testing-imports';")).toBe(false);
  });
});
