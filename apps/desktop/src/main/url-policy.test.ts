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
  it('rejects asset URLs on the app origin', () => {
    expect(isAllowedAppUrl('learn://app/asset/0b0e5a2e-1111-4222-8333-444455556666', null)).toBe(false);
    expect(isAllowedAppUrl('learn://app/index.html', null)).toBe(true);
  });
  it('additionally allows the exact dev server origin', () => {
    expect(isAllowedAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });
});
