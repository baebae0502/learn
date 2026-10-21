import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@learn/domain';
import { t } from './index';

/** Every string reachable from `t` (functions are called with sample arguments), plus the command labels. */
function collect(node: unknown, at: string, out: Array<{ at: string; text: string }>): void {
  if (typeof node === 'string') out.push({ at, text: node });
  else if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => unknown;
    collect(fn(...Array.from({ length: fn.length }, () => 3)), `${at}()`, out);
  } else if (Array.isArray(node)) node.forEach((v, i) => collect(v, `${at}[${i}]`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) collect(v, `${at}.${k}`, out);
}
const copy: Array<{ at: string; text: string }> = [];
collect(t, 't', copy);
for (const c of COMMANDS) copy.push({ at: `command ${c.id}`, text: c.label });

// Same rules as the mockups' copyLint (docs/design/mockups/assets/mockup.js).
const DETERMINER = /(?:^|[\s(‘“])(이|그|저|새|다른|각|모든|어느) (?=[가-힣])/;
const COMPOUNDS = ['쪽 번호', '디스크 공간', '필기와 태그', '지운 것', '새 위치', 'G 단백질', '새 컬렉션', '어느 쪽'];
const INTERNAL = /SHA-256|해시|staging|관리형|경로만 기록/;
const show = (s: { at: string; text: string }) => `${s.at}: ${s.text}`;

describe('UI copy (design-spec 4, 9)', () => {
  it('binds determiner + noun and the listed compounds with U+00A0', () => {
    expect(copy.filter((s) => DETERMINER.test(s.text) || COMPOUNDS.some((c) => s.text.includes(c))).map(show)).toEqual([]);
  });
  it('uses 합니다체, never 해요체', () => {
    // The polite imperative "-세요" (다시 시도하세요, 다시 가져오세요) is 합니다체 here: design-spec 9 and 6 use it, and so
    // do the mockups (SDD ruling C-3/R-7). Every other sentence-final 요 (해요, 돼요, 있어요, 거예요 …) is 해요체.
    expect(copy.filter((s) => /(?<!세)요[.!?]?(\s|$)/.test(s.text) && !s.text.includes('필요')).map(show)).toEqual([]);
  });
  it('has no internal jargon', () => {
    expect(copy.filter((s) => INTERNAL.test(s.text)).map(show)).toEqual([]);
  });
  it('no renderer source shows a phase placeholder such as "P3 단계"', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        // strings/legacy.ts belongs to the pre-M3 screens and is deleted in Task 7.
        else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts') && e.name !== 'legacy.ts') files.push(p);
      }
    };
    walk(root);
    expect(files.filter((f) => /P[0-9]\s*단계/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f))).toEqual([]);
  });
});
