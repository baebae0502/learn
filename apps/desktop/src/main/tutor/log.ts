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
