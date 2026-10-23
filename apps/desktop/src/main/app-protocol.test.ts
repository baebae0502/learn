import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: {} }));
const { contentTypeFor } = await import('./app-protocol');

describe('app protocol static content types', () => {
  it('serves the bundled fonts with font MIME types', () => {
    expect(contentTypeFor('/r/assets/PretendardVariable-3f2a.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/r/assets/x.WOFF')).toBe('font/woff');
    expect(contentTypeFor('/r/assets/x.otf')).toBe('font/otf');
    expect(contentTypeFor('/r/pdfjs/standard_fonts/x.ttf')).toBe('font/ttf');
  });
  it('keeps the existing types and falls back to octet-stream', () => {
    expect(contentTypeFor('/r/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/r/assets/index-1.js')).toBe('text/javascript');
    expect(contentTypeFor('/r/assets/index-1.css')).toBe('text/css');
    expect(contentTypeFor('/r/x.unknown')).toBe('application/octet-stream');
  });
});
