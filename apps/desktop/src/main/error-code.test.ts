import { describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import { errorCode } from './error-code';

describe('errorCode', () => {
  it('codes only: the LearnError code, with the thrown value\'s own code or class when it says more', () => {
    expect(errorCode(new LearnError('DISK_FULL', 'x'))).toBe('DISK_FULL');
    expect(errorCode(Object.assign(new Error('/a/b.pdf'), { code: 'ENOENT' }))).toBe('NOT_FOUND/ENOENT');
    expect(errorCode(Object.assign(new Error('x'), { code: 'SQLITE_BUSY' }))).toBe('INTERNAL/SQLITE_BUSY');
    expect(errorCode(Object.assign(new Error('x'), { code: 'SQLITE_FULL' }))).toBe('DISK_FULL/SQLITE_FULL');
    expect(errorCode(new TypeError('cannot read x of undefined'))).toBe('INTERNAL/TypeError');
    expect(errorCode('a string')).toBe('INTERNAL');
    expect(errorCode(Object.assign(new Error('x'), { code: 'not a code /path' }))).toBe('INTERNAL/Error');
  });

  it('a LearnError is its code alone: its class says nothing more', () => {
    expect(errorCode(new LearnError('INTERNAL', '/Users/someone/secret'))).toBe('INTERNAL');
    expect(errorCode(new LearnError('LIBRARY_UNAVAILABLE', 'x'))).toBe('LIBRARY_UNAVAILABLE');
  });
});
