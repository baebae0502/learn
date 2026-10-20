export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header (RFC 9110).
 * null → serve the whole body; 'unsatisfiable' → 416.
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, s = '', e = ''] = m;
  if (s === '' && e === '') return null;
  if (size === 0) return 'unsatisfiable';
  if (s === '') {
    const suffix = Number(e);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(s);
  if (start >= size) return 'unsatisfiable';
  const end = e === '' ? size - 1 : Math.min(Number(e), size - 1);
  if (end < start) return 'unsatisfiable';
  return { start, end };
}
