import { describe, expect, it } from 'vitest';
import { splitPath } from './Notice';

describe('notice file line (the folder gives way, the file name stays whole)', () => {
  it('splits after the last separator, POSIX or Windows', () => {
    expect(splitPath('/Users/me/Downloads/papers/calcium-signaling.pdf')).toEqual({ dir: '/Users/me/Downloads/papers/', base: 'calcium-signaling.pdf' });
    expect(splitPath('C:\\Users\\me\\library\\library.sqlite.pre-v*.bak')).toEqual({ dir: 'C:\\Users\\me\\library\\', base: 'library.sqlite.pre-v*.bak' });
    expect(splitPath('/lib/library.sqlite.pre-v*.bak')).toEqual({ dir: '/lib/', base: 'library.sqlite.pre-v*.bak' });
  });
  it('a bare name or a non-path line is all base', () => {
    expect(splitPath('library.sqlite.pre-v*.bak')).toEqual({ dir: '', base: 'library.sqlite.pre-v*.bak' });
    expect(splitPath('seminar-0915.avi · 1.3 GB')).toEqual({ dir: '', base: 'seminar-0915.avi · 1.3 GB' });
  });
});
