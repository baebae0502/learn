import { describe, expect, it } from 'vitest';
import { filesFromDrop } from './fileDrop';

const file = (name: string) => ({ kind: 'file', getFile: async () => ({ name }) as File });
const PATHS: Record<string, string> = { 'a.pdf': '/Users/me/a.pdf', 'b.mp4': '/Users/me/b.mp4', 'memory.pdf': '' };
const pathForFile = (f: File) => PATHS[f.name] ?? '';

describe('the files of a drop on a sidebar row', () => {
  it('has the location of each file', async () => {
    expect(await filesFromDrop([file('a.pdf'), file('b.mp4')], pathForFile)).toEqual({ paths: ['/Users/me/a.pdf', '/Users/me/b.mp4'], unresolved: 0 });
  });

  it('counts what has no location — a folder, a file kept in memory — as unresolved, and imports the rest', async () => {
    const got = await filesFromDrop([file('a.pdf'), { kind: 'directory' }, file('memory.pdf'), { kind: 'text' }], pathForFile);
    expect(got).toEqual({ paths: ['/Users/me/a.pdf'], unresolved: 3 });
  });
});
