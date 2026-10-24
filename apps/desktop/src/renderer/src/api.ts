import type { ErrorCode, LearnApi, Result } from '@learn/domain';

declare global {
  interface Window {
    /**
     * Each window's preload exposes its own part of LearnApi only (preload/main.ts, settings.ts, sheet.ts):
     * another window's namespace is undefined in this page, and main refuses its channels anyway.
     */
    learn: LearnApi;
  }
}

export const api = (): LearnApi => window.learn;

export class ApiError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function unwrap<T>(pending: Promise<Result<T>>): Promise<T> {
  const r = await pending;
  if (!r.ok) throw new ApiError(r.code, r.message, r.retryable);
  return r.data;
}
