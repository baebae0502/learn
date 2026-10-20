import type { ErrorCode, LegacyLearnApi, Result } from '@learn/domain';

declare global {
  interface Window {
    learn: LegacyLearnApi;
  }
}

export const api = (): LegacyLearnApi => window.learn;

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
