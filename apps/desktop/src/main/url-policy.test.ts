import { describe, expect, it } from 'vitest';
import { isAllowedAppUrl } from './url-policy';

describe('isAllowedAppUrl', () => {
  it('allows only learn://app pages in production', () => {
    expect(isAllowedAppUrl('learn://app/index.html', null)).toBe(true);
    expect(isAllowedAppUrl('learn://evil/index.html', null)).toBe(false);
    expect(isAllowedAppUrl('file:///etc/passwd', null)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', null)).toBe(false);
    expect(isAllowedAppUrl('not a url', null)).toBe(false);
  });
  it('additionally allows the exact dev server origin', () => {
    expect(isAllowedAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });
});
