// Render core for the design mockups: launches this repo's Electron with the render-only
// main (render-main.mjs) through Playwright's `_electron`, loads each mockup from file://
// and saves a PNG. Also builds contact sheets (JPEG). Used by scripts/render-mockups.mjs
// and tests/evidence/mockups.evidence.ts.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const MOCKUPS_DIR = path.join(ROOT, 'docs/design/mockups');
const MAIN = path.join(here, 'render-main.mjs');

function electronPath() {
  const require = createRequire(path.join(ROOT, 'apps/desktop/package.json'));
  return /** @type {string} */ (require('electron'));
}

/**
 * @param {{ scale?: number, width?: number, height?: number }} [opts]
 */
export async function launch({ scale = 2, width = 1440, height = 900 } = {}) {
  const app = await electron.launch({
    executablePath: electronPath(),
    args: [MAIN],
    env: { ...process.env, MOCKUP_SCALE: String(scale), MOCKUP_WIDTH: String(width), MOCKUP_HEIGHT: String(height) },
  });
  const page = await app.firstWindow();
  const size = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
  if (size[0] !== width || size[1] !== height || size[2] !== scale) {
    await app.close();
    throw new Error(
      `render window is ${size[0]}×${size[1]} @${size[2]}x, expected ${width}×${height} @${scale}x — ` +
        `the display is too small (needs ${width * scale}×${height * scale} px). On Linux let the script start its own xvfb.`,
    );
  }
  return { app, page };
}

/**
 * Fonts Chromium actually used for the text of the first node matching `selector`
 * (CDP CSS.getPlatformFontsForNode) — proves SF / Apple SD Gothic Neo vs Pretendard.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
export async function platformFonts(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return [];
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((f) => `${f.familyName} (${f.glyphCount})`);
  } finally {
    await cdp.detach();
  }
}

/**
 * Render a list of mockups into `outDir` as `<name>.png`.
 * @param {{ renders: import('./manifest.mjs').Render[], outDir: string, scale?: number, log?: (s: string) => void }} opts
 * @returns {Promise<{ name: string, file: string, ms: number, pretendard: boolean, fonts: string[] }[]>}
 */
export async function renderMockups({ renders, outDir, scale = 2, log = () => {} }) {
  mkdirSync(outDir, { recursive: true });
  const { app, page } = await launch({ scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const results = [];
  try {
    for (const r of renders) {
      const started = Date.now();
      await app.evaluate(({ nativeTheme }, theme) => {
        nativeTheme.themeSource = /** @type {'light' | 'dark'} */ (theme);
      }, r.query['theme'] ?? 'system');
      const url = pathToFileURL(path.join(MOCKUPS_DIR, r.page));
      url.search = new URLSearchParams(r.query).toString();
      errors.length = 0;
      await page.goto(url.href);
      await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1', null, { timeout: 15_000 });
      // Two frames so layout-dependent badges and fonts settle.
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(null)))));
      const pretendard = await page.evaluate(() => document.fonts.check('13px "Pretendard Variable"', '가'));
      if (errors.length) throw new Error(`${r.name}: page errors:\n${errors.join('\n')}`);
      const fonts = await platformFonts(page, '.tab.is-active .title');
      const file = path.join(outDir, `${r.name}.png`);
      await page.screenshot({ path: file, type: 'png' });
      const ms = Date.now() - started;
      results.push({ name: r.name, file, ms, pretendard, fonts });
      log(`  ${r.name}.png  ${ms} ms`);
    }
  } finally {
    await app.close();
  }
  return results;
}

/**
 * Compose PNG renders into one JPEG contact sheet.
 * @param {{ title: string, subtitle: string, items: { file: string, label: string }[], columns: number, out: string, cell?: number }} opts
 */
export async function contactSheet({ title, subtitle, items, columns, out, cell = 520 }) {
  const dir = path.dirname(items[0]?.file ?? out);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
  <link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'apps/desktop/src/renderer/src/design/fonts.css')).href}">
  <style>
    html,body{margin:0;background:#e9ebee;color:#1a1d21;font:13px/18px "Pretendard Variable",sans-serif;-webkit-font-smoothing:antialiased}
    header{padding:24px 24px 8px}
    h1{margin:0;font-size:22px;line-height:28px;font-weight:600}
    p{margin:4px 0 0;color:#54595e}
    .grid{display:grid;grid-template-columns:repeat(${columns},${cell}px);gap:20px 16px;padding:16px 24px 28px}
    figure{margin:0}
    img{display:block;width:${cell}px;height:${Math.round((cell * 900) / 1440)}px;border-radius:6px;box-shadow:0 0 0 0.5px rgb(0 0 0/.2),0 2px 8px rgb(0 0 0/.12)}
    figcaption{margin-top:6px;font-size:12px;color:#54595e}
  </style></head><body>
  <header><h1>${title}</h1><p>${subtitle}</p></header>
  <div class="grid">${items.map((i) => `<figure><img src="${pathToFileURL(i.file).href}"><figcaption>${i.label}</figcaption></figure>`).join('')}</div>
  </body></html>`;
  const htmlFile = path.join(dir, `.sheet-${path.basename(out, '.jpg')}.html`);
  writeFileSync(htmlFile, html);
  const { app, page } = await launch({ scale: 1 });
  try {
    await page.goto(pathToFileURL(htmlFile).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    await page.screenshot({ path: out, type: 'jpeg', quality: 82, fullPage: true });
  } finally {
    await app.close();
  }
}
