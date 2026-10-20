// Copies pdf.js runtime data (CJK cmaps, standard fonts, wasm decoders, ICC profiles) into the renderer public dir.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const dest = path.join(here, '../src/renderer/public/pdfjs');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(path.join(pdfjsRoot, dir), path.join(dest, dir), { recursive: true });
}
console.log(`pdf.js assets → ${path.relative(process.cwd(), dest)}`);
