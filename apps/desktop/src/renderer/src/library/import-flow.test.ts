import { describe, expect, it, vi } from 'vitest';
import type { ImportOutcome, LibraryItem } from '@learn/domain';
import { failureLines, settleImport } from './import-flow';

const item = (id: string) => ({ id }) as LibraryItem;
const imported = (path: string, id: string): ImportOutcome => ({ status: 'imported', path, item: item(id) });
const dup = (path: string, existingItemId: string): ImportOutcome => ({ status: 'duplicate', path, existingItemId });
const failed = (path: string, message: string): ImportOutcome => ({ status: 'failed', path, code: 'UNSUPPORTED_TYPE', message });

describe('settleImport', () => {
  it('counts imports and failures and asks about each duplicate in order', async () => {
    const confirm = vi.fn().mockResolvedValueOnce('skip').mockResolvedValueOnce('add');
    const importAgain = vi.fn().mockResolvedValue([imported('/b.pdf', 'n2')]);
    const report = await settleImport([imported('/a.pdf', 'n1'), dup('/x.pdf', 'e1'), dup('/b.pdf', 'e2'), failed('/dir/notes.txt', '지원하지 않는 형식입니다.')], 'managed', { confirm, importAgain });
    expect(confirm.mock.calls.map((c) => c[0])).toEqual([{ path: '/x.pdf', existingItemId: 'e1' }, { path: '/b.pdf', existingItemId: 'e2' }]);
    expect(importAgain).toHaveBeenCalledExactlyOnceWith('/b.pdf', 'managed');
    expect(report).toEqual({ imported: 2, failed: [{ name: 'notes.txt', message: '지원하지 않는 형식입니다.' }], openItemId: null });
  });
  it('remembers the existing item to open', async () => {
    const report = await settleImport([dup('/x.pdf', 'e1')], 'linked', { confirm: async () => 'open', importAgain: vi.fn() });
    expect(report.openItemId).toBe('e1');
    expect(report.imported).toBe(0);
  });
});

describe('failureLines', () => {
  it('lists up to three files and counts the rest', () => {
    const f = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.txt`, message: '지원하지 않는 형식입니다.' }));
    expect(failureLines(f)).toBe('a.txt: 지원하지 않는 형식입니다.\nb.txt: 지원하지 않는 형식입니다.\nc.txt: 지원하지 않는 형식입니다.\n외 2개');
    expect(failureLines(f.slice(0, 1))).toBe('a.txt: 지원하지 않는 형식입니다.');
  });
});
