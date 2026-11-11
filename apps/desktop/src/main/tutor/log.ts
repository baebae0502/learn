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
