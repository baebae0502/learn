import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { readerLost, trashedAfter } from './readerState';

describe('the reader and the trash (spec 4.6)', () => {
  it('a notice about its item: trashed shows the notice, restored keeps it until the item reads again, purged gives way', () => {
    expect(trashedAfter('no', { reason: 'trash', itemIds: ['x', 'me'] }, 'me')).toBe('yes');
    expect(trashedAfter('yes', { reason: 'restore', itemIds: ['me'] }, 'me')).toBe('back');
    expect(trashedAfter('no', { reason: 'restore', itemIds: ['me'] }, 'me')).toBe('no');
    expect(trashedAfter('yes', { reason: 'purge', itemIds: ['me'] }, 'me')).toBe('no');
    expect(trashedAfter('no', { reason: 'trash', itemIds: ['other'] }, 'me')).toBe('no');
    expect(trashedAfter('yes', { reason: 'metadata', itemIds: ['me'] }, 'me')).toBe('yes');
    expect(trashedAfter('no', { reason: 'trash' }, 'me')).toBe('no');
  });
  it('the reader gives way only when its item cannot be read at all or is gone; another failed re-read keeps it (spec 4.6)', () => {
    expect(readerLost({ isError: false, data: {}, error: null })).toBe(false);
    expect(readerLost({ isError: true, data: undefined, error: new ApiError('INTERNAL', 'x', false) })).toBe(true);
    expect(readerLost({ isError: true, data: {}, error: new ApiError('NOT_FOUND', 'x', false) })).toBe(true);
    expect(readerLost({ isError: true, data: {}, error: new ApiError('LIBRARY_UNAVAILABLE', 'x', false) })).toBe(false);
  });
});
