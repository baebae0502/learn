#!/usr/bin/env node
// Renders the design mockups (docs/design/mockups) with this repo's Electron at
// 1440×900 @2x into docs/design/renders/<name>.png (git-ignored) and writes the
// contact sheets docs/design/contact-sheet-base.jpg / contact-sheet-variants.jpg.
//
//   pnpm mockups:render                 all (28 base + variants) and contact sheets
//   pnpm mockups:render -- --only reader-pdf      renders whose name contains the text
//   pnpm mockups:render -- --base       only the 28 base renders
//   pnpm mockups:render -- --scale 1    1× (faster, for quick checks)
//
// On Linux the script re-runs itself under its own `xvfb-run` with a 2880×1800 screen
// (a 1440×900 window at device scale 2 must fit on the screen, or Electron clamps it).
// Set MOCKUP_USE_DISPLAY=1 to use the current display instead.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL, BASE, LAYOUTS, SCREENS, THEMES, VARIANTS } from './mockups/manifest.mjs';
import { ROOT, contactSheet, renderMockups } from './mockups/render.mjs';

const self = fileURLToPath(import.meta.url);
if (process.platform === 'linux' && !process.env.MOCKUP_USE_DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 2880x1800x24', process.execPath, ...process.execArgv, self, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, MOCKUP_USE_DISPLAY: '1' },
  });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only');
const scale = Number(opt('--scale') ?? 2);
let renders = args.includes('--base') ? BASE : ALL;
if (only) renders = renders.filter((r) => r.name.includes(only));
const outDir = path.join(ROOT, 'docs/design/renders');

console.log(`rendering ${renders.length} mockups at ${scale}× → ${path.relative(ROOT, outDir)}/`);
const t0 = Date.now();
const results = await renderMockups({ renders, outDir, scale, log: console.log });
const noFont = results.filter((r) => !r.pretendard);
if (noFont.length) console.warn(`warning: Pretendard not loaded in ${noFont.map((r) => r.name).join(', ')}`);
console.log(`rendered ${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const fontSets = [...new Set(results.map((r) => r.fonts.join(', ')))];
console.log(`platform fonts for UI text: ${fontSets.join(' | ')}`);
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ platform: process.platform, scale, results }, null, 2));
// Milestone coverage: every interactive element must sit inside a data-ms (design-spec 10, rubric 8).
const uncovered = results.filter((r) => r.milestones.missing.length);
for (const r of uncovered) console.warn(`milestone coverage: ${r.name}: ${r.milestones.missing.length} untagged → ${r.milestones.missing.slice(0, 5).join('; ')}`);
const catalogue = new Map();
for (const r of results) for (const t of r.milestones.tagged) catalogue.set(`${t.ms} ${t.label}`, t);
writeFileSync(path.join(outDir, 'milestones.txt'), [...catalogue.keys()].sort().join('\n') + '\n');
console.log(`milestones: ${catalogue.size} tagged elements (docs/design/renders/milestones.txt), ${uncovered.length} renders with untagged controls`);

const complete = !only && renders === ALL;
if (complete || args.includes('--sheets')) {
  const file = (name) => path.join(outDir, `${name}.png`);
  const baseItems = SCREENS.flatMap(([screen, label]) =>
    THEMES.flatMap((theme) => LAYOUTS.map((layout) => ({ file: file(`${screen}-${theme}-${layout}`), label: `${label} · ${theme === 'light' ? '라이트' : '다크'} · 레이아웃 ${layout}` }))),
  );
  await contactSheet({
    title: 'Learn M1 목업 — 기본 28장',
    subtitle: '열: 라이트 A · 라이트 B · 다크 A · 다크 B. 1440×900 @2x 렌더를 축소. Linux 렌더이므로 글꼴은 Pretendard(맥에서는 SF + Apple SD Gothic Neo).',
    items: baseItems,
    columns: 4,
    out: path.join(ROOT, 'docs/design/contact-sheet-base.jpg'),
  });
  await contactSheet({
    title: 'Learn M1 목업 — 상태 변형',
    subtitle: '드롭 오버레이, 밀도, PDF 쪽 색·메뉴·목차, 마일스톤 표시, 대화상자 장면.',
    items: VARIANTS.map((v) => ({ file: file(v.name), label: v.label })),
    columns: 4,
    out: path.join(ROOT, 'docs/design/contact-sheet-variants.jpg'),
  });
  console.log('contact sheets: docs/design/contact-sheet-base.jpg, docs/design/contact-sheet-variants.jpg');
}
