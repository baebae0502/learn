export const ERROR_CODES = [
  'NOT_FOUND', 'UNSUPPORTED_TYPE', 'PERMISSION_DENIED', 'DISK_FULL', 'HASH_MISMATCH', 'DUPLICATE',
  'MIGRATION_FAILED', 'VALIDATION_FAILED', 'LIBRARY_UNAVAILABLE', 'PREFS_UNAVAILABLE', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['DISK_FULL', 'PERMISSION_DENIED']);

export class LearnError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'LearnError';
    this.code = code;
    this.retryable = options?.retryable ?? RETRYABLE.has(code);
  }
}

/** Normalize anything thrown into a LearnError with a Korean user-facing message. */
export function toLearnError(e: unknown, fallbackMessage = '알 수 없는 오류가 발생했습니다.'): LearnError {
  if (e instanceof LearnError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') return new LearnError('NOT_FOUND', '파일을 찾을 수 없습니다.', { cause: e });
  if (code === 'EACCES' || code === 'EPERM') return new LearnError('PERMISSION_DENIED', '파일 접근 권한이 없습니다.', { cause: e });
  if (code === 'ENOSPC') return new LearnError('DISK_FULL', '저장 공간이 부족합니다.', { cause: e });
  return new LearnError('INTERNAL', fallbackMessage, { cause: e });
}
