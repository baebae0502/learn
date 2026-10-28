import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

/** A module's import name: the file name without its last extension (`TagDots.tsx` → `TagDots`, `x.test.ts` → `x.test`). */
const stem = (file: string): string => file.replace(/\.[^.]+$/, '');

/**
 * Files in one directory whose import names differ only by case. macOS volumes are case-insensitive by default, so an
 * import of `./TagDots` there can open `tagDots.ts` (the resolver tries `.ts` before `.tsx`) — the Linux build and tests
 * pass while the Mac build fails.
 */
export function caseCollisions(paths: readonly string[]): string[][] {
  const groups = new Map<string, Set<string>>();
  for (const p of paths) {
    const key = path.posix.join(path.posix.dirname(p), stem(path.posix.basename(p)).toLowerCase());
    const set = groups.get(key) ?? new Set<string>();
    set.add(p);
    groups.set(key, set);
  }
  return [...groups.values()]
    .map((set) => [...set].sort())
    .filter((files) => new Set(files.map((f) => stem(path.posix.basename(f)))).size > 1);
}

describe('no two files differ only by case (macOS volumes are case-insensitive)', () => {
  it('the tracked files have no such pair', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    expect(caseCollisions(files)).toEqual([]);
  });
  it('the check can fail: a component beside a module of the same name in another case', () => {
    expect(caseCollisions(['r/tags/TagDots.tsx', 'r/tags/tagDots.ts', 'r/tags/tagDots.test.ts', 'r/ui/Notice.tsx', 'r/ui/notice.test.ts', 'r/a/x.ts', 'r/b/X.ts'])).toEqual([
      ['r/tags/TagDots.tsx', 'r/tags/tagDots.ts'],
    ]);
  });
});
