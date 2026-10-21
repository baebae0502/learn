import { describe, expect, it } from 'vitest';
import { pathParts } from './Notice';

describe('notice file line (wraps after a separator, never cuts)', () => {
  it('splits a path into folders, each keeping its separator, and the file name', () => {
    expect(pathParts('~/Library/Application Support/Learn/library/library.sqlite.pre-v2.bak')).toEqual({
      folders: ['~/', 'Library/', 'Application Support/', 'Learn/', 'library/'],
      base: 'library.sqlite.pre-v2.bak',
    });
    expect(pathParts('C:\\Users\\me\\library\\library.sqlite.pre-v2.bak')).toEqual({ folders: ['C:\\', 'Users\\', 'me\\', 'library\\'], base: 'library.sqlite.pre-v2.bak' });
    expect(pathParts('/x.pdf')).toEqual({ folders: ['/'], base: 'x.pdf' });
  });
  it('a bare name or a non-path line is all name; nothing is ever dropped', () => {
    expect(pathParts('library.sqlite.pre-v2.bak')).toEqual({ folders: [], base: 'library.sqlite.pre-v2.bak' });
    expect(pathParts('seminar-0915.avi · 1.3 GB')).toEqual({ folders: [], base: 'seminar-0915.avi · 1.3 GB' });
    for (const p of ['~/a b/c.pdf', 'C:\\x\\y', '/a/b/', 'name']) {
      const { folders, base } = pathParts(p);
      expect(folders.join('') + base).toBe(p);
    }
  });
});
