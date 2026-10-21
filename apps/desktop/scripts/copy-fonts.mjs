#!/usr/bin/env node
// Copies the bundled UI font (Pretendard Variable, SIL OFL 1.1) and its licence from the
// pinned `pretendard` devDependency into design/fonts/. The copies are committed so the
// mockups and the app work from a clean checkout; rerun after bumping the package.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('pretendard/package.json'));
const outDir = path.resolve(here, '../src/renderer/src/design/fonts');
mkdirSync(outDir, { recursive: true });

const files = [
  ['dist/web/variable/woff2/PretendardVariable.woff2', 'PretendardVariable.woff2'],
  ['dist/LICENSE.txt', 'Pretendard-LICENSE.txt'],
];
for (const [from, to] of files) {
  copyFileSync(path.join(pkgDir, from), path.join(outDir, to));
  console.log(`copied ${to}`);
}
