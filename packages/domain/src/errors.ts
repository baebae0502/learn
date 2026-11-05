export const ERROR_CODES = [
  'NOT_FOUND', 'UNSUPPORTED_TYPE', 'PERMISSION_DENIED', 'DISK_FULL', 'HASH_MISMATCH', 'DUPLICATE',
  'MIGRATION_FAILED', 'VALIDATION_FAILED', 'LIBRARY_UNAVAILABLE', 'PREFS_UNAVAILABLE', 'INTERNAL',
  // A job the user (or quitting) stopped: an import's file, a backup, a restore. Never reported as a failure.
  'CANCELLED',
  // The reader's translation (ADR-0012): the cause is told apart so the panel can say what to do next.
  'TRANSLATION_OFFLINE', 'TRANSLATION_RATE_LIMITED', 'TRANSLATION_BLOCKED', 'TRANSLATION_UNAVAILABLE', 'TRANSLATION_BAD_RESPONSE',
  'TRANSLATION_DISABLED', 'TRANSLATION_TOO_LONG',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['DISK_FULL', 'PERMISSION_DENIED', 'TRANSLATION_OFFLINE', 'TRANSLATION_RATE_LIMITED', 'TRANSLATION_UNAVAILABLE']);

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

/**
 * The sentences toLearnError puts on an engine's error (design-spec 9: the cause, then the next step). The renderer's
 * copy test reads them with the rest of the UI copy.
 */
export const ERROR_COPY = {
  fileMissing: '파일을 찾을 수 없습니다.',
  fileDenied: '파일 접근 권한이 없습니다. 권한을 확인한 뒤 다시 시도하세요.',
  diskFull: '저장 공간이 부족합니다. 디스크\u00a0공간을 확보한 뒤 다시 시도하세요.',
  libraryDenied: '라이브러리에 저장할 수 없습니다. 라이브러리 폴더의 쓰기 권한을 확인한 뒤 앱을 다시 시작하세요.',
  libraryCorrupt: '라이브러리 데이터가 손상되었습니다. 앱을 다시 시작하고, 계속되면 백업에서 복원하세요.',
  unknown: '알 수 없는 오류가 발생했습니다.',
  translationOffline: '번역할 수 없음 — 인터넷에 연결되어 있지 않습니다',
  translationRateLimited: '번역 요청이 너무 많습니다. 잠시 뒤 다시 시도하십시오',
  translationBlocked: '번역 서비스가 요청을 거부했습니다',
  translationUnavailable: '번역 서비스가 응답하지 않습니다',
  translationBadResponse: '번역 결과를 읽을 수 없습니다',
  translationDisabled: '번역이 꺼져 있습니다. 설정에서 켤 수 있습니다',
  translationTooLong: '번역하기에 너무 깁니다',
  translationCancelled: '번역을 취소했습니다.',
} as const;

interface Mapped {
  code: ErrorCode;
  message: string;
}
const DISK_FULL: Mapped = { code: 'DISK_FULL', message: ERROR_COPY.diskFull };
const FILE_DENIED: Mapped = { code: 'PERMISSION_DENIED', message: ERROR_COPY.fileDenied };
const LIBRARY_DENIED: Mapped = { code: 'PERMISSION_DENIED', message: ERROR_COPY.libraryDenied };
// A damaged database leaves the library unusable; there is no code of its own for it (Q-2a).
const LIBRARY_CORRUPT: Mapped = { code: 'LIBRARY_UNAVAILABLE', message: ERROR_COPY.libraryCorrupt };
/** Node's errno names and SQLite's primary result codes. A Map: an odd code such as "toString" finds nothing. */
const MAPPED: ReadonlyMap<string, Mapped> = new Map<string, Mapped>([
  ['ENOENT', { code: 'NOT_FOUND', message: ERROR_COPY.fileMissing }],
  ['EACCES', FILE_DENIED],
  ['EPERM', FILE_DENIED],
  ['EROFS', FILE_DENIED],
  ['ENOSPC', DISK_FULL],
  ['EDQUOT', DISK_FULL],
  ['SQLITE_FULL', DISK_FULL],
  ['SQLITE_READONLY', LIBRARY_DENIED],
  ['SQLITE_CANTOPEN', LIBRARY_DENIED],
  ['SQLITE_NOTADB', LIBRARY_CORRUPT],
  ['SQLITE_CORRUPT', LIBRARY_CORRUPT],
]);
/** better-sqlite3's SqliteError carries SQLite's extended result code (SQLITE_READONLY_DBMOVED); the primary code is its first two words. */
const SQLITE_PRIMARY = /^SQLITE_[A-Z]+/;

/** Normalize anything thrown into a LearnError with a Korean user-facing message; the original stays as the cause. */
export function toLearnError(e: unknown, fallbackMessage: string = ERROR_COPY.unknown): LearnError {
  if (e instanceof LearnError) return e;
  const raw = (e as { code?: unknown } | null)?.code;
  const hit = typeof raw === 'string' ? (MAPPED.get(raw) ?? MAPPED.get(SQLITE_PRIMARY.exec(raw)?.[0] ?? '')) : undefined;
  return hit ? new LearnError(hit.code, hit.message, { cause: e }) : new LearnError('INTERNAL', fallbackMessage, { cause: e });
}
