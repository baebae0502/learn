import { describe, expect, it, vi } from 'vitest';
import { creatorNames, itemMetadataSchema, parseItemMetadata, yearOf } from '../src/metadata';

describe('item metadata', () => {
  it('parses {} to empty metadata', () => {
    expect(parseItemMetadata('{}')).toEqual({ creators: [] });
  });
  it('treats corrupt JSON or invalid shape as empty and logs only a code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseItemMetadata('{not json')).toEqual({ creators: [] });
    expect(parseItemMetadata('{"url":"ftp://secret/path"}')).toEqual({ creators: [] });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('secret');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it('allows only http(s) urls', () => {
    expect(itemMetadataSchema.safeParse({ url: 'https://a.example/x' }).success).toBe(true);
    expect(itemMetadataSchema.safeParse({ url: 'http://a.example' }).success).toBe(true);
    expect(itemMetadataSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false);
    expect(itemMetadataSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
  });
  it('validates date, lengths and creators', () => {
    for (const d of ['2020', '2020-05', '2020-05-17']) expect(itemMetadataSchema.safeParse({ date: d }).success).toBe(true);
    for (const d of ['20', '2020-5', '2020-13', 'May 2020']) expect(itemMetadataSchema.safeParse({ date: d }).success).toBe(false);
    expect(itemMetadataSchema.safeParse({ abstract: 'a'.repeat(10001) }).success).toBe(false);
    expect(itemMetadataSchema.safeParse({ creators: [{ name: '', role: 'author' }] }).success).toBe(false);
    expect(itemMetadataSchema.safeParse({ creators: [{ name: 'x', role: 'boss' }] }).success).toBe(false);
  });
  it('yearOf and creatorNames', () => {
    expect(yearOf({ creators: [] })).toBeNull();
    expect(yearOf({ creators: [], date: '2021-03' })).toBe(2021);
    expect(yearOf({ creators: [], date: '1999' })).toBe(1999);
    expect(creatorNames({ creators: [{ name: '김철수', role: 'author' }, { name: 'B', role: 'editor' }] })).toEqual(['김철수', 'B']);
  });
});
