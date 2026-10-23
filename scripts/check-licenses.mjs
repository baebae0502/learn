#!/usr/bin/env node
// Fails when a package Learn ships has a licence outside the allow-list (final review m10). CI runs it (ci.yml).
//
//   node scripts/check-licenses.mjs          check, and list what was checked
//   node scripts/check-licenses.mjs --table  also print the README table rows (one row per package family)
//
// Shipped: apps/desktop's dependencies (loaded by main at run time), and its devDependencies that Vite bundles into
// main and the renderer (react, react-aria-components, pdfjs-dist, zod through @learn/domain, …), each with
// everything it depends on. Not shipped: the build tools (TOOLING), type packages, and NOT_SHIPPED's subtrees. Electron
// is shipped as the runtime itself: its own licence is checked, not its npm dependencies (they download it). The
// workspace packages are Learn's own (AGPL-3.0-or-later); only what they depend on is checked.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Permissive licences (final review m10). In use when it was written: MIT, Apache-2.0, ISC, OFL-1.1 (Pretendard), 0BSD (tslib). */
export const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'OFL-1.1']);
const TOOLING = new Set(['electron-vite', 'vite', '@vitejs/plugin-react']);
const RUNTIME_ONLY = new Set(['electron']);
const NOT_SHIPPED = new Map([['@napi-rs/canvas', "pdf.js's optional canvas for Node; the renderer draws on the browser's"]]);

/**
 * Whether an SPDX expression is allowed: OR needs one allowed side, AND both, `X WITH exception` follows X (an
 * exception only grants more). An unparsable or missing expression is not allowed.
 */
export function licenceAllowed(expression, allowed = ALLOWED) {
  if (typeof expression !== 'string' || !expression.trim()) return false;
  const tokens = expression.replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let i = 0;
  const atom = () => {
    const t = tokens[i++];
    if (t === '(') {
      const v = or();
      if (tokens[i++] !== ')') throw new Error('unbalanced');
      return v;
    }
    if (!t || t === ')' || /^(AND|OR|WITH)$/.test(t)) throw new Error(`unexpected ${t}`);
    if (tokens[i] === 'WITH') i += 2;
    return allowed.has(t.replace(/\+$/, ''));
  };
  const and = () => {
    let v = atom();
    while (tokens[i] === 'AND') {
      i++;
      v = atom() && v;
    }
    return v;
  };
  const or = () => {
    let v = and();
    while (tokens[i] === 'OR') {
      i++;
      v = and() || v;
    }
    return v;
  };
  try {
    const v = or();
    return i === tokens.length && v;
  } catch {
    return false;
  }
}

/** The licence a package declares: `license`, or the old `licenses: [{ type }]` joined by OR. */
export function declaredLicence(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ') || null;
  return null;
}

/** Every shipped package in a `pnpm list --json --depth Infinity` entry for apps/desktop: name → { versions, licence }. */
export function shippedPackages(desktop, readManifest) {
  const found = new Map();
  const seen = new Set();
  const add = (name, entry) => {
    const pkg = readManifest(entry.path);
    const row = found.get(name) ?? { versions: new Set(), licences: new Set() };
    row.versions.add(entry.version);
    row.licences.add(declaredLicence(pkg) ?? 'UNKNOWN');
    found.set(name, row);
  };
  const walk = (name, entry) => {
    if (name.startsWith('@types/') || NOT_SHIPPED.has(name) || [...NOT_SHIPPED.keys()].some((k) => name.startsWith(`${k}-`))) return;
    const key = `${name}@${entry.version}`;
    if (seen.has(key)) return;
    seen.add(key);
    const workspace = String(entry.version).startsWith('link:');
    if (!workspace) add(name, entry);
    if (RUNTIME_ONLY.has(name)) return;
    for (const section of ['dependencies', 'optionalDependencies']) for (const [n, e] of Object.entries(entry[section] ?? {})) walk(n, e);
  };
  for (const [n, e] of Object.entries(desktop.dependencies ?? {})) walk(n, e);
  for (const [n, e] of Object.entries(desktop.devDependencies ?? {})) if (!TOOLING.has(n)) walk(n, e);
  return found;
}

/** A package's family for the README: its scope (`@internationalized/*`), or its name. */
const family = (name) => (name.startsWith('@') ? `${name.split('/')[0]}/*` : name);

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = execFileSync('pnpm', ['--filter', '@learn/desktop', 'list', '--json', '--depth', 'Infinity'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  const [desktop] = JSON.parse(out);
  const packages = shippedPackages(desktop, (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')));
  const refused = [];
  for (const [name, row] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const versions = [...row.versions].join(', ');
    for (const licence of row.licences) {
      const ok = licenceAllowed(licence);
      if (!ok) refused.push(`${name}@${versions}: ${licence}`);
      console.log(`${ok ? 'ok     ' : 'REFUSED'} ${name}@${versions} ${licence}`);
    }
  }
  if (process.argv.includes('--table')) {
    const families = new Map();
    for (const [name, row] of packages) {
      const f = families.get(family(name)) ?? { names: new Set(), versions: new Set(), licences: new Set() };
      f.names.add(name);
      row.versions.forEach((v) => f.versions.add(v));
      row.licences.forEach((l) => f.licences.add(l));
      families.set(family(name), f);
    }
    console.log('\n| 패키지 | 버전 | 라이선스 |\n|---|---|---|');
    for (const [f, row] of [...families].sort(([a], [b]) => a.replace(/^@/, '').localeCompare(b.replace(/^@/, '')))) {
      const many = row.names.size > 1;
      const versions = many ? `${[...row.versions].sort().join(', ')} (${row.names.size}개)` : [...row.versions].join(', ');
      console.log(`| ${many ? f : [...row.names][0]} | ${versions} | ${[...row.licences].join(', ')} |`);
    }
  }
  console.log(`\n${packages.size} shipped packages checked; allowed: ${[...ALLOWED].join(', ')}`);
  if (refused.length) {
    console.error(`\nLicences outside the allow-list:\n  ${refused.join('\n  ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
