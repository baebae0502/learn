import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '@learn/domain';
import { mainStrings } from '../../../main/strings';
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
// Main's own copy module (native dialogs, messages that reach the screen): the same rules as the renderer's (review minor 7).
collect(mainStrings, 'mainStrings', copy);
for (const c of COMMANDS) {
  copy.push({ at: `command ${c.id}`, text: c.label });
  // A toggle's state labels are menu, palette and tooltip names too (P-3).
  for (const [pane, names] of Object.entries(c.stateLabels ?? {})) {
    for (const [state, text] of Object.entries(names ?? {})) copy.push({ at: `command ${c.id} ${pane}.${state}`, text });
  }
}

/** Renderer sources (no tests) under src/, relative paths. */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function sources(): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(path.relative(SRC, p));
    }
  };
  walk(SRC);
  return files.sort();
}
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * 해요체 endings: a sentence-final 요 (있어요, 됐어요, 좋네요, 그렇군요; also before "," or ")") or 죠. The polite
 * imperative "-세요" (다시 시도하세요) is 합니다체 here: design-spec 9 and 6 use it, and so do the mockups (SDD ruling
 * C-3/R-7). Nouns ending in 요 (필요, 중요 …) are removed first, so 필요해요 is still caught.
 */
const YO_NOUNS = /필요|중요|주요|개요|수요/g;
const HAEYO = /(?<!세)요(?=[.!?,)\s]|$)|죠(?=[.!?,)\s]|$)/;
const isHaeyo = (text: string): boolean => HAEYO.test(text.replace(YO_NOUNS, ''));

// Same rules as the mockups' copyLint (docs/design/mockups/assets/mockup.js).
const DETERMINER = /(?:^|[\s(‘“])(이|그|저|새|다른|각|모든|어느) (?=[가-힣])/;
const COMPOUNDS = ['쪽 번호', '디스크 공간', '필기와 태그', '지운 것', '새 위치', 'G 단백질', '새 컬렉션', '어느 쪽', '원본 파일'];
const INTERNAL = /SHA-256|해시|staging|관리형|경로만 기록/;
const show = (s: { at: string; text: string }) => `${s.at}: ${s.text}`;

describe('UI copy (design-spec 4, 9)', () => {
  it('binds determiner + noun and the listed compounds with U+00A0', () => {
    expect(copy.filter((s) => DETERMINER.test(s.text) || COMPOUNDS.some((c) => s.text.includes(c))).map(show)).toEqual([]);
  });
  it('tells 해요체 from 합니다체 and the -세요 imperative', () => {
    expect(['다시 시도하세요.', '선택하세요', '확인하세요, 그다음', '필요합니다.', '중요 표시', '요약', '요청을 보냈습니다.'].filter(isHaeyo)).toEqual([]);
    const haeyo = ['열 수 있어요.', '됐어요', '있어요, 그리고', '(열 수 있어요)', '그렇죠', '그렇죠?', '좋네요', '그렇군요.', '필요해요.', '중요해요'];
    expect(haeyo.filter((s) => !isHaeyo(s))).toEqual([]);
  });
  it('uses 합니다체, never 해요체', () => {
    expect(copy.filter((s) => isHaeyo(s.text)).map(show)).toEqual([]);
  });
  it('has no internal jargon', () => {
    expect(copy.filter((s) => INTERNAL.test(s.text)).map(show)).toEqual([]);
  });
  it('no renderer source shows a phase placeholder such as "P3 단계"', () => {
    expect(sources().filter((f) => /P[0-9]\s*단계/.test(read(f)))).toEqual([]);
  });
});

/**
 * Korean string literals of the main process and the library package (no tests, comments removed first): error
 * messages become toasts and notices, dialog titles, buttons and filter names are on screen too (N-3, C-4).
 */
function mainProcessCopy(): Array<{ at: string; text: string }> {
  const root = path.resolve(SRC, '../../../../..');
  const out: Array<{ at: string; text: string }> = [];
  const literal = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const dir of ['apps/desktop/src/main', 'packages/library/src']) {
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const code = fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
          for (const m of code.matchAll(literal)) {
            const text = m[1] ?? m[2] ?? m[3] ?? '';
            if (/[가-힣]/.test(text)) out.push({ at: path.relative(root, p), text });
          }
        }
      }
    };
    walk(path.join(root, dir));
  }
  return out;
}

describe('main-process and library copy users see (N-3, C-4)', () => {
  const main = mainProcessCopy();
  it('main\'s strings module is collected with the renderer copy (the settings window\'s folder dialog and its checks)', () => {
    const fromMain = copy.filter((s) => s.at.startsWith('mainStrings.'));
    expect(fromMain.map((s) => s.text)).toEqual(expect.arrayContaining(['라이브러리 폴더 선택', '다시 시작', '취소']));
    expect(fromMain.some((s) => s.text.includes('쓸 수 없습니다'))).toBe(true);
  });
  it('finds the copy (the walk reaches both trees)', () => {
    expect(main.some((s) => s.at.startsWith(path.join('apps', 'desktop', 'src', 'main')))).toBe(true);
    expect(main.some((s) => s.at.startsWith(path.join('packages', 'library', 'src')))).toBe(true);
  });
  it('binds determiner + noun and the listed compounds with U+00A0', () => {
    expect(main.filter((s) => DETERMINER.test(s.text) || COMPOUNDS.some((c) => s.text.includes(c))).map(show)).toEqual([]);
  });
  it('uses 합니다체, never 해요체', () => {
    expect(main.filter((s) => isHaeyo(s.text)).map(show)).toEqual([]);
  });
  it('has no internal jargon', () => {
    expect(main.filter((s) => INTERNAL.test(s.text)).map(show)).toEqual([]);
  });
});
