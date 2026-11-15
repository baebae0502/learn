import { LearnError } from '@learn/domain';

/**
 * The tutor's only log line: an event, then at most a code, a latency and a request id. A question, an answer, a page's
 * text or the agent's stderr can never be a field, so none of them reaches the log.
 */
export function tutorLog(event: string, f: { code?: string; ms?: number; req?: string | number } = {}): void {
  let line = `[tutor] ${event}`;
  if (f.code !== undefined) line += ` code=${f.code}`;
  if (f.ms !== undefined) line += ` ms=${f.ms}`;
  if (f.req !== undefined) line += ` req=${f.req}`;
  console.info(line);
}

/**
 * A tutor failure's code for its log line: a LearnError's own code, else the error's name ('UNKNOWN' for what is not an Error). Unlike
 * errorCode it never reads a system code (an ErrnoException is its name, 'Error') nor a `code` of a plain object, and takes the name as
 * it is, unchecked against TOKEN.
 */
export const codeOf = (e: unknown): string => (e instanceof LearnError ? e.code : e instanceof Error ? e.name : 'UNKNOWN');

/** A plain token (ENOENT, ERR_SERVER_NOT_RUNNING, AGENT_EXITED): a code, never a sentence or a path. */
const TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** What a failure is logged as: its LearnError or system code, else its error name — never its message, which may hold a path. */
export function errorCode(e: unknown): string {
  if (typeof e !== 'object' || e === null) return 'UNKNOWN';
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && TOKEN.test(code)) return code;
  const name = (e as { name?: unknown }).name;
  return typeof name === 'string' && TOKEN.test(name) ? name : 'UNKNOWN';
}
