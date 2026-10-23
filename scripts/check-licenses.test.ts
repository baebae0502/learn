import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs script, no declarations
import { declaredLicence, licenceAllowed, shippedPackages } from './check-licenses.mjs';

describe('the shipped-licence check (final review m10)', () => {
  it('reads SPDX expressions: OR needs one allowed side, AND both; unknown or missing is refused', () => {
    expect(licenceAllowed('MIT')).toBe(true);
    expect(licenceAllowed('OFL-1.1')).toBe(true);
    expect(licenceAllowed('(MIT OR CC0-1.0)')).toBe(true);
    expect(licenceAllowed('WTFPL OR ISC')).toBe(true);
    expect(licenceAllowed('(MIT AND Zlib)')).toBe(false);
    expect(licenceAllowed('Apache-2.0 WITH LLVM-exception')).toBe(true);
    expect(licenceAllowed('MPL-2.0')).toBe(false);
    expect(licenceAllowed('GPL-3.0-or-later')).toBe(false);
    expect(licenceAllowed('UNKNOWN')).toBe(false);
    expect(licenceAllowed('')).toBe(false);
    expect(licenceAllowed('(MIT')).toBe(false);
    expect(declaredLicence({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(declaredLicence({})).toBeNull();
  });

  it('walks the shipped tree: dependencies, bundled devDependencies and their trees; not the tools, types, Electron\'s downloader or our own packages', () => {
    const leaf = (version: string, extra: object = {}) => ({ version, path: `/nm/${version}`, ...extra });
    const desktop = {
      dependencies: { 'better-sqlite3': leaf('13', { dependencies: { 'node-addon-api': leaf('8') } }) },
      devDependencies: {
        '@learn/domain': { version: 'link:../../packages/domain', path: '/ws/domain', dependencies: { zod: leaf('4') } },
        'react-dom': leaf('19', { dependencies: { scheduler: leaf('0.28'), '@types/react': leaf('t') } }),
        'pdfjs-dist': leaf('6', { optionalDependencies: { '@napi-rs/canvas': leaf('n'), '@napi-rs/canvas-darwin-arm64': leaf('n2') } }),
        electron: leaf('44', { dependencies: { '@electron/get': leaf('g') } }),
        vite: leaf('8', { dependencies: { rollup: leaf('r') } }),
      },
    };
    const licences: Record<string, string> = { '/nm/13': 'MIT', '/nm/8': 'MIT', '/nm/4': 'MIT', '/nm/19': 'MIT', '/nm/0.28': 'MIT', '/nm/6': 'Apache-2.0', '/nm/44': 'MIT' };
    const found = shippedPackages(desktop, (dir: string) => ({ license: licences[dir] ?? 'GPL-3.0' }));
    expect([...found.keys()].sort()).toEqual(['better-sqlite3', 'electron', 'node-addon-api', 'pdfjs-dist', 'react-dom', 'scheduler', 'zod']);
  });
});
