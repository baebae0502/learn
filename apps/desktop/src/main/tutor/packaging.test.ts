import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DESKTOP = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(DESKTOP, 'src', 'main');
const FAKE_OUT = 'out/main/fake-agent.js';

/** The list items under a top-level YAML key, as written (quotes kept), read line by line: no YAML parser is a dependency. */
function listUnder(yml: string, key: string): string[] {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${key}:`);
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item) items.push(item[1]!);
  }
  return items;
}

const unquote = (s: string) => s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

describe('the packaged app leaves the fake agent out (J58, AC20)', () => {
  const yml = fs.readFileSync(path.join(DESKTOP, 'electron-builder.yml'), 'utf8');

  it('reads the files and asarUnpack lists (the line reader finds what is there)', () => {
    expect(listUnder(yml, 'files').map(unquote)).toContain('out/**/*');
    expect(listUnder(yml, 'asarUnpack').length).toBeGreaterThan(0);
  });

  it('files: excludes out/main/fake-agent.js after the out/** glob that would take it', () => {
    const files = listUnder(yml, 'files');
    expect(files).toContain(`'!${FAKE_OUT}'`);
    expect(files.map(unquote).indexOf(`!${FAKE_OUT}`)).toBeGreaterThan(files.map(unquote).indexOf('out/**/*'));
  });

  it('asarUnpack: never names the fake agent', () => {
    expect(listUnder(yml, 'asarUnpack').filter((l) => l.includes('fake-agent'))).toEqual([]);
  });

  it('the main build makes the file the exclusion names: its own entry, fake-agent → out/main/fake-agent.js', () => {
    const config = fs.readFileSync(path.join(DESKTOP, 'electron.vite.config.ts'), 'utf8');
    expect(config).toMatch(/'fake-agent':\s*fileURLToPath\(new URL\('src\/main\/tutor\/fake-agent\/fake-agent\.ts', import\.meta\.url\)\)/);
  });

  it('nothing main ships imports the fake as a value: a type import only, so it stays out of index.js', () => {
    const valueImports = (code: string) =>
      [...code.matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']*fake-agent[^']*)'/g)].filter((m) => m[1] === undefined).map((m) => m[2]!);
    // The matcher itself: a value import is caught, a type import is not.
    expect(valueImports(`import { FAKE_SCRIPTS } from './fake-agent/fake-agent';\nimport type { FakeScript } from './fake-agent/fake-agent';`))
      .toEqual(['./fake-agent/fake-agent']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (p !== path.join(MAIN, 'tutor', 'fake-agent')) walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(e.name) || /\.test\.tsx?$/.test(e.name)) continue;
        for (const from of valueImports(fs.readFileSync(p, 'utf8'))) offenders.push(`${path.relative(DESKTOP, p)}: ${from}`);
      }
    };
    walk(MAIN);
    expect(offenders).toEqual([]);
  });
});
