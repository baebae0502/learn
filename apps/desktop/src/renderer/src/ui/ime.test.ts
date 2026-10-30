import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { keyCommand } from '../commands/keymap';
import { gridKey } from '../library/gridKeys';
import { isComposingKey } from './ime';

describe('the one IME composition predicate (ADR-0005 §3)', () => {
  it('a DOM key event: isComposing, or the keyCode 229 macOS IMEs send without it', () => {
    expect(isComposingKey({ keyCode: 13, isComposing: true })).toBe(true);
    expect(isComposingKey({ keyCode: 229, isComposing: false })).toBe(true);
    expect(isComposingKey({ keyCode: 229 })).toBe(true);
    expect(isComposingKey({ keyCode: 13, isComposing: false })).toBe(false);
  });
  it('a React key event keeps isComposing on its native event', () => {
    expect(isComposingKey({ keyCode: 13, nativeEvent: { isComposing: true } })).toBe(true);
    expect(isComposingKey({ keyCode: 229, nativeEvent: { isComposing: false } })).toBe(true);
    expect(isComposingKey({ keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false);
  });

  const KEY = { code: 'ArrowDown', key: 'ArrowDown', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, keyCode: 40, isComposing: false } as const;
  it('the table keys and the key map act on no key a composition owns, and on the same key without it', () => {
    expect(gridKey({ ...KEY, isComposing: true }, true)).toBeNull();
    expect(gridKey({ ...KEY, keyCode: 229 }, true)).toBeNull();
    expect(gridKey(KEY, true)).toEqual({ kind: 'move', to: 'down', extend: false });
    const F6 = { ...KEY, code: 'F6', key: 'F6', keyCode: 117 };
    expect(keyCommand({ ...F6, isComposing: true }, false)).toBeNull();
    expect(keyCommand({ ...F6, keyCode: 229 }, false)).toBeNull();
    expect(keyCommand(F6, false)).toBe('view.nextPane');
  });

  it('no other renderer source tests for keyCode 229 itself: a copy of the check would drift', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const copies: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'ime.ts' && /keyCode\s*===?\s*229/.test(fs.readFileSync(p, 'utf8'))) copies.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(copies).toEqual([]);
  });
});
