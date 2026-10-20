import { toLearnError, type ErrorCode } from './errors';

export type Failure = { ok: false; code: ErrorCode; message: string; retryable: boolean };
export type Result<T> = { ok: true; data: T } | Failure;

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (code: ErrorCode, message: string, retryable = false): Failure => ({ ok: false, code, message, retryable });

export function failureFrom(e: unknown): Failure {
  const le = toLearnError(e);
  return fail(le.code, le.message, le.retryable);
}
