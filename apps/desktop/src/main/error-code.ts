import { LearnError, toLearnError } from '@learn/domain';

/**
 * A thrown value as codes only (the logging rule): toLearnError's code, with the value's own code (an errno or SQLite's
 * result code) or, for an INTERNAL that is not a LearnError, its class (TypeError) — those tell apart what INTERNAL alone
 * does not. Never a message: it may hold a path or a title.
 */
export function errorCode(e: unknown): string {
  const code = toLearnError(e).code;
  const own = (e as { code?: unknown } | null)?.code;
  if (typeof own === 'string' && /^[A-Z][A-Z0-9_]*$/.test(own) && own !== code) return `${code}/${own}`;
  if (code === 'INTERNAL' && e instanceof Error && !(e instanceof LearnError) && /^[A-Za-z]+$/.test(e.name)) return `${code}/${e.name}`;
  return code;
}
