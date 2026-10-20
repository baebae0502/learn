# Learn 첫 세션 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로컬 우선 학습 앱 Learn의 첫 세션 산출물 — runnable Electron 앱, 스키마 v1/마이그레이션/백업, PDF·동영상 가져오기(관리형/외부 연결, 중복, missing, 복구 스캔), PDF·동영상 열기, E2E smoke, P0 기록·ADR·AC 추적표 — 를 만든다.

**Architecture:** pnpm 모노레포. `packages/domain`(타입·스키마·Result) ← `packages/db`(better-sqlite3, 마이그레이션, 저장소) ← `packages/library`(가져오기·복구·백업, Electron 비의존) ← `apps/desktop`(electron-vite: main/preload/renderer). renderer와 자료는 단일 앱 스킴 `learn://app`으로 제공되고, renderer는 preload의 `window.learn`(LearnApi)으로만 main과 통신한다.

**Tech Stack:** Electron 44.9.1 (Node 24.22, Chromium 152), electron-vite 6.0.0, Vite 8.3.4, React 19.3.1, TypeScript 7.0.2, better-sqlite3 13.0.3 (SQLite 3.53.4), zod 4.6.7, pdfjs-dist 6.4.299, vitest 5.0.5, @playwright/test 1.64.1, pdf-lib 1.17.1, pnpm 10.15.1, Node 22.19 (개발 도구용).

**Spec:** `docs/superpowers/specs/2026-10-20-learn-first-session-design.md` (상위: `docs/spec.html`). 실행자는 둘 다 읽는다.

## Global Constraints

- 의존성 버전은 정확히 고정한다(`^`, `~` 금지). `pnpm-lock.yaml`을 커밋한다.
- 사용자에게 보이는 문구는 한국어. 코드 식별자·로그 키는 영어.
- 원본 자료 파일을 수정·삭제·이동하지 않는다. 앱이 지우는 것은 자기 `staging/` 임시 파일뿐이다.
- renderer에 fs/shell/DB 권한을 주지 않는다. preload는 `LearnApi`만 `contextBridge`로 노출한다. BrowserWindow는 `sandbox:true, contextIsolation:true, nodeIntegration:false`.
- 모든 IPC 입력은 main에서 zod로 검증하고 `{ok:true,data} | {ok:false,code,message,retryable}`로 응답한다.
- 외부 프로세스는 `execFile`/`execFileSync` 인자 배열로만 실행한다(셸 문자열 조합 금지).
- 로그에 자료 원문·전체 경로·키를 남기지 않는다(오류 코드만).
- 가짜 버튼·하드코딩 학습 기록 금지. 미구현 기능은 비활성 + "P? 단계에서 구현" 표기.
- 커밋 메시지는 다음 두 줄로 끝낸다:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi
  ```
- 검증 명령: `pnpm typecheck`, `pnpm test`, 앱 관련 작업은 `pnpm e2e:xvfb`. 실패를 건너뛰고 완료라고 하지 않는다.

## 실행 환경 메모 (이 서버, 2026-10-20 P0 탐색 결과)

- headless Linux(g01, Debian 13, x86_64), 홈은 NFS. GUI 실행은 `xvfb-run -a -s "-screen 0 1440x900x24" …`.
- GitHub 릴리스 다운로드가 연결당 ~20–60KB/s로 제한된다. Electron 44.9.1 linux-x64 zip은 이미 `~/.cache/electron/<sha256("https://github.com/electron/electron/releases/download/v44.9.1")>/`에 검증된 상태로 들어 있어 `pnpm install` 시 캐시에서 설치된다. 설치가 다운로드에서 멈추면 캐시가 사라진 것이므로 중단하고 보고한다.
- better-sqlite3 13은 N-API 바이너리다. `pnpm install`이 Node 22용으로 소스 빌드(~15초)하며 같은 바이너리가 Electron 44에서도 로드된다. `electron-rebuild` 불필요.
- `file://`로 로드한 페이지는 Origin이 `null`이고 pdf.js 요청이 CORS로 막힌다 → renderer도 `learn://app`으로 로드한다(검증 완료).
- pdf.js 6: `page.render({ canvas, viewport })`. `isEvalSupported` 옵션은 없다. `cmaps/ standard_fonts/ wasm/ iccs/` 디렉터리를 정적 자산으로 제공해야 한다.
- Chromium(Electron 44, Linux)은 MPEG-4 Part 2를 `MediaError.code=4`, 메시지 `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`로 거부한다.

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, playwright.config.ts, .gitignore
packages/domain/   src/{ids,errors,result,anchors,library,ipc-channels,ipc,index}.ts  test/domain.test.ts
packages/db/       src/{connection,migrate,library-repository,index}.ts  src/migrations/{index,001-initial}.ts
                   test/{migrate,library-repository}.test.ts
packages/library/  src/{layout,resolve,sniff,hash,importer,recovery,availability,backup,index}.ts
                   test/{helpers,primitives,importer,recovery,backup}.test.ts (helpers.ts 는 테스트 아님)
apps/desktop/      electron.vite.config.ts, tsconfig.json, scripts/copy-pdfjs-assets.mjs
                   src/main/{index,app-protocol,range,url-policy,security,ipc,library-context}.ts
                   src/main/{range,url-policy}.test.ts
                   src/preload/index.ts
                   src/renderer/index.html, src/renderer/src/{main.tsx,App.tsx,api.ts,strings.ts,format.ts,styles.css}
                   src/renderer/src/components/{TopBar,Sidebar,LibraryView,DuplicateDialog,TutorPanel,FatalScreen}.tsx
                   src/renderer/src/viewers/{ViewerHost,PdfViewer,VideoViewer}.tsx
fixtures/          generate.mjs, README.md, generated/ (gitignore)
tests/             tsconfig.json, e2e/{helpers.ts,first-session.spec.ts}
docs/              p0-verification.md, acceptance.md, decisions/000{1,2,3}-*.md, README.md(루트)
```

---

### Task 1: 모노레포 골격 + `@learn/domain`

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`
- Modify: `.gitignore`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`
- Create: `packages/domain/src/{ids,errors,result,anchors,library,ipc-channels,ipc,index}.ts`
- Test: `packages/domain/test/domain.test.ts`

**Interfaces:**
- Produces (모든 이후 작업이 사용):
  - `newId(): string`, `nowIso(): string`
  - `type ErrorCode = 'NOT_FOUND'|'UNSUPPORTED_TYPE'|'PERMISSION_DENIED'|'DISK_FULL'|'HASH_MISMATCH'|'DUPLICATE'|'MIGRATION_FAILED'|'VALIDATION_FAILED'|'LIBRARY_UNAVAILABLE'|'INTERNAL'`
  - `class LearnError(code, message, {retryable?, cause?})`, `toLearnError(e, fallback?)`
  - `type Result<T>`, `type Failure`, `ok(data)`, `fail(code,msg,retryable?)`, `failureFrom(e)`
  - `sourceAnchor` 등 zod 스키마, `type SourceAnchor`, `ANCHOR_SCHEMA_VERSION = 1`
  - `ItemType = 'pdf'|'video'`, `StorageMode = 'managed'|'linked'`, `Availability = 'available'|'missing'`
  - `interface LibraryItem {id,title,type,mime,size,storageMode,availability,assetId,revisionId,originalName,createdAt}`
  - `type ImportOutcome`, `interface RecoveryReport`, `interface AppInfo`, `APP_ORIGIN = 'learn://app'`, `assetUrl(assetId)`
  - `IpcChannels` (from `@learn/domain/ipc-channels`, zod 없음), `interface LearnApi`, 입력 스키마 `pickAndImportInput, importPathsInput, itemIdInput, assetIdInput, emptyInput`

- [ ] **Step 1: 루트 파일 작성**

`package.json`:
```json
{
  "name": "learn",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@10.15.1",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "pnpm --filter @learn/desktop dev",
    "build": "pnpm --filter @learn/desktop build",
    "typecheck": "pnpm -r --workspace-concurrency=1 typecheck",
    "test": "vitest run",
    "fixtures": "node fixtures/generate.mjs",
    "e2e": "pnpm build && playwright test",
    "e2e:xvfb": "pnpm build && xvfb-run -a -s \"-screen 0 1440x900x24\" playwright test"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "typescript": "7.0.2",
    "vitest": "5.0.5"
  },
  "pnpm": { "onlyBuiltDependencies": ["better-sqlite3", "electron", "esbuild"] }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
```

`.gitignore`에 다음 줄을 추가(기존 줄 유지):
```
apps/desktop/src/renderer/public/pdfjs/
*.tsbuildinfo
```

- [ ] **Step 2: domain 패키지 설정**

`packages/domain/package.json`:
```json
{
  "name": "@learn/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./ipc-channels": "./src/ipc-channels.ts"
  },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "4.6.7" }
}
```

`packages/domain/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`
Expected: 설치 완료, `pnpm-lock.yaml` 생성.

- [ ] **Step 3: 실패하는 테스트 작성** — `packages/domain/test/domain.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  APP_ORIGIN, ANCHOR_SCHEMA_VERSION, LearnError, assetUrl, fail, failureFrom, importPathsInput, newId, nowIso, ok,
  pickAndImportInput, sourceAnchor, toLearnError,
} from '../src/index';
import { IpcChannels } from '../src/ipc-channels';

describe('ids', () => {
  it('creates v4 UUIDs and UTC ISO timestamps', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('errors and results', () => {
  it('maps fs error codes to LearnError codes', () => {
    expect(toLearnError(Object.assign(new Error('x'), { code: 'ENOENT' })).code).toBe('NOT_FOUND');
    expect(toLearnError(Object.assign(new Error('x'), { code: 'EACCES' })).code).toBe('PERMISSION_DENIED');
    const full = toLearnError(Object.assign(new Error('x'), { code: 'ENOSPC' }));
    expect(full.code).toBe('DISK_FULL');
    expect(full.retryable).toBe(true);
    expect(toLearnError(new Error('boom')).code).toBe('INTERNAL');
  });
  it('keeps LearnError as-is', () => {
    const e = new LearnError('HASH_MISMATCH', '다름', { retryable: true });
    expect(toLearnError(e)).toBe(e);
  });
  it('builds result envelopes', () => {
    expect(ok(3)).toEqual({ ok: true, data: 3 });
    expect(fail('NOT_FOUND', '없음')).toEqual({ ok: false, code: 'NOT_FOUND', message: '없음', retryable: false });
    expect(failureFrom(new LearnError('DUPLICATE', '중복'))).toEqual({ ok: false, code: 'DUPLICATE', message: '중복', retryable: false });
  });
});

describe('anchors (spec 08 examples)', () => {
  const revisionId = newId();
  it('accepts a pdf anchor in pdf-user-space', () => {
    const r = sourceAnchor.safeParse({
      kind: 'pdf', revisionId, pageIndex: 41, quads: [[1, 2, 3, 4, 5, 6, 7, 8]], coordinateSpace: 'pdf-user-space',
      quote: { exact: 'A signaling cascade', prefix: '', suffix: ' can amplify' },
    });
    expect(r.success).toBe(true);
  });
  it('accepts a video anchor with normalized rect', () => {
    const r = sourceAnchor.safeParse({
      kind: 'video', revisionId, startMs: 758000, endMs: 768000,
      frame: { atMs: 758000, width: 1920, height: 1080 }, rect: [0.2, 0.3, 0.4, 0.2],
    });
    expect(r.success).toBe(true);
  });
  it('rejects inverted time ranges and out-of-frame rects', () => {
    expect(sourceAnchor.safeParse({ kind: 'video', revisionId, startMs: 10, endMs: 5 }).success).toBe(false);
    expect(sourceAnchor.safeParse({ kind: 'video', revisionId, startMs: 0, endMs: 5, rect: [0.8, 0, 0.4, 0.1] }).success).toBe(false);
  });
  it('exposes schema version 1', () => expect(ANCHOR_SCHEMA_VERSION).toBe(1));
});

describe('ipc contract', () => {
  it('defaults allowDuplicate to false', () => {
    expect(pickAndImportInput.parse({ mode: 'managed' })).toEqual({ mode: 'managed', allowDuplicate: false });
  });
  it('rejects empty path lists and unknown modes', () => {
    expect(importPathsInput.safeParse({ paths: [], mode: 'managed' }).success).toBe(false);
    expect(importPathsInput.safeParse({ paths: ['/a.pdf'], mode: 'copy' }).success).toBe(false);
  });
  it('builds same-origin asset URLs', () => {
    expect(APP_ORIGIN).toBe('learn://app');
    expect(assetUrl('abc')).toBe('learn://app/asset/abc');
  });
  it('uses namespaced channel names', () => {
    expect(Object.values(IpcChannels).every((c) => /^(app|library):[a-zA-Z]+$/.test(c))).toBe(true);
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm test`
Expected: FAIL — `../src/index`를 찾지 못함.

- [ ] **Step 5: 구현**

`packages/domain/src/ids.ts`:
```ts
/** UUID v4. Uses Web Crypto so the same code runs in Node (main) and the renderer. */
export const newId = (): string => globalThis.crypto.randomUUID();

/** UTC ISO-8601; the UI converts to local time for display. */
export const nowIso = (): string => new Date().toISOString();
```

`packages/domain/src/errors.ts`:
```ts
export const ERROR_CODES = [
  'NOT_FOUND', 'UNSUPPORTED_TYPE', 'PERMISSION_DENIED', 'DISK_FULL', 'HASH_MISMATCH', 'DUPLICATE',
  'MIGRATION_FAILED', 'VALIDATION_FAILED', 'LIBRARY_UNAVAILABLE', 'INTERNAL',
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
```

`packages/domain/src/result.ts`:
```ts
import { toLearnError, type ErrorCode } from './errors';

export type Failure = { ok: false; code: ErrorCode; message: string; retryable: boolean };
export type Result<T> = { ok: true; data: T } | Failure;

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (code: ErrorCode, message: string, retryable = false): Failure => ({ ok: false, code, message, retryable });

export function failureFrom(e: unknown): Failure {
  const le = toLearnError(e);
  return fail(le.code, le.message, le.retryable);
}
```

`packages/domain/src/anchors.ts`:
```ts
import { z } from 'zod';

/** Coordinate rules are part of schema v1 — see docs/decisions/0002-anchor-coordinates.md. */
export const ANCHOR_SCHEMA_VERSION = 1;

const quote = z.object({ exact: z.string().min(1), prefix: z.string(), suffix: z.string() });
const quad = z.array(z.number()).length(8);
const unit = z.number().min(0).max(1);

export const pdfAnchor = z.object({
  kind: z.literal('pdf'),
  revisionId: z.uuid(),
  pageIndex: z.number().int().min(0),
  quads: z.array(quad).min(1),
  coordinateSpace: z.literal('pdf-user-space'),
  quote: quote.optional(),
});

export const videoAnchor = z
  .object({
    kind: z.literal('video'),
    revisionId: z.uuid(),
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    frame: z.object({ atMs: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
    /** [x, y, w, h] normalized to the decoded frame, letterbox excluded. */
    rect: z.tuple([unit, unit, unit, unit]).optional(),
  })
  .refine((a) => a.endMs >= a.startMs, { message: 'endMs must be >= startMs' })
  .refine((a) => !a.rect || (a.rect[0] + a.rect[2] <= 1 && a.rect[1] + a.rect[3] <= 1), { message: 'rect must stay inside the frame' });

export const epubAnchor = z.object({
  kind: z.literal('epub'),
  revisionId: z.uuid(),
  spineHref: z.string().min(1),
  cfi: z.string().startsWith('epubcfi('),
  quote,
});

export const webAnchor = z.object({
  kind: z.literal('web'),
  revisionId: z.uuid(),
  textPosition: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }),
  quote,
});

export const slideAnchor = z.object({
  kind: z.literal('slide'),
  revisionId: z.uuid(),
  derivedRevisionId: z.uuid(),
  slideIndex: z.number().int().min(0),
  quads: z.array(quad),
});

export const sourceAnchor = z.union([pdfAnchor, videoAnchor, epubAnchor, webAnchor, slideAnchor]);
export type SourceAnchor = z.infer<typeof sourceAnchor>;
```

`packages/domain/src/library.ts`:
```ts
import type { ErrorCode } from './errors';

export type ItemType = 'pdf' | 'video';
export type StorageMode = 'managed' | 'linked';
export type Availability = 'available' | 'missing';

export interface LibraryItem {
  id: string;
  title: string;
  type: ItemType;
  mime: string;
  size: number;
  storageMode: StorageMode;
  availability: Availability;
  assetId: string;
  revisionId: string;
  originalName: string;
  createdAt: string;
}

export type ImportOutcome =
  | { status: 'imported'; path: string; item: LibraryItem }
  | { status: 'duplicate'; path: string; existingItemId: string }
  | { status: 'failed'; path: string; code: ErrorCode; message: string };

export interface RecoveryReport {
  /** File names left in staging/ by an interrupted import. Never auto-deleted. */
  stagingLeftovers: string[];
  /** Library-relative paths under assets/ that no DB row references. Never auto-deleted. */
  unreferencedAssets: string[];
  /** Managed asset ids whose file is gone. */
  missingManagedAssets: string[];
  /** Jobs that were `running` at startup and are now `interrupted`. */
  interruptedJobs: number;
}

export interface AppInfo {
  version: string;
  libraryRoot: string;
  schemaVersion: number;
  platform: string;
  libraryError: { code: ErrorCode; message: string } | null;
}

/** Renderer and assets share this origin so asset reads are same-origin (no CORS). */
export const APP_ORIGIN = 'learn://app';
export const assetUrl = (assetId: string): string => `${APP_ORIGIN}/asset/${encodeURIComponent(assetId)}`;
```

`packages/domain/src/ipc-channels.ts`:
```ts
/** Channel names only — kept free of zod so the sandboxed preload bundle stays tiny. */
export const IpcChannels = {
  appInfo: 'app:info',
  pickAndImport: 'library:pickAndImport',
  importPaths: 'library:import',
  listItems: 'library:list',
  getItem: 'library:get',
  pickAndRelink: 'library:pickAndRelink',
  recoveryReport: 'library:recoveryReport',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
```

`packages/domain/src/ipc.ts`:
```ts
import { z } from 'zod';
import type { AppInfo, ImportOutcome, LibraryItem, RecoveryReport } from './library';
import type { Result } from './result';

export const storageModeSchema = z.enum(['managed', 'linked']);
export const pickAndImportInput = z.object({ mode: storageModeSchema, allowDuplicate: z.boolean().default(false) });
export const importPathsInput = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(500),
  mode: storageModeSchema,
  allowDuplicate: z.boolean().default(false),
});
export const itemIdInput = z.object({ itemId: z.uuid() });
export const assetIdInput = z.object({ assetId: z.uuid() });
export const emptyInput = z.object({}).strict().optional();

export type PickAndImportInput = z.input<typeof pickAndImportInput>;
export type ImportPathsInput = z.input<typeof importPathsInput>;

/** The only surface the renderer sees (window.learn). */
export interface LearnApi {
  appInfo(): Promise<Result<AppInfo>>;
  pickAndImport(input: PickAndImportInput): Promise<Result<ImportOutcome[]>>;
  importPaths(input: ImportPathsInput): Promise<Result<ImportOutcome[]>>;
  listItems(): Promise<Result<LibraryItem[]>>;
  getItem(input: { itemId: string }): Promise<Result<LibraryItem>>;
  pickAndRelink(input: { assetId: string }): Promise<Result<LibraryItem | null>>;
  recoveryReport(): Promise<Result<RecoveryReport>>;
  /** Drag & drop: resolves a dropped File to its path via webUtils (sandbox-safe). */
  pathForFile(file: File): string;
}
```

`packages/domain/src/index.ts`:
```ts
export * from './anchors';
export * from './errors';
export * from './ids';
export * from './ipc';
export * from './ipc-channels';
export * from './library';
export * from './result';
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: domain 테스트 전부 PASS, typecheck 오류 0. (`LearnApi.pathForFile`의 `File`을 찾지 못한다는 오류가 나면 `packages/domain/tsconfig.json`에 `"compilerOptions": { "lib": ["ES2023", "DOM"] }`를 추가한다.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(domain): workspace scaffold, result/error types, anchor and IPC contracts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 2: `@learn/db` 연결 + 마이그레이션 실행기 + 스키마 v1

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`
- Create: `packages/db/src/connection.ts`, `packages/db/src/migrate.ts`, `packages/db/src/migrations/index.ts`, `packages/db/src/migrations/001-initial.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/migrate.test.ts`

**Interfaces:**
- Consumes: `LearnError`, `nowIso` (Task 1)
- Produces: `type Db`, `openDatabase(file: string): Db`, `migrate(db, {dbFile: string|null, migrations?}): MigrateResult {from,to,backupFile}`, `currentVersion(db): number`, `snapshotDatabase(db, file): void`, `interface Migration {version,name,sql}`, `MIGRATIONS`, `LATEST_SCHEMA_VERSION = 1`

- [ ] **Step 1: 패키지 설정**

`packages/db/package.json`:
```json
{
  "name": "@learn/db",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@learn/domain": "workspace:*",
    "better-sqlite3": "13.0.3"
  },
  "devDependencies": { "@types/better-sqlite3": "9.6.0" }
}
```

`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`
Expected: better-sqlite3 빌드 로그 후 완료.

- [ ] **Step 2: 실패하는 테스트** — `packages/db/test/migrate.test.ts`

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, currentVersion, migrate, openDatabase, type Db } from '../src/index';

const dirs: string[] = [];
const dbs: Db[] = [];
function tempDb(): { db: Db; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-db-'));
  dirs.push(dir);
  const file = path.join(dir, 'library.sqlite');
  const db = openDatabase(file);
  dbs.push(db);
  return { db, file };
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const tables = (db: Db) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);

describe('openDatabase', () => {
  it('enables WAL and foreign keys', () => {
    const { db } = tempDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('migrate', () => {
  it('creates schema v1 on an empty database', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file })).toEqual({ from: 0, to: 1, backupFile: null });
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(tables(db)).toEqual(expect.arrayContaining([
      'items', 'assets', 'item_assets', 'source_revisions', 'collections', 'collection_items',
      'tags', 'item_tags', 'anchors', 'annotations', 'jobs', 'settings', 'schema_migrations',
    ]));
  });

  it('is idempotent', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    expect(migrate(db, { dbFile: file })).toEqual({ from: 1, to: 1, backupFile: null });
  });

  it('rolls back a failing migration and keeps a pre-migration snapshot', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const broken = [...MIGRATIONS, { version: 2, name: 'broken', sql: 'CREATE TABLE half_done (a TEXT); INSERT INTO no_such_table VALUES (1);' }];
    let caught: unknown;
    try { migrate(db, { dbFile: file, migrations: broken }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(LearnError);
    expect((caught as LearnError).code).toBe('MIGRATION_FAILED');
    expect(currentVersion(db)).toBe(1);
    expect(tables(db)).not.toContain('half_done');
    const backup = `${file}.pre-v2.bak`;
    expect(fs.existsSync(backup)).toBe(true);
    const snap = openDatabase(backup);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(1);
  });

  it('refuses a database created by a newer app', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'future', 'x')`).run();
    expect(() => migrate(db, { dbFile: file })).toThrow(/더 새로운 버전/);
  });

  it('enforces storage-mode path consistency on assets', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const insert = db.prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, created_at)
      VALUES (?, ?, ?, ?, ?, 'a.pdf', 'application/pdf', 1, 'now')`);
    const sha = 'a'.repeat(64);
    expect(() => insert.run('1', sha, 'managed', null, '/x/a.pdf')).toThrow(/CHECK/);
    expect(() => insert.run('2', sha, 'linked', 'assets/aa/x', null)).toThrow(/CHECK/);
    insert.run('3', sha, 'managed', `assets/aa/${sha}`, null);
    expect(() => insert.run('4', sha, 'managed', `assets/aa/${sha}`, null)).toThrow(/UNIQUE/);
    insert.run('5', sha, 'linked', null, '/x/a.pdf');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test packages/db`
Expected: FAIL — `../src/index` 없음.

- [ ] **Step 4: 구현**

`packages/db/src/connection.ts`:
```ts
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** One connection per library, owned by the main process: it is the single write queue. */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
```

`packages/db/src/migrations/001-initial.ts`:
```ts
export const sql = `
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pdf','video','epub','slides','web')),
  title TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  storage_mode TEXT NOT NULL CHECK (storage_mode IN ('managed','linked')),
  relative_path TEXT,
  external_path TEXT,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available','missing')),
  created_at TEXT NOT NULL,
  checked_at TEXT,
  CHECK ((storage_mode = 'managed' AND relative_path IS NOT NULL AND external_path IS NULL)
      OR (storage_mode = 'linked' AND external_path IS NOT NULL AND relative_path IS NULL))
);
CREATE INDEX assets_sha256 ON assets(sha256);
CREATE UNIQUE INDEX assets_managed_sha256 ON assets(sha256) WHERE storage_mode = 'managed';

CREATE TABLE item_assets (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('original','subtitle','derived')),
  PRIMARY KEY (item_id, asset_id, role)
);
CREATE INDEX item_assets_asset ON item_assets(asset_id);

CREATE TABLE source_revisions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  hash TEXT NOT NULL,
  parent_revision_id TEXT REFERENCES source_revisions(id),
  renderer_version TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX source_revisions_asset ON source_revisions(asset_id);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES source_revisions(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('pdf','video','epub','web','slide')),
  locator_json TEXT NOT NULL,
  quote TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','review','orphan')),
  schema_version INTEGER NOT NULL
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  anchor_id TEXT NOT NULL REFERENCES anchors(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('stroke','highlight','note')),
  body_json TEXT NOT NULL,
  color TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  operation_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('queued','running','done','failed','interrupted','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  progress REAL,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
```

`packages/db/src/migrations/index.ts`:
```ts
import { sql as initial } from './001-initial';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'initial', sql: initial }];
export const LATEST_SCHEMA_VERSION = 1;
```

`packages/db/src/migrate.ts`:
```ts
import fs from 'node:fs';
import { LearnError, nowIso } from '@learn/domain';
import type { Db } from './connection';
import { MIGRATIONS, type Migration } from './migrations/index';

export interface MigrateResult {
  from: number;
  to: number;
  backupFile: string | null;
}

export function currentVersion(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

/** Consistent single-file snapshot of a live (WAL) database. */
export function snapshotDatabase(db: Db, file: string): void {
  fs.rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
}

export function migrate(db: Db, opts: { dbFile: string | null; migrations?: readonly Migration[] }): MigrateResult {
  const migrations = [...(opts.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);
  const latest = migrations.at(-1)?.version ?? 0;
  const from = currentVersion(db);
  if (from > latest) {
    throw new LearnError('MIGRATION_FAILED', `이 라이브러리는 더 새로운 버전(v${from})의 앱에서 만들어졌습니다. 앱을 업데이트하세요.`);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return { from, to: from, backupFile: null };

  let backupFile: string | null = null;
  if (from > 0 && opts.dbFile) {
    backupFile = `${opts.dbFile}.pre-v${pending[0]!.version}.bak`;
    snapshotDatabase(db, backupFile);
  }
  for (const m of pending) {
    try {
      db.transaction(() => {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, nowIso());
      })();
    } catch (e) {
      throw new LearnError(
        'MIGRATION_FAILED',
        `데이터베이스 업데이트(v${m.version} ${m.name})에 실패해 이전 상태로 되돌렸습니다.${backupFile ? ' 업데이트 전 백업이 있습니다.' : ''}`,
        { cause: e },
      );
    }
  }
  return { from, to: pending.at(-1)!.version, backupFile };
}
```

`packages/db/src/index.ts`:
```ts
export * from './connection';
export * from './migrate';
export * from './migrations/index';
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test packages/db && pnpm typecheck`
Expected: PASS, 오류 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): SQLite connection, migration runner with snapshot, schema v1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 3: `LibraryRepository`

**Files:**
- Create: `packages/db/src/library-repository.ts`
- Modify: `packages/db/src/index.ts` (export 추가)
- Test: `packages/db/test/library-repository.test.ts`

**Interfaces:**
- Consumes: `Db`, `openDatabase`, `migrate` (Task 2); `LibraryItem`, `ItemType`, `StorageMode`, `Availability`, `newId`, `nowIso` (Task 1)
- Produces:
  - `interface AssetRow {id, sha256, storageMode, relativePath: string|null, externalPath: string|null, originalName, mime, size, availability, createdAt, checkedAt: string|null}`
  - `interface NewImportRecord {item:{id,type,title,createdAt}, asset: AssetRow, assetIsNew: boolean, revision: {id,createdAt}|null, job: {id,kind,dedupeKey,payload}|null}`
  - `interface LibraryCounts {items, assets, revisions}`
  - `class LibraryRepository(db)`: `findAssetsBySha(sha): AssetRow[]` (managed 우선), `getAsset(id)`, `allAssets()`, `assetsByMode(mode)`, `itemIdsForAsset(assetId): string[]`, `insertImported(rec): void`, `listItems(): LibraryItem[]`, `getItem(id): LibraryItem|undefined`, `setAvailability(assetId, availability, checkedAt)`, `setExternalPath(assetId, path, checkedAt)`, `markRunningJobsInterrupted(now): number`, `counts(): LibraryCounts`

- [ ] **Step 1: 실패하는 테스트** — `packages/db/test/library-repository.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso, type StorageMode } from '@learn/domain';
import { LibraryRepository, migrate, openDatabase, type AssetRow, type Db, type NewImportRecord } from '../src/index';

let db: Db;
let repo: LibraryRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  repo = new LibraryRepository(db);
});

function asset(sha: string, mode: StorageMode, extra: Partial<AssetRow> = {}): AssetRow {
  const now = nowIso();
  return {
    id: newId(), sha256: sha, storageMode: mode,
    relativePath: mode === 'managed' ? `assets/${sha.slice(0, 2)}/${sha}` : null,
    externalPath: mode === 'linked' ? `/ext/${sha.slice(0, 6)}.pdf` : null,
    originalName: 'lecture.pdf', mime: 'application/pdf', size: 1234, availability: 'available',
    createdAt: now, checkedAt: now, ...extra,
  };
}
function record(a: AssetRow, isNew = true, title = 'lecture'): NewImportRecord {
  const now = nowIso();
  return {
    item: { id: newId(), type: 'pdf', title, createdAt: now },
    asset: a, assetIsNew: isNew,
    revision: isNew ? { id: newId(), createdAt: now } : null,
    job: { id: newId(), kind: 'extract', dedupeKey: `extract:${a.sha256}:text-v0`, payload: { sha256: a.sha256 } },
  };
}
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('LibraryRepository', () => {
  it('inserts an imported item atomically and reads it back', () => {
    const a = asset(SHA_A, 'managed');
    const rec = record(a);
    repo.insertImported(rec);
    const item = repo.getItem(rec.item.id)!;
    expect(item).toMatchObject({
      id: rec.item.id, title: 'lecture', type: 'pdf', mime: 'application/pdf', size: 1234,
      storageMode: 'managed', availability: 'available', assetId: a.id, revisionId: rec.revision!.id, originalName: 'lecture.pdf',
    });
    expect(repo.listItems().map((i) => i.id)).toEqual([rec.item.id]);
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
  });

  it('rolls back everything when part of the insert fails', () => {
    const first = record(asset(SHA_A, 'managed'));
    repo.insertImported(first);
    const clash = { ...record(asset(SHA_B, 'managed')), item: first.item }; // asset row goes in, then the item PK collides
    expect(() => repo.insertImported(clash)).toThrow();
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
    expect(repo.findAssetsBySha(SHA_B)).toEqual([]);
  });

  it('rejects a second managed asset with the same content', () => {
    repo.insertImported(record(asset(SHA_A, 'managed')));
    expect(() => repo.insertImported(record(asset(SHA_A, 'managed')))).toThrow(/UNIQUE/);
  });

  it('requires an initial revision for a new asset', () => {
    const rec = { ...record(asset(SHA_A, 'managed')), revision: null };
    expect(() => repo.insertImported(rec)).toThrow(/initial revision/);
  });

  it('shares asset and revision when an item reuses an existing asset', () => {
    const a = asset(SHA_A, 'managed');
    const first = record(a);
    repo.insertImported(first);
    const second = record(a, false, 'copy');
    repo.insertImported(second);
    expect(repo.getItem(second.item.id)!.revisionId).toBe(first.revision!.id);
    expect(repo.itemIdsForAsset(a.id)).toEqual([first.item.id, second.item.id]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(1); // dedupe_key
  });

  it('finds assets by sha with managed first', () => {
    const linked = asset(SHA_A, 'linked');
    repo.insertImported(record(linked));
    const managed = asset(SHA_A, 'managed');
    repo.insertImported(record(managed));
    expect(repo.findAssetsBySha(SHA_A).map((x) => x.id)).toEqual([managed.id, linked.id]);
    expect(repo.findAssetsBySha(SHA_B)).toEqual([]);
    expect(repo.assetsByMode('linked').map((x) => x.id)).toEqual([linked.id]);
    expect(repo.allAssets()).toHaveLength(2);
  });

  it('updates availability and relinks linked assets', () => {
    const a = asset(SHA_B, 'linked');
    const rec = record(a);
    repo.insertImported(rec);
    repo.setAvailability(a.id, 'missing', nowIso());
    expect(repo.getItem(rec.item.id)!.availability).toBe('missing');
    repo.setExternalPath(a.id, '/new/place.pdf', nowIso());
    expect(repo.getAsset(a.id)).toMatchObject({ externalPath: '/new/place.pdf', availability: 'available' });
  });

  it('marks running jobs as interrupted', () => {
    repo.insertImported(record(asset(SHA_A, 'managed')));
    db.prepare(`UPDATE jobs SET state = 'running'`).run();
    expect(repo.markRunningJobsInterrupted(nowIso())).toBe(1);
    expect((db.prepare('SELECT state FROM jobs').get() as { state: string }).state).toBe('interrupted');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test packages/db`
Expected: FAIL — `LibraryRepository` export 없음.

- [ ] **Step 3: 구현** — `packages/db/src/library-repository.ts`

```ts
import type { Availability, ItemType, LibraryItem, StorageMode } from '@learn/domain';
import type { Db } from './connection';

export interface AssetRow {
  id: string;
  sha256: string;
  storageMode: StorageMode;
  relativePath: string | null;
  externalPath: string | null;
  originalName: string;
  mime: string;
  size: number;
  availability: Availability;
  createdAt: string;
  checkedAt: string | null;
}

export interface NewImportRecord {
  item: { id: string; type: ItemType; title: string; createdAt: string };
  asset: AssetRow;
  /** false when the item reuses an existing asset (then `revision` must be null). */
  assetIsNew: boolean;
  revision: { id: string; createdAt: string } | null;
  job: { id: string; kind: string; dedupeKey: string; payload: Record<string, unknown> } | null;
}

export interface LibraryCounts {
  items: number;
  assets: number;
  revisions: number;
}

interface AssetDbRow {
  id: string; sha256: string; storage_mode: StorageMode; relative_path: string | null; external_path: string | null;
  original_name: string; mime: string; size: number; availability: Availability; created_at: string; checked_at: string | null;
}
interface ItemDbRow {
  id: string; title: string; type: ItemType; created_at: string; asset_id: string; mime: string; size: number;
  storage_mode: StorageMode; availability: Availability; original_name: string; revision_id: string;
}

const ITEM_SELECT = `
SELECT i.id, i.title, i.type, i.created_at,
       a.id AS asset_id, a.mime, a.size, a.storage_mode, a.availability, a.original_name,
       (SELECT r.id FROM source_revisions r WHERE r.asset_id = a.id
         ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1) AS revision_id
FROM items i
JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
JOIN assets a ON a.id = ia.asset_id
WHERE i.deleted_at IS NULL`;

const toAsset = (r: AssetDbRow): AssetRow => ({
  id: r.id, sha256: r.sha256, storageMode: r.storage_mode, relativePath: r.relative_path, externalPath: r.external_path,
  originalName: r.original_name, mime: r.mime, size: r.size, availability: r.availability, createdAt: r.created_at, checkedAt: r.checked_at,
});

const toItem = (r: ItemDbRow): LibraryItem => ({
  id: r.id, title: r.title, type: r.type, mime: r.mime, size: r.size, storageMode: r.storage_mode,
  availability: r.availability, assetId: r.asset_id, revisionId: r.revision_id, originalName: r.original_name, createdAt: r.created_at,
});

export class LibraryRepository {
  constructor(private readonly db: Db) {}

  findAssetsBySha(sha256: string): AssetRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM assets WHERE sha256 = ? ORDER BY storage_mode = 'managed' DESC, created_at, rowid`)
      .all(sha256) as AssetDbRow[];
    return rows.map(toAsset);
  }

  getAsset(id: string): AssetRow | undefined {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as AssetDbRow | undefined;
    return row && toAsset(row);
  }

  allAssets(): AssetRow[] {
    return (this.db.prepare('SELECT * FROM assets ORDER BY created_at, rowid').all() as AssetDbRow[]).map(toAsset);
  }

  assetsByMode(mode: StorageMode): AssetRow[] {
    return (this.db.prepare('SELECT * FROM assets WHERE storage_mode = ? ORDER BY created_at, rowid').all(mode) as AssetDbRow[]).map(toAsset);
  }

  itemIdsForAsset(assetId: string): string[] {
    const rows = this.db
      .prepare(`SELECT i.id FROM items i JOIN item_assets ia ON ia.item_id = i.id
                WHERE ia.asset_id = ? AND i.deleted_at IS NULL ORDER BY i.created_at, i.rowid`)
      .all(assetId) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /** item + (new asset + first revision) + item_asset + extract job, all-or-nothing. */
  insertImported(rec: NewImportRecord): void {
    if (rec.assetIsNew && !rec.revision) throw new Error('a new asset requires an initial revision');
    const a = rec.asset;
    this.db.transaction(() => {
      if (rec.assetIsNew) {
        this.db
          .prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, availability, created_at, checked_at)
                    VALUES (@id, @sha256, @storageMode, @relativePath, @externalPath, @originalName, @mime, @size, @availability, @createdAt, @checkedAt)`)
          .run(a);
      }
      this.db
        .prepare(`INSERT INTO items (id, type, title, metadata_json, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, ?)`)
        .run(rec.item.id, rec.item.type, rec.item.title, rec.item.createdAt, rec.item.createdAt);
      this.db.prepare(`INSERT INTO item_assets (item_id, asset_id, role) VALUES (?, ?, 'original')`).run(rec.item.id, a.id);
      if (rec.revision) {
        this.db
          .prepare(`INSERT INTO source_revisions (id, asset_id, hash, parent_revision_id, renderer_version, created_at) VALUES (?, ?, ?, NULL, NULL, ?)`)
          .run(rec.revision.id, a.id, a.sha256, rec.revision.createdAt);
      }
      if (rec.job) {
        this.db
          .prepare(`INSERT OR IGNORE INTO jobs (id, kind, dedupe_key, state, attempts, payload_json, created_at, updated_at)
                    VALUES (?, ?, ?, 'queued', 0, ?, ?, ?)`)
          .run(rec.job.id, rec.job.kind, rec.job.dedupeKey, JSON.stringify(rec.job.payload), rec.item.createdAt, rec.item.createdAt);
      }
    })();
  }

  listItems(): LibraryItem[] {
    return (this.db.prepare(`${ITEM_SELECT} ORDER BY i.created_at DESC, i.rowid DESC`).all() as ItemDbRow[]).map(toItem);
  }

  getItem(id: string): LibraryItem | undefined {
    const row = this.db.prepare(`${ITEM_SELECT} AND i.id = ?`).get(id) as ItemDbRow | undefined;
    return row && toItem(row);
  }

  setAvailability(assetId: string, availability: Availability, checkedAt: string): void {
    this.db.prepare('UPDATE assets SET availability = ?, checked_at = ? WHERE id = ?').run(availability, checkedAt, assetId);
  }

  setExternalPath(assetId: string, externalPath: string, checkedAt: string): void {
    this.db
      .prepare(`UPDATE assets SET external_path = ?, availability = 'available', checked_at = ? WHERE id = ? AND storage_mode = 'linked'`)
      .run(externalPath, checkedAt, assetId);
  }

  markRunningJobsInterrupted(now: string): number {
    return this.db.prepare(`UPDATE jobs SET state = 'interrupted', updated_at = ? WHERE state = 'running'`).run(now).changes;
  }

  counts(): LibraryCounts {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      items: n('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL'),
      assets: n('SELECT COUNT(*) AS n FROM assets'),
      revisions: n('SELECT COUNT(*) AS n FROM source_revisions'),
    };
  }
}
```

`packages/db/src/index.ts`에 추가:
```ts
export * from './library-repository';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test packages/db && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): library repository with atomic import insert

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 4: `@learn/library` 기본 요소 — 레이아웃·경로 해석·형식 판별·해시

**Files:**
- Create: `packages/library/package.json`, `packages/library/tsconfig.json`
- Create: `packages/library/src/{layout,resolve,sniff,hash,index}.ts`
- Create: `packages/library/test/helpers.ts`
- Test: `packages/library/test/primitives.test.ts`

**Interfaces:**
- Consumes: `AssetRow` (Task 3), `LearnError`, `ItemType` (Task 1)
- Produces:
  - `interface LibraryLayout {root, dbFile, assetsDir, stagingDir, derivedDir, exportsDir}`, `libraryLayout(root)`, `ensureLayout(layout)`, `managedRelativePath(sha) → 'assets/<2>/<sha>'`
  - `resolveAssetPath(layout, asset): string` (관리형은 `assetsDir` 밖이면 `PERMISSION_DENIED`)
  - `interface SniffResult {type: ItemType; mime: string}`, `sniffFile(path): Promise<SniffResult|null>`
  - `sha256File(path): Promise<string>`
  - test helpers: `tempDir()`, `writePdf(dir, name, text)`, `writeMp4(dir, name, seed)`, `cleanupTemp()`

- [ ] **Step 1: 패키지 설정**

`packages/library/package.json`:
```json
{
  "name": "@learn/library",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": {
    "@learn/db": "workspace:*",
    "@learn/domain": "workspace:*"
  }
}
```

`packages/library/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run: `pnpm install`

- [ ] **Step 2: 테스트 도우미** — `packages/library/test/helpers.ts`

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

export function tempDir(prefix = 'lib'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `learn-${prefix}-`));
  created.push(d);
  return d;
}

export function cleanupTemp(): void {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** Minimal bytes that sniff as PDF; content differs per `text` so hashes differ. */
export function writePdf(dir: string, name: string, text: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${text}\n%%EOF\n`);
  return p;
}

/** Minimal bytes that sniff as an ISO-BMFF (MP4) file. */
export function writeMp4(dir: string, name: string, seed: string): string {
  const p = path.join(dir, name);
  const box = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
  fs.writeFileSync(p, Buffer.concat([box, Buffer.from(seed)]));
  return p;
}
```

- [ ] **Step 3: 실패하는 테스트** — `packages/library/test/primitives.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError, newId, nowIso } from '@learn/domain';
import type { AssetRow } from '@learn/db';
import { ensureLayout, libraryLayout, managedRelativePath, resolveAssetPath, sha256File, sniffFile } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

afterEach(cleanupTemp);

describe('layout', () => {
  it('creates the library directory structure', () => {
    const layout = libraryLayout(path.join(tempDir(), 'Library'));
    ensureLayout(layout);
    for (const d of [layout.assetsDir, layout.stagingDir, layout.derivedDir, layout.exportsDir]) expect(fs.statSync(d).isDirectory()).toBe(true);
    expect(layout.dbFile.endsWith('library.sqlite')).toBe(true);
  });
  it('shards managed assets by hash prefix', () => {
    expect(managedRelativePath('ab'.padEnd(64, 'c'))).toBe(`assets/ab/${'ab'.padEnd(64, 'c')}`);
  });
});

describe('resolveAssetPath', () => {
  const base = (over: Partial<AssetRow>): AssetRow => ({
    id: newId(), sha256: 'a'.repeat(64), storageMode: 'managed', relativePath: null, externalPath: null,
    originalName: 'x', mime: 'application/pdf', size: 1, availability: 'available', createdAt: nowIso(), checkedAt: null, ...over,
  });
  it('resolves managed paths inside assets/ and refuses escapes', () => {
    const layout = libraryLayout(tempDir());
    expect(resolveAssetPath(layout, base({ relativePath: managedRelativePath('a'.repeat(64)) }))).toBe(path.join(layout.assetsDir, 'aa', 'a'.repeat(64)));
    expect(() => resolveAssetPath(layout, base({ relativePath: '../../etc/passwd' }))).toThrow(LearnError);
  });
  it('returns external paths for linked assets', () => {
    const layout = libraryLayout(tempDir());
    expect(resolveAssetPath(layout, base({ storageMode: 'linked', externalPath: '/Users/me/a.pdf' }))).toBe('/Users/me/a.pdf');
  });
});

describe('sniffFile', () => {
  it('detects pdf and mp4 by magic bytes, not by extension', async () => {
    const d = tempDir();
    expect(await sniffFile(writePdf(d, 'renamed.bin', 'x'))).toEqual({ type: 'pdf', mime: 'application/pdf' });
    expect(await sniffFile(writeMp4(d, 'clip.mp4', 'x'))).toEqual({ type: 'video', mime: 'video/mp4' });
    expect(await sniffFile(writeMp4(d, 'clip.mov', 'x'))).toEqual({ type: 'video', mime: 'video/quicktime' });
    const txt = path.join(d, 'notes.pdf');
    fs.writeFileSync(txt, 'just text');
    expect(await sniffFile(txt)).toBeNull();
  });
});

describe('sha256File', () => {
  it('hashes file contents', async () => {
    const d = tempDir();
    const p = path.join(d, 'a.txt');
    fs.writeFileSync(p, 'abc');
    expect(await sha256File(p)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm test packages/library`
Expected: FAIL — `../src/index` 없음.

- [ ] **Step 5: 구현**

`packages/library/src/layout.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';

export interface LibraryLayout {
  root: string;
  dbFile: string;
  assetsDir: string;
  stagingDir: string;
  derivedDir: string;
  exportsDir: string;
}

export function libraryLayout(root: string): LibraryLayout {
  const r = path.resolve(root);
  return {
    root: r,
    dbFile: path.join(r, 'library.sqlite'),
    assetsDir: path.join(r, 'assets'),
    stagingDir: path.join(r, 'staging'),
    derivedDir: path.join(r, 'derived'),
    exportsDir: path.join(r, 'exports'),
  };
}

export function ensureLayout(layout: LibraryLayout): void {
  for (const d of [layout.root, layout.assetsDir, layout.stagingDir, layout.derivedDir, layout.exportsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

/** Library-relative POSIX path stored in assets.relative_path. File names are hashes only. */
export const managedRelativePath = (sha256: string): string => `assets/${sha256.slice(0, 2)}/${sha256}`;
```

`packages/library/src/resolve.ts`:
```ts
import path from 'node:path';
import { LearnError } from '@learn/domain';
import type { AssetRow } from '@learn/db';
import type { LibraryLayout } from './layout';

/** Absolute path of an asset's bytes. Managed paths must stay inside assets/. */
export function resolveAssetPath(layout: LibraryLayout, asset: AssetRow): string {
  if (asset.storageMode === 'linked') {
    if (!asset.externalPath) throw new LearnError('INTERNAL', '외부 연결 경로가 비어 있습니다.');
    return asset.externalPath;
  }
  if (!asset.relativePath) throw new LearnError('INTERNAL', '관리형 자료 경로가 비어 있습니다.');
  const abs = path.resolve(layout.root, ...asset.relativePath.split('/'));
  if (!abs.startsWith(layout.assetsDir + path.sep)) {
    throw new LearnError('PERMISSION_DENIED', '라이브러리 밖의 경로는 열 수 없습니다.');
  }
  return abs;
}
```

`packages/library/src/sniff.ts`:
```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ItemType } from '@learn/domain';

export interface SniffResult {
  type: ItemType;
  mime: string;
}

const ISO_BMFF_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime' };

/** Decide the type from magic bytes; the extension only refines the video MIME. */
export async function sniffFile(filePath: string): Promise<SniffResult | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    const head = buf.subarray(0, bytesRead);
    const ext = path.extname(filePath).toLowerCase();
    if (head.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'pdf', mime: 'application/pdf' };
    if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
      return { type: 'video', mime: ISO_BMFF_MIME[ext] ?? 'video/mp4' };
    }
    if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) {
      return { type: 'video', mime: ext === '.mkv' ? 'video/x-matroska' : 'video/webm' };
    }
    return null;
  } finally {
    await fh.close();
  }
}
```

`packages/library/src/hash.ts`:
```ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}
```

`packages/library/src/index.ts`:
```ts
export * from './hash';
export * from './layout';
export * from './resolve';
export * from './sniff';
```

- [ ] **Step 6: 통과 확인**

Run: `pnpm test packages/library && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(library): library layout, asset path resolution, type sniffing, hashing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 5: 가져오기 파이프라인 (`Importer`)

**Files:**
- Create: `packages/library/src/importer.ts`
- Modify: `packages/library/src/index.ts`
- Test: `packages/library/test/importer.test.ts`

**Interfaces:**
- Consumes: Task 3 `LibraryRepository`, Task 4 `LibraryLayout, managedRelativePath, sha256File, sniffFile`, Task 1 `ImportOutcome, LearnError, toLearnError, newId, nowIso, StorageMode`
- Produces:
  - `EXTRACTOR_VERSION = 'text-v0'`
  - `interface ImportHooks { afterStage?(stagingFile), afterPlace?(assetFile), beforeCommit?() }` (테스트용 결함 주입)
  - `interface ImportOptions { mode: StorageMode; allowDuplicate?: boolean }`
  - `class Importer({layout, repo, hooks?})`: `importOne(path, opts): Promise<ImportOutcome>`, `importMany(paths, opts): Promise<ImportOutcome[]>` (순차)

- [ ] **Step 1: 실패하는 테스트** — `packages/library/test/importer.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, ensureLayout, libraryLayout, resolveAssetPath, sha256File, type ImportHooks } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

function setup(hooks?: ImportHooks) {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  return { layout, db, repo, importer: new Importer({ layout, repo, hooks }) };
}
const jobs = (db: Db) => db.prepare('SELECT kind, dedupe_key, state FROM jobs').all();

describe('managed import', () => {
  it('copies into assets/, records item/asset/revision/job, and leaves the source untouched', async () => {
    const { layout, repo, db, importer } = setup();
    const src = writePdf(tempDir('src'), 'Chapter 06.pdf', 'chapter six');
    const before = fs.readFileSync(src);
    const out = await importer.importOne(src, { mode: 'managed' });
    expect(out.status).toBe('imported');
    if (out.status !== 'imported') return;
    expect(out.item).toMatchObject({ title: 'Chapter 06', type: 'pdf', storageMode: 'managed', availability: 'available', originalName: 'Chapter 06.pdf' });
    const asset = repo.getAsset(out.item.assetId)!;
    const stored = resolveAssetPath(layout, asset);
    expect(await sha256File(stored)).toBe(asset.sha256);
    expect(fs.readFileSync(src)).toEqual(before);
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
    expect(jobs(db)).toEqual([{ kind: 'extract', dedupe_key: `extract:${asset.sha256}:text-v0`, state: 'queued' }]);
  });

  it('keeps working after the original file is moved away (AC01)', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writeMp4(dir, 'Lecture 04.mp4', 'lecture four');
    const out = await importer.importOne(src, { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    fs.renameSync(src, path.join(dir, 'moved.mp4'));
    const stored = resolveAssetPath(layout, repo.getAsset(out.item.assetId)!);
    expect(fs.existsSync(stored)).toBe(true);
  });

  it('handles Korean, spaces and special characters in paths', async () => {
    const { importer } = setup();
    const dir = path.join(tempDir('src'), '강의 자료 (1) #&');
    fs.mkdirSync(dir);
    const out = await importer.importOne(writePdf(dir, '신호 전달 #2 [최종].pdf', 'ko'), { mode: 'managed' });
    expect(out.status === 'imported' && out.item.title).toBe('신호 전달 #2 [최종]');
  });
});

describe('duplicates (AC02)', () => {
  it('reports a duplicate without writing anything and never deletes the source', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    const first = await importer.importOne(src, { mode: 'managed' });
    const second = await importer.importOne(src, { mode: 'managed' });
    expect(second).toEqual({ status: 'duplicate', path: src, existingItemId: first.status === 'imported' ? first.item.id : '' });
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
    expect(fs.existsSync(src)).toBe(true);
  });

  it('adds a new item sharing the asset when allowDuplicate is set', async () => {
    const { repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'same');
    await importer.importOne(src, { mode: 'managed' });
    const again = await importer.importOne(src, { mode: 'managed', allowDuplicate: true });
    expect(again.status).toBe('imported');
    expect(repo.counts()).toEqual({ items: 2, assets: 1, revisions: 1 });
  });

  it('detects duplicates by content even under a different name', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    await importer.importOne(writePdf(dir, 'a.pdf', 'same'), { mode: 'managed' });
    const out = await importer.importOne(writePdf(dir, 'renamed copy.pdf', 'same'), { mode: 'linked' });
    expect(out.status).toBe('duplicate');
  });
});

describe('linked import', () => {
  it('records the external path without copying', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'linked.pdf', 'linked');
    const out = await importer.importOne(src, { mode: 'linked' });
    if (out.status !== 'imported') throw new Error(out.status);
    expect(repo.getAsset(out.item.assetId)).toMatchObject({ storageMode: 'linked', externalPath: src, relativePath: null });
    expect(fs.readdirSync(layout.assetsDir)).toEqual([]);
  });
});

describe('failures', () => {
  it('rejects unsupported and missing files with codes', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const txt = path.join(dir, 'notes.txt');
    fs.writeFileSync(txt, 'hello');
    expect(await importer.importOne(txt, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_TYPE' });
    expect(await importer.importOne(path.join(dir, 'nope.pdf'), { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'NOT_FOUND' });
    expect(await importer.importOne(dir, { mode: 'managed' })).toMatchObject({ status: 'failed', code: 'UNSUPPORTED_TYPE' });
  });

  it('leaves no DB rows and no staging file when copying fails after staging', async () => {
    const { layout, repo, importer } = setup({ afterStage: () => { throw new Error('disk yanked'); } });
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'x'), { mode: 'managed' });
    expect(out).toMatchObject({ status: 'failed', code: 'INTERNAL' });
    expect(repo.counts()).toEqual({ items: 0, assets: 0, revisions: 0 });
    expect(fs.readdirSync(layout.stagingDir)).toEqual([]);
  });

  it('leaves no DB rows when the commit step fails; the placed file is reused on retry', async () => {
    let fail = true;
    const { repo, importer } = setup({ beforeCommit: () => { if (fail) throw new Error('crash before commit'); } });
    const src = writePdf(tempDir('src'), 'a.pdf', 'x');
    expect((await importer.importOne(src, { mode: 'managed' })).status).toBe('failed');
    expect(repo.counts().items).toBe(0);
    fail = false;
    const retry = await importer.importOne(src, { mode: 'managed' });
    expect(retry.status).toBe('imported');
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
  });

  it('imports many files sequentially and reports each outcome', async () => {
    const { importer } = setup();
    const dir = tempDir('src');
    const outs = await importer.importMany([writePdf(dir, 'a.pdf', 'a'), writeMp4(dir, 'b.mp4', 'b'), path.join(dir, 'missing.pdf')], { mode: 'managed' });
    expect(outs.map((o) => o.status)).toEqual(['imported', 'imported', 'failed']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test packages/library`
Expected: FAIL — `Importer` export 없음.

- [ ] **Step 3: 구현** — `packages/library/src/importer.ts`

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, newId, nowIso, toLearnError, type ImportOutcome, type StorageMode } from '@learn/domain';
import type { AssetRow, LibraryRepository } from '@learn/db';
import { sha256File } from './hash';
import { managedRelativePath, type LibraryLayout } from './layout';
import { sniffFile } from './sniff';

export const EXTRACTOR_VERSION = 'text-v0';

/** Fault-injection points for tests. Production passes none. */
export interface ImportHooks {
  afterStage?(stagingFile: string): void | Promise<void>;
  afterPlace?(assetFile: string): void | Promise<void>;
  beforeCommit?(): void | Promise<void>;
}

export interface ImportOptions {
  mode: StorageMode;
  allowDuplicate?: boolean;
}

export class Importer {
  constructor(private readonly deps: { layout: LibraryLayout; repo: LibraryRepository; hooks?: ImportHooks | undefined }) {}

  /** Sequential on purpose: one writer, predictable disk usage. */
  async importMany(paths: readonly string[], opts: ImportOptions): Promise<ImportOutcome[]> {
    const outcomes: ImportOutcome[] = [];
    for (const p of paths) outcomes.push(await this.importOne(p, opts));
    return outcomes;
  }

  async importOne(inputPath: string, opts: ImportOptions): Promise<ImportOutcome> {
    const src = path.resolve(inputPath);
    try {
      return await this.run(src, opts);
    } catch (e) {
      const le = toLearnError(e, '가져오기에 실패했습니다.');
      return { status: 'failed', path: src, code: le.code, message: le.message };
    }
  }

  private async run(src: string, opts: ImportOptions): Promise<ImportOutcome> {
    const { repo, hooks } = this.deps;
    const st = await fs.stat(src);
    if (!st.isFile()) throw new LearnError('UNSUPPORTED_TYPE', '일반 파일만 가져올 수 있습니다.');
    const kind = await sniffFile(src);
    if (!kind) throw new LearnError('UNSUPPORTED_TYPE', '지원하지 않는 형식입니다. 지금은 PDF와 동영상(MP4·MOV·WebM)을 가져올 수 있습니다.');
    const sha256 = await sha256File(src);

    const existing = repo.findAssetsBySha(sha256);
    const existingItemId = existing.map((a) => repo.itemIdsForAsset(a.id)[0]).find((id) => id !== undefined);
    if (existingItemId && !opts.allowDuplicate) return { status: 'duplicate', path: src, existingItemId };

    const now = nowIso();
    const reusable =
      opts.mode === 'managed'
        ? existing.find((a) => a.storageMode === 'managed')
        : existing.find((a) => a.storageMode === 'linked' && a.externalPath === src);
    let asset: AssetRow;
    if (reusable) {
      asset = reusable;
    } else {
      asset = {
        id: newId(), sha256, storageMode: opts.mode, relativePath: null, externalPath: null,
        originalName: path.basename(src), mime: kind.mime, size: st.size, availability: 'available', createdAt: now, checkedAt: now,
      };
      if (opts.mode === 'managed') asset.relativePath = await this.place(src, sha256);
      else asset.externalPath = src;
    }

    await hooks?.beforeCommit?.();
    const item = { id: newId(), type: kind.type, title: titleFromFile(src), createdAt: now };
    repo.insertImported({
      item,
      asset,
      assetIsNew: !reusable,
      revision: reusable ? null : { id: newId(), createdAt: now },
      job: { id: newId(), kind: 'extract', dedupeKey: `extract:${sha256}:${EXTRACTOR_VERSION}`, payload: { sha256, type: kind.type } },
    });
    const saved = repo.getItem(item.id);
    if (!saved) throw new LearnError('INTERNAL', '가져온 항목을 다시 읽지 못했습니다.');
    return { status: 'imported', path: src, item: saved };
  }

  /**
   * staging copy → verify hash → atomic rename into assets/. Returns the library-relative path.
   * A file already at the target (left by an earlier interrupted import) is verified and reused.
   */
  private async place(src: string, sha256: string): Promise<string> {
    const { layout, hooks } = this.deps;
    const rel = managedRelativePath(sha256);
    const target = path.join(layout.root, ...rel.split('/'));
    const staging = path.join(layout.stagingDir, `${newId()}.part`);
    try {
      await fs.copyFile(src, staging);
      if ((await sha256File(staging)) !== sha256) {
        throw new LearnError('HASH_MISMATCH', '복사하는 동안 원본 파일이 바뀌었습니다. 다시 시도하세요.', { retryable: true });
      }
      await hooks?.afterStage?.(staging);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (await exists(target)) {
        if ((await sha256File(target)) !== sha256) {
          throw new LearnError('HASH_MISMATCH', '라이브러리에 있는 같은 이름의 파일이 손상되었습니다. 복구 안내를 확인하세요.');
        }
      } else {
        await fs.rename(staging, target);
      }
      await hooks?.afterPlace?.(target);
      return rel;
    } finally {
      await fs.rm(staging, { force: true });
    }
  }
}

const titleFromFile = (p: string): string => path.basename(p, path.extname(p)) || path.basename(p);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
```

`packages/library/src/index.ts`에 추가:
```ts
export * from './importer';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test packages/library && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(library): import pipeline with staging, hash verify, atomic placement, duplicates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 6: 복구 스캔 · 가용성 · 재연결

**Files:**
- Create: `packages/library/src/recovery.ts`, `packages/library/src/availability.ts`
- Modify: `packages/library/src/index.ts`
- Test: `packages/library/test/recovery.test.ts`

**Interfaces:**
- Consumes: Task 3–5
- Produces:
  - `scanRecovery(layout, repo): Promise<RecoveryReport>` — staging 잔여·참조 없는 자산·사라진 관리형 자산 보고, running→interrupted, 사라진 관리형은 availability=missing. **아무것도 삭제하지 않음.**
  - `refreshAvailability(layout, repo, asset): Promise<Availability>`
  - `refreshLinkedAvailability(layout, repo): Promise<void>`
  - `relinkAsset(repo, assetId, newPath): Promise<void>` — linked 전용, 해시 일치 필수(`HASH_MISMATCH`)

- [ ] **Step 1: 실패하는 테스트** — `packages/library/test/recovery.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import {
  Importer, ensureLayout, libraryLayout, refreshAvailability, refreshLinkedAvailability, relinkAsset, resolveAssetPath, scanRecovery,
} from '../src/index';
import { cleanupTemp, tempDir, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  cleanupTemp();
});

function setup() {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  return { layout, db, repo, importer: new Importer({ layout, repo }) };
}

describe('scanRecovery', () => {
  it('reports a clean library as clean', async () => {
    const { layout, repo, importer } = setup();
    await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'a'), { mode: 'managed' });
    expect(await scanRecovery(layout, repo)).toEqual({ stagingLeftovers: [], unreferencedAssets: [], missingManagedAssets: [], interruptedJobs: 0 });
  });

  it('reports staging leftovers and unreferenced assets without deleting them', async () => {
    const { layout, repo } = setup();
    fs.writeFileSync(path.join(layout.stagingDir, 'dead.part'), 'partial');
    const orphanRel = `assets/ff/${'f'.repeat(64)}`;
    fs.mkdirSync(path.join(layout.assetsDir, 'ff'));
    fs.writeFileSync(path.join(layout.root, orphanRel), 'orphan');
    const report = await scanRecovery(layout, repo);
    expect(report.stagingLeftovers).toEqual(['dead.part']);
    expect(report.unreferencedAssets).toEqual([orphanRel]);
    expect(fs.existsSync(path.join(layout.stagingDir, 'dead.part'))).toBe(true);
    expect(fs.existsSync(path.join(layout.root, orphanRel))).toBe(true);
  });

  it('flags managed assets whose file vanished and interrupts running jobs', async () => {
    const { layout, db, repo, importer } = setup();
    const out = await importer.importOne(writePdf(tempDir('src'), 'a.pdf', 'a'), { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    fs.rmSync(resolveAssetPath(layout, repo.getAsset(out.item.assetId)!));
    db.prepare(`UPDATE jobs SET state = 'running'`).run();
    const report = await scanRecovery(layout, repo);
    expect(report.missingManagedAssets).toEqual([out.item.assetId]);
    expect(report.interruptedJobs).toBe(1);
    expect(repo.getItem(out.item.id)!.availability).toBe('missing');
  });
});

describe('linked availability and relink', () => {
  it('marks a moved linked file missing, then relinks only to identical content', async () => {
    const { layout, repo, importer } = setup();
    const dir = tempDir('src');
    const src = writePdf(dir, 'paper.pdf', 'paper');
    const out = await importer.importOne(src, { mode: 'linked' });
    if (out.status !== 'imported') throw new Error(out.status);
    const moved = path.join(dir, 'paper (moved).pdf');
    fs.renameSync(src, moved);

    await refreshLinkedAvailability(layout, repo);
    expect(repo.getItem(out.item.id)!.availability).toBe('missing');

    const other = writePdf(dir, 'other.pdf', 'different');
    await expect(relinkAsset(repo, out.item.assetId, other)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });

    await relinkAsset(repo, out.item.assetId, moved);
    expect(repo.getAsset(out.item.assetId)).toMatchObject({ externalPath: moved, availability: 'available' });
    expect(await refreshAvailability(layout, repo, repo.getAsset(out.item.assetId)!)).toBe('available');
  });

  it('refuses to relink managed assets', async () => {
    const { layout, repo, importer } = setup();
    const src = writePdf(tempDir('src'), 'a.pdf', 'a');
    const out = await importer.importOne(src, { mode: 'managed' });
    if (out.status !== 'imported') throw new Error(out.status);
    await expect(relinkAsset(repo, out.item.assetId, src)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test packages/library`
Expected: FAIL — `scanRecovery` 등 export 없음.

- [ ] **Step 3: 구현**

`packages/library/src/recovery.ts`:
```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, type RecoveryReport } from '@learn/domain';
import type { LibraryRepository } from '@learn/db';
import type { LibraryLayout } from './layout';

/**
 * Startup scan. Reports leftovers from interrupted imports and inconsistencies; it never deletes.
 * Side effects: running jobs → interrupted, vanished managed assets → availability 'missing'.
 */
export async function scanRecovery(layout: LibraryLayout, repo: LibraryRepository): Promise<RecoveryReport> {
  const now = nowIso();
  const interruptedJobs = repo.markRunningJobsInterrupted(now);
  const stagingLeftovers = (await readdirSafe(layout.stagingDir)).sort();

  const onDisk: string[] = [];
  for (const prefix of await readdirSafe(layout.assetsDir)) {
    for (const name of await readdirSafe(path.join(layout.assetsDir, prefix))) onDisk.push(`assets/${prefix}/${name}`);
  }
  const managed = repo.assetsByMode('managed');
  const referenced = new Set(managed.map((a) => a.relativePath));
  const present = new Set(onDisk);
  const unreferencedAssets = onDisk.filter((rel) => !referenced.has(rel)).sort();
  const missing = managed.filter((a) => a.relativePath !== null && !present.has(a.relativePath));
  for (const a of missing) if (a.availability !== 'missing') repo.setAvailability(a.id, 'missing', now);

  return { stagingLeftovers, unreferencedAssets, missingManagedAssets: missing.map((a) => a.id).sort(), interruptedJobs };
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
    throw e;
  }
}
```

`packages/library/src/availability.ts`:
```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, nowIso, type Availability } from '@learn/domain';
import type { AssetRow, LibraryRepository } from '@learn/db';
import { sha256File } from './hash';
import type { LibraryLayout } from './layout';
import { resolveAssetPath } from './resolve';

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function refreshAvailability(layout: LibraryLayout, repo: LibraryRepository, asset: AssetRow): Promise<Availability> {
  const availability: Availability = (await isFile(resolveAssetPath(layout, asset))) ? 'available' : 'missing';
  if (availability !== asset.availability) repo.setAvailability(asset.id, availability, nowIso());
  return availability;
}

export async function refreshLinkedAvailability(layout: LibraryLayout, repo: LibraryRepository): Promise<void> {
  for (const asset of repo.assetsByMode('linked')) await refreshAvailability(layout, repo, asset);
}

/** Point a linked asset at a new location — only if the bytes are identical. */
export async function relinkAsset(repo: LibraryRepository, assetId: string, newPath: string): Promise<void> {
  const asset = repo.getAsset(assetId);
  if (!asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
  if (asset.storageMode !== 'linked') throw new LearnError('VALIDATION_FAILED', '복사해 온 자료는 다시 연결할 필요가 없습니다.');
  const abs = path.resolve(newPath);
  if (!(await isFile(abs))) throw new LearnError('NOT_FOUND', '선택한 파일을 찾을 수 없습니다.');
  if ((await sha256File(abs)) !== asset.sha256) {
    throw new LearnError('HASH_MISMATCH', '선택한 파일의 내용이 원래 자료와 다릅니다. 같은 파일을 선택하세요.');
  }
  repo.setExternalPath(asset.id, abs, nowIso());
}
```

`packages/library/src/index.ts`에 추가:
```ts
export * from './availability';
export * from './recovery';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test packages/library && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(library): recovery scan, linked availability and hash-checked relink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 7: 백업 · 복원

**Files:**
- Create: `packages/library/src/backup.ts`
- Modify: `packages/library/src/index.ts`
- Test: `packages/library/test/backup.test.ts`

**Interfaces:**
- Consumes: `snapshotDatabase, currentVersion, openDatabase, migrate, LibraryRepository, Db` (Task 2–3), Task 4–5
- Produces:
  - `interface BackupManifest {format:'learn-backup', formatVersion:1, createdAt, schemaVersion, counts: LibraryCounts, assets: BackupAssetEntry[]}`
  - `interface BackupAssetEntry {assetId, sha256, storageMode, relativePath, externalPath, size, included}`
  - `createBackup({layout, db, repo, destDir, includeAssets}): Promise<BackupManifest>` — `destDir`는 없거나 비어 있어야 함
  - `interface RestoreResult {verifiedAssets: number; missingAssets: string[]; hashMismatches: string[]; counts: LibraryCounts; countsMatch: boolean}`
  - `restoreBackup({backupDir, targetRoot}): Promise<RestoreResult>` — `targetRoot`는 없거나 비어 있어야 함

- [ ] **Step 1: 실패하는 테스트** — `packages/library/test/backup.test.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import { Importer, createBackup, ensureLayout, libraryLayout, resolveAssetPath, restoreBackup, sha256File } from '../src/index';
import { cleanupTemp, tempDir, writeMp4, writePdf } from './helpers';

const dbs: Db[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close();
  cleanupTemp();
});

async function populated() {
  const layout = libraryLayout(path.join(tempDir(), 'Library'));
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  dbs.push(db);
  migrate(db, { dbFile: layout.dbFile });
  const repo = new LibraryRepository(db);
  const importer = new Importer({ layout, repo });
  const src = tempDir('src');
  await importer.importOne(writePdf(src, 'a.pdf', 'a'), { mode: 'managed' });
  await importer.importOne(writeMp4(src, 'b.mp4', 'b'), { mode: 'managed' });
  await importer.importOne(writePdf(src, 'c.pdf', 'c'), { mode: 'linked' });
  return { layout, db, repo };
}

describe('backup and restore (AC15 — files part)', () => {
  it('restores into an empty profile with matching hashes and counts', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-1');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    expect(manifest).toMatchObject({ format: 'learn-backup', formatVersion: 1, schemaVersion: 1, counts: { items: 3, assets: 3, revisions: 3 } });
    expect(manifest.assets.filter((a) => a.included)).toHaveLength(2); // linked is reference-only

    const target = path.join(tempDir('restore'), 'Library');
    const result = await restoreBackup({ backupDir: dest, targetRoot: target });
    expect(result).toEqual({ verifiedAssets: 2, missingAssets: [], hashMismatches: [], counts: { items: 3, assets: 3, revisions: 3 }, countsMatch: true });

    const rdb = openDatabase(libraryLayout(target).dbFile);
    dbs.push(rdb);
    const rrepo = new LibraryRepository(rdb);
    for (const a of rrepo.assetsByMode('managed')) {
      expect(await sha256File(resolveAssetPath(libraryLayout(target), a))).toBe(a.sha256);
    }
  });

  it('detects corrupted asset copies in a backup', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-2');
    const manifest = await createBackup({ layout, db, repo, destDir: dest, includeAssets: true });
    const victim = manifest.assets.find((a) => a.included)!;
    fs.appendFileSync(path.join(dest, ...victim.relativePath!.split('/')), 'tampered');
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') });
    expect(result.hashMismatches).toEqual([victim.assetId]);
  });

  it('records managed assets as missing when the backup excludes files', async () => {
    const { layout, db, repo } = await populated();
    const dest = path.join(tempDir('bk'), 'backup-3');
    await createBackup({ layout, db, repo, destDir: dest, includeAssets: false });
    const result = await restoreBackup({ backupDir: dest, targetRoot: path.join(tempDir('restore'), 'Library') });
    expect(result.missingAssets).toHaveLength(2);
    expect(result.verifiedAssets).toBe(0);
  });

  it('refuses non-empty destinations', async () => {
    const { layout, db, repo } = await populated();
    const dest = tempDir('bk');
    fs.writeFileSync(path.join(dest, 'keep.txt'), 'x');
    await expect(createBackup({ layout, db, repo, destDir: dest, includeAssets: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const good = path.join(tempDir('bk'), 'ok');
    await createBackup({ layout, db, repo, destDir: good, includeAssets: true });
    await expect(restoreBackup({ backupDir: good, targetRoot: dest })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test packages/library`
Expected: FAIL — `createBackup` export 없음.

- [ ] **Step 3: 구현** — `packages/library/src/backup.ts`

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { LearnError, nowIso, type StorageMode } from '@learn/domain';
import { LibraryRepository, currentVersion, migrate, openDatabase, snapshotDatabase, type Db, type LibraryCounts } from '@learn/db';
import { sha256File } from './hash';
import { ensureLayout, libraryLayout, type LibraryLayout } from './layout';
import { resolveAssetPath } from './resolve';

export interface BackupAssetEntry {
  assetId: string;
  sha256: string;
  storageMode: StorageMode;
  relativePath: string | null;
  externalPath: string | null;
  size: number;
  /** Linked assets are never included: external paths are not portable. */
  included: boolean;
}

export interface BackupManifest {
  format: 'learn-backup';
  formatVersion: 1;
  createdAt: string;
  schemaVersion: number;
  counts: LibraryCounts;
  assets: BackupAssetEntry[];
}

export interface RestoreResult {
  verifiedAssets: number;
  missingAssets: string[];
  hashMismatches: string[];
  counts: LibraryCounts;
  countsMatch: boolean;
}

async function assertEmptyDir(dir: string, message: string): Promise<void> {
  try {
    if ((await fs.readdir(dir)).length > 0) throw new LearnError('VALIDATION_FAILED', message);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

/** Consistent DB snapshot (VACUUM INTO) + managed asset copies + manifest. */
export async function createBackup(args: {
  layout: LibraryLayout; db: Db; repo: LibraryRepository; destDir: string; includeAssets: boolean;
}): Promise<BackupManifest> {
  const { layout, db, repo, destDir, includeAssets } = args;
  await assertEmptyDir(destDir, '백업 폴더가 비어 있지 않습니다. 새 폴더를 선택하세요.');
  await fs.mkdir(destDir, { recursive: true });
  snapshotDatabase(db, path.join(destDir, 'library.sqlite'));

  const assets: BackupAssetEntry[] = [];
  for (const a of repo.allAssets()) {
    let included = false;
    if (includeAssets && a.storageMode === 'managed' && a.relativePath) {
      const dst = path.join(destDir, ...a.relativePath.split('/'));
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(resolveAssetPath(layout, a), dst);
      included = true;
    }
    assets.push({ assetId: a.id, sha256: a.sha256, storageMode: a.storageMode, relativePath: a.relativePath, externalPath: a.externalPath, size: a.size, included });
  }
  const manifest: BackupManifest = {
    format: 'learn-backup', formatVersion: 1, createdAt: nowIso(), schemaVersion: currentVersion(db), counts: repo.counts(), assets,
  };
  await fs.writeFile(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function restoreBackup(args: { backupDir: string; targetRoot: string }): Promise<RestoreResult> {
  const manifest = JSON.parse(await fs.readFile(path.join(args.backupDir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 'learn-backup' || manifest.formatVersion !== 1) {
    throw new LearnError('VALIDATION_FAILED', '알 수 없는 백업 형식입니다.');
  }
  await assertEmptyDir(args.targetRoot, '복원 대상 폴더가 비어 있지 않습니다. 빈 폴더를 선택하세요.');
  const layout = libraryLayout(args.targetRoot);
  ensureLayout(layout);
  await fs.copyFile(path.join(args.backupDir, 'library.sqlite'), layout.dbFile);

  let verifiedAssets = 0;
  const missingAssets: string[] = [];
  const hashMismatches: string[] = [];
  for (const entry of manifest.assets) {
    if (entry.storageMode !== 'managed' || !entry.relativePath) continue;
    if (!entry.included) {
      missingAssets.push(entry.assetId);
      continue;
    }
    const dst = path.join(layout.root, ...entry.relativePath.split('/'));
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(path.join(args.backupDir, ...entry.relativePath.split('/')), dst);
    if ((await sha256File(dst)) === entry.sha256) verifiedAssets++;
    else hashMismatches.push(entry.assetId);
  }

  const db = openDatabase(layout.dbFile);
  try {
    migrate(db, { dbFile: layout.dbFile });
    const repo = new LibraryRepository(db);
    for (const id of [...missingAssets, ...hashMismatches]) repo.setAvailability(id, 'missing', nowIso());
    const counts = repo.counts();
    const countsMatch =
      counts.items === manifest.counts.items && counts.assets === manifest.counts.assets && counts.revisions === manifest.counts.revisions;
    return { verifiedAssets, missingAssets: missingAssets.sort(), hashMismatches: hashMismatches.sort(), counts, countsMatch };
  } finally {
    db.close();
  }
}
```

`packages/library/src/index.ts`에 추가:
```ts
export * from './backup';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test && pnpm typecheck`
Expected: 전체 PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(library): consistent backup and verified restore into an empty profile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 8: 데스크톱 main — 앱 스킴·보안·IPC·라이브러리 수명주기 + 실행 smoke

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/scripts/copy-pdfjs-assets.mjs`
- Create: `apps/desktop/src/main/{range,url-policy,app-protocol,security,library-context,ipc,index}.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/src/main.tsx` (임시 최소 화면 — Task 9에서 교체)
- Create: `playwright.config.ts`, `tests/tsconfig.json`, `tests/e2e/helpers.ts`, `tests/e2e/smoke.spec.ts`
- Modify: 루트 `package.json` devDependencies에 `"@playwright/test": "1.64.1"`, `"pdf-lib": "1.17.1"` 추가; `typecheck` 스크립트를 `"pnpm -r --workspace-concurrency=1 typecheck && tsc -p tests/tsconfig.json"`로 변경
- Test: `apps/desktop/src/main/range.test.ts`, `apps/desktop/src/main/url-policy.test.ts`

**Interfaces:**
- Consumes: Task 1–7 전부
- Produces:
  - `parseRange(header: string|null, size: number): {start,end} | 'unsatisfiable' | null`
  - `isAllowedAppUrl(url: string, devOrigin: string|null): boolean`
  - `interface LibraryContext {layout, db, repo, importer, schemaVersion, recovery}`, `openLibraryContext(root)`
  - 환경 변수: `LEARN_LIBRARY_DIR`(라이브러리 루트), `LEARN_USER_DATA_DIR`(userData 재정의 — E2E 격리)
  - `window.learn: LearnApi` (preload)
  - E2E helpers: `launch(libraryDir, userDataDir): Promise<{app, page}>`, `stubOpenDialog(app, paths)`, `openItem(page, title)`, `MAIN`, `FIXTURES`
  - renderer 계약: 준비 완료 시 `[data-testid="app-ready"]` 요소 존재

- [ ] **Step 1: 순수 함수 테스트 작성**

`apps/desktop/src/main/range.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseRange } from './range';

describe('parseRange', () => {
  it('returns null without a header or for unsupported forms', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
    expect(parseRange('bytes=-', 100)).toBeNull();
  });
  it('handles closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
  });
  it('flags unsatisfiable ranges', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=9-3', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1', 0)).toBe('unsatisfiable');
  });
});
```

`apps/desktop/src/main/url-policy.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isAllowedAppUrl } from './url-policy';

describe('isAllowedAppUrl', () => {
  it('allows only learn://app pages in production', () => {
    expect(isAllowedAppUrl('learn://app/index.html', null)).toBe(true);
    expect(isAllowedAppUrl('learn://evil/index.html', null)).toBe(false);
    expect(isAllowedAppUrl('file:///etc/passwd', null)).toBe(false);
    expect(isAllowedAppUrl('https://example.com/', null)).toBe(false);
    expect(isAllowedAppUrl('not a url', null)).toBe(false);
  });
  it('additionally allows the exact dev server origin', () => {
    expect(isAllowedAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
  });
});
```

Run: `pnpm test apps/desktop`
Expected: FAIL — 모듈 없음.

- [ ] **Step 2: 순수 함수 구현**

`apps/desktop/src/main/range.ts`:
```ts
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
```

`apps/desktop/src/main/url-policy.ts`:
```ts
/**
 * Node's URL.origin is "null" for non-special schemes such as learn:, so compare protocol + host.
 * The dev server origin is allowed only in unpackaged dev runs (caller passes null otherwise).
 */
export function isAllowedAppUrl(rawUrl: string, devOrigin: string | null): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol === 'learn:' && u.host === 'app') return true;
  return devOrigin !== null && u.origin === devOrigin;
}
```

Run: `pnpm test apps/desktop`
Expected: PASS.

- [ ] **Step 3: 데스크톱 패키지 설정**

`apps/desktop/package.json`:
```json
{
  "name": "@learn/desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Learn — local-first personal learning library",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "node scripts/copy-pdfjs-assets.mjs && electron-vite dev",
    "build": "node scripts/copy-pdfjs-assets.mjs && electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "better-sqlite3": "13.0.3"
  },
  "devDependencies": {
    "@learn/db": "workspace:*",
    "@learn/domain": "workspace:*",
    "@learn/library": "workspace:*",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "electron": "44.9.1",
    "electron-vite": "6.0.0",
    "pdfjs-dist": "6.4.299",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "vite": "8.3.4",
    "zod": "4.6.7"
  }
}
```
> 런타임 `dependencies`는 네이티브 모듈 하나뿐이다. 나머지는 electron-vite가 번들한다(electron-vite는 `dependencies`만 외부화).

`apps/desktop/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node", "vite/client"]
  },
  "include": ["src", "electron.vite.config.ts"]
}
```

`apps/desktop/electron.vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    plugins: [react()],
  },
});
```

`apps/desktop/scripts/copy-pdfjs-assets.mjs`:
```js
// Copies pdf.js runtime data (CJK cmaps, standard fonts, wasm decoders, ICC profiles) into the renderer public dir.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const dest = path.join(here, '../src/renderer/public/pdfjs');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(path.join(pdfjsRoot, dir), path.join(dest, dir), { recursive: true });
}
console.log(`pdf.js assets → ${path.relative(process.cwd(), dest)}`);
```

루트 `package.json`의 devDependencies와 typecheck 스크립트를 위 Files 항목대로 수정한 뒤:

Run: `pnpm install`
Expected: electron postinstall이 캐시에서 즉시 설치(수 초). 다운로드 진행률이 멈춰 있으면 중단하고 보고.

- [ ] **Step 4: main 프로세스 구현**

`apps/desktop/src/main/library-context.ts`:
```ts
import { LibraryRepository, migrate, openDatabase, type Db } from '@learn/db';
import type { RecoveryReport } from '@learn/domain';
import { Importer, ensureLayout, libraryLayout, refreshLinkedAvailability, scanRecovery, type LibraryLayout } from '@learn/library';

export interface LibraryContext {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  importer: Importer;
  schemaVersion: number;
  recovery: RecoveryReport;
}

export async function openLibraryContext(root: string): Promise<LibraryContext> {
  const layout = libraryLayout(root);
  ensureLayout(layout);
  const db = openDatabase(layout.dbFile);
  try {
    const { to } = migrate(db, { dbFile: layout.dbFile });
    const repo = new LibraryRepository(db);
    const recovery = await scanRecovery(layout, repo);
    await refreshLinkedAvailability(layout, repo);
    return { layout, db, repo, importer: new Importer({ layout, repo }), schemaVersion: to, recovery };
  } catch (e) {
    db.close();
    throw e;
  }
}
```

`apps/desktop/src/main/app-protocol.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { nowIso } from '@learn/domain';
import { resolveAssetPath } from '@learn/library';
import type { LibraryContext } from './library-context';
import { parseRange } from './range';

export const APP_SCHEME = 'learn';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ');

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/octet-stream',
};

/** Must run before app 'ready'. corsEnabled is only exercised in dev (renderer on the Vite server). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export function handleAppProtocol(opts: { getContext: () => LibraryContext | null; rendererDir: string; devOrigin: string | null }): void {
  const rendererDir = path.resolve(opts.rendererDir);
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return text(404, 'not found');
    if (url.pathname.startsWith('/asset/')) {
      const cors: Record<string, string> = opts.devOrigin ? { 'Access-Control-Allow-Origin': opts.devOrigin } : {};
      return serveAsset(opts.getContext(), decodeURIComponent(url.pathname.slice('/asset/'.length)), request.headers.get('range'), cors);
    }
    return serveStatic(rendererDir, url.pathname);
  });
}

async function serveAsset(ctx: LibraryContext | null, assetId: string, rangeHeader: string | null, extra: Record<string, string>): Promise<Response> {
  if (!ctx) return text(503, 'library unavailable');
  if (!UUID.test(assetId)) return text(400, 'bad asset id');
  const asset = ctx.repo.getAsset(assetId);
  if (!asset) return text(404, 'unknown asset');
  let file: string;
  try {
    file = resolveAssetPath(ctx.layout, asset);
  } catch {
    return text(403, 'forbidden');
  }
  let size: number;
  try {
    size = (await fs.promises.stat(file)).size;
  } catch {
    ctx.repo.setAvailability(asset.id, 'missing', nowIso());
    return text(404, 'asset file missing');
  }
  const base: Record<string, string> = {
    'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra,
  };
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  if (size === 0) return new Response(null, { status: 200, headers: { ...base, 'Content-Length': '0' } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = { ...base, 'Content-Length': String(end - start + 1) };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

async function serveStatic(rendererDir: string, pathname: string): Promise<Response> {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.resolve(rendererDir, `.${rel}`);
  if (!file.startsWith(rendererDir + path.sep)) return text(403, 'forbidden');
  try {
    const body = await fs.promises.readFile(file);
    const type = STATIC_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
    if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
    return new Response(body, { headers });
  } catch {
    return text(404, 'not found');
  }
}
```

`apps/desktop/src/main/security.ts`:
```ts
import { app, session, shell } from 'electron';
import { isAllowedAppUrl } from './url-policy';

/** Must be called once, after 'ready' and before the first window is created. */
export function hardenApp(devOrigin: string | null): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedAppUrl(url, devOrigin)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}
```

`apps/desktop/src/main/ipc.ts`:
```ts
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import type { z } from 'zod';
import {
  IpcChannels, LearnError, assetIdInput, emptyInput, failureFrom, importPathsInput, itemIdInput, ok, pickAndImportInput,
  type AppInfo, type Result,
} from '@learn/domain';
import { refreshAvailability, relinkAsset } from '@learn/library';
import type { LibraryContext } from './library-context';
import { isAllowedAppUrl } from './url-policy';

export interface IpcDeps {
  getContext(): LibraryContext;
  appInfo(): AppInfo;
  devOrigin: string | null;
}

type Handler<S extends z.ZodType, T> = (input: z.output<S>, event: IpcMainInvokeEvent) => Promise<T> | T;

const IMPORT_FILTERS: OpenDialogOptions['filters'] = [
  { name: 'PDF·동영상', extensions: ['pdf', 'mp4', 'm4v', 'mov', 'webm', 'mkv'] },
  { name: '모든 파일', extensions: ['*'] },
];

async function showOpen(event: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string[]> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return res.canceled ? [] : res.filePaths;
}

export function registerIpc(deps: IpcDeps): void {
  function handle<S extends z.ZodType, T>(channel: string, schema: S, fn: Handler<S, T>): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<T>> => {
      try {
        if (!isAllowedAppUrl(event.senderFrame?.url ?? '', deps.devOrigin)) {
          throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
        }
        const parsed = schema.safeParse(raw ?? undefined);
        if (!parsed.success) throw new LearnError('VALIDATION_FAILED', '잘못된 요청입니다.');
        return ok(await fn(parsed.data, event));
      } catch (e) {
        const failure = failureFrom(e);
        console.error(`[ipc] ${channel} failed: ${failure.code}`);
        return failure;
      }
    });
  }

  handle(IpcChannels.appInfo, emptyInput, () => deps.appInfo());

  handle(IpcChannels.pickAndImport, pickAndImportInput, async (input, event) => {
    const ctx = deps.getContext();
    const paths = await showOpen(event, { title: '자료 가져오기', properties: ['openFile', 'multiSelections'], filters: IMPORT_FILTERS });
    return paths.length === 0 ? [] : ctx.importer.importMany(paths, input);
  });

  handle(IpcChannels.importPaths, importPathsInput, (input) => deps.getContext().importer.importMany(input.paths, input));

  handle(IpcChannels.listItems, emptyInput, () => deps.getContext().repo.listItems());

  handle(IpcChannels.getItem, itemIdInput, async ({ itemId }) => {
    const ctx = deps.getContext();
    const item = ctx.repo.getItem(itemId);
    const asset = item && ctx.repo.getAsset(item.assetId);
    if (!item || !asset) throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다.');
    await refreshAvailability(ctx.layout, ctx.repo, asset);
    return ctx.repo.getItem(itemId)!;
  });

  handle(IpcChannels.pickAndRelink, assetIdInput, async ({ assetId }, event) => {
    const ctx = deps.getContext();
    const [picked] = await showOpen(event, { title: '원본 파일 다시 연결', properties: ['openFile'], filters: IMPORT_FILTERS });
    if (!picked) return null;
    await relinkAsset(ctx.repo, assetId, picked);
    const itemId = ctx.repo.itemIdsForAsset(assetId)[0];
    return itemId ? ctx.repo.getItem(itemId) ?? null : null;
  });

  handle(IpcChannels.recoveryReport, emptyInput, () => deps.getContext().recovery);
}
```

`apps/desktop/src/main/index.ts`:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { LearnError, toLearnError, type AppInfo, type ErrorCode } from '@learn/domain';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { registerIpc } from './ipc';
import { openLibraryContext, type LibraryContext } from './library-context';
import { hardenApp } from './security';

const here = path.dirname(fileURLToPath(import.meta.url));

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
const libraryRoot = (): string => process.env['LEARN_LIBRARY_DIR'] ?? path.join(app.getPath('userData'), 'Library');

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Learn',
    backgroundColor: '#eef2f6',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(devServerUrl ?? `${APP_SCHEME}://app/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    hardenApp(devOrigin);
    try {
      ctx = await openLibraryContext(libraryRoot());
    } catch (e) {
      const le = toLearnError(e, '라이브러리를 여는 중 오류가 발생했습니다.');
      libraryError = { code: le.code, message: le.message };
      console.error(`[library] open failed: ${le.code}`);
    }
    handleAppProtocol({ getContext: () => ctx, rendererDir: path.join(here, '../renderer'), devOrigin });
    registerIpc({
      getContext: () => {
        if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', libraryError?.message ?? '라이브러리를 열 수 없습니다.');
        return ctx;
      },
      appInfo: (): AppInfo => ({
        version: app.getVersion(),
        libraryRoot: libraryRoot(),
        schemaVersion: ctx?.schemaVersion ?? 0,
        platform: process.platform,
        libraryError,
      }),
      devOrigin,
    });
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('activate', () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (ctx?.db.open) ctx.db.close();
  });
}
```

- [ ] **Step 5: preload와 임시 renderer**

`apps/desktop/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { LearnApi } from '@learn/domain';
import { IpcChannels } from '@learn/domain/ipc-channels';

const invoke = (channel: string, input?: unknown) => ipcRenderer.invoke(channel, input);

const api: LearnApi = {
  appInfo: () => invoke(IpcChannels.appInfo),
  pickAndImport: (input) => invoke(IpcChannels.pickAndImport, input),
  importPaths: (input) => invoke(IpcChannels.importPaths, input),
  listItems: () => invoke(IpcChannels.listItems),
  getItem: (input) => invoke(IpcChannels.getItem, input),
  pickAndRelink: (input) => invoke(IpcChannels.pickAndRelink, input),
  recoveryReport: () => invoke(IpcChannels.recoveryReport),
  pathForFile: (file) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learn', api);
```

`apps/desktop/src/renderer/index.html`:
```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Learn</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/src/main.tsx` (임시 — Task 9에서 전체 교체):
```tsx
import { createRoot } from 'react-dom/client';
import type { AppInfo, LearnApi } from '@learn/domain';

declare global {
  interface Window {
    learn: LearnApi;
  }
}

function Boot({ info }: { info: AppInfo }) {
  return (
    <main>
      <h1>Learn</h1>
      <p>스키마 v{info.schemaVersion}</p>
      <div data-testid="app-ready" hidden />
    </main>
  );
}

void window.learn.appInfo().then((r) => {
  if (!r.ok) throw new Error(r.message);
  createRoot(document.getElementById('root')!).render(<Boot info={r.data} />);
});
```

- [ ] **Step 6: E2E 골격과 smoke 테스트**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
});
```

`tests/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM"] },
  "include": ["e2e", "../playwright.config.ts"]
}
```

`tests/e2e/helpers.ts`:
```ts
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { LearnApi } from '../../packages/domain/src/ipc';

declare global {
  interface Window {
    learn: LearnApi;
  }
}

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const MAIN = path.join(ROOT, 'apps/desktop/out/main/index.js');
export const FIXTURES = path.join(ROOT, 'fixtures/generated');

export interface Session {
  app: ElectronApplication;
  page: Page;
}

export async function launch(libraryDir: string, userDataDir: string): Promise<Session> {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, LEARN_LIBRARY_DIR: libraryDir, LEARN_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('app-ready')).toBeAttached();
  return { app, page };
}

/** Replace the native file dialog in the main process for the next calls. */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog;
  }, filePaths);
}

export async function openItem(page: Page, title: string): Promise<void> {
  await page.locator(`[data-testid="open-item"][data-title="${title}"]`).click();
}
```

`tests/e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('app boots with a sandboxed renderer on learn://app and migrates the library', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  expect(page.url()).toBe('learn://app/index.html');
  const isolated = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require === 'undefined' && typeof window.learn === 'object');
  expect(isolated).toBe(true);
  const info = await page.evaluate(() => window.learn.appInfo());
  expect(info).toMatchObject({ ok: true, data: { schemaVersion: 1, libraryError: null } });
  await page.screenshot({ path: testInfo.outputPath('smoke.png') });
  await app.close();
});
```
> `window.learn` 타입은 `helpers.ts`의 전역 선언에서 온다.

- [ ] **Step 7: 빌드·검증**

Run: `pnpm typecheck && pnpm test && pnpm e2e:xvfb`
Expected: typecheck 0 오류, vitest 전부 PASS, Playwright `smoke` 1 passed. 실패 시 `test-results/` 의 trace를 확인한다.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(desktop): Electron shell with learn://app scheme, hardened IPC, library lifecycle

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 9: Renderer — 3단 레이아웃, 라이브러리 테이블, 가져오기·중복·missing·재연결

**Files:**
- Replace: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/src/renderer/src/{App.tsx,api.ts,strings.ts,format.ts,styles.css}`
- Create: `apps/desktop/src/renderer/src/components/{TopBar,Sidebar,LibraryView,DuplicateDialog,TutorPanel,FatalScreen}.tsx`
- Create: `apps/desktop/src/renderer/src/viewers/ViewerHost.tsx` (PDF/영상 뷰어 자리는 Task 10에서 채움 — 이 작업에서는 "준비 중" 대신 `item.type`과 제목만 표시)
- Test: `tests/e2e/library.spec.ts`

**Interfaces:**
- Consumes: `window.learn: LearnApi` (Task 8), domain 타입
- Produces (E2E 계약, data-testid):
  - `app-ready`, `empty-state`, `import-managed`, `import-linked`, `drop-zone`, `item-row`, `open-item`(+`data-title`), `availability-badge`, `import-failures`
  - `duplicate-dialog`, `dup-open`, `dup-add`, `dup-cancel`
  - `viewer-back`, `viewer-title`, `missing-notice`, `relink`
  - `tutor-panel`, `tutor-close`, `tutor-open`
  - `ViewerHost` props: `{ itemId: string; onBack(): void; onChanged(): void }`
  - `api(): LearnApi`, `unwrap<T>(p: Promise<Result<T>>): Promise<T>`, `class ApiError {code, retryable}`
  - `t` (문구 객체)

- [ ] **Step 1: 실패하는 E2E 작성** — `tests/e2e/library.spec.ts`

먼저 가짜 PDF 두 개를 테스트 안에서 만든다(Task 11 fixture 없이도 독립 실행).
```ts
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, openItem, stubOpenDialog } from './helpers';

function fakePdf(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${body}\n%%EOF\n`);
  return p;
}

test('import, duplicate prompt, missing linked file and relink', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const src = testInfo.outputPath('src');
  const a = fakePdf(src, 'Chapter 06.pdf', 'six');
  const b = fakePdf(src, '신호 전달 (2).pdf', 'two');

  let { app, page } = await launch(lib, ud);
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('tutor-panel')).toContainText('P3');

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('item-row')).toHaveCount(1);

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('duplicate-dialog')).toBeVisible();
  await page.getByTestId('dup-cancel').click();
  await expect(page.getByTestId('duplicate-dialog')).toBeHidden();
  await expect(page.getByTestId('item-row')).toHaveCount(1);

  await stubOpenDialog(app, [b]);
  await page.getByTestId('import-linked').click();
  await expect(page.getByTestId('item-row')).toHaveCount(2);
  await app.close();

  const moved = path.join(src, 'moved.pdf');
  fs.renameSync(b, moved);
  ({ app, page } = await launch(lib, ud));
  const row = page.getByTestId('item-row').filter({ hasText: '신호 전달 (2)' });
  await expect(row.getByTestId('availability-badge')).toHaveText('파일 없음');
  await openItem(page, '신호 전달 (2)');
  await expect(page.getByTestId('missing-notice')).toBeVisible();
  await stubOpenDialog(app, [moved]);
  await page.getByTestId('relink').click();
  await expect(page.getByTestId('missing-notice')).toBeHidden();
  await page.getByTestId('viewer-back').click();
  await expect(row.getByTestId('availability-badge')).toHaveText('사용 가능');
  await page.screenshot({ path: testInfo.outputPath('library.png') });
  await app.close();
});
```

Run: `pnpm e2e:xvfb`
Expected: `library.spec.ts` FAIL (`empty-state` 없음). `smoke.spec.ts`는 PASS 유지.

- [ ] **Step 2: 공용 모듈**

`apps/desktop/src/renderer/src/api.ts`:
```ts
import type { ErrorCode, LearnApi, Result } from '@learn/domain';

declare global {
  interface Window {
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
```

`apps/desktop/src/renderer/src/strings.ts`:
```ts
export const t = {
  brand: 'LEARN',
  brandSub: '개인 학습 라이브러리',
  statusSaved: '로컬 저장됨',
  statusBusy: '가져오는 중…',
  statusError: '오류 — 아래 안내를 확인하세요',
  library: '라이브러리',
  allMaterials: '전체 자료',
  collections: '컬렉션',
  collectionsPending: '컬렉션과 태그는 P1 단계에서 구현됩니다.',
  importManaged: '자료 가져오기 (복사)',
  importLinked: '외부 파일 연결',
  dropHint: '파일을 여기로 끌어다 놓으면 라이브러리로 복사해 가져옵니다.',
  empty: '아직 자료가 없습니다. PDF나 동영상을 가져오세요.',
  colTitle: '제목',
  colType: '종류',
  colStorage: '보관',
  colSize: '크기',
  colStatus: '상태',
  colAdded: '추가일',
  type: { pdf: 'PDF', video: '동영상' },
  storage: { managed: '복사본', linked: '외부 연결' },
  availability: { available: '사용 가능', missing: '파일 없음' },
  importFailures: '가져오지 못한 파일',
  duplicateTitle: '이미 있는 자료입니다',
  duplicateBody: (name: string) => `“${name}”과(와) 내용이 같은 자료가 라이브러리에 있습니다. 원본은 삭제되지 않습니다.`,
  openExisting: '기존 자료 열기',
  addAnyway: '새 자료로 추가',
  cancel: '취소',
  back: '← 라이브러리',
  missingNotice: '원본 파일을 찾을 수 없습니다.',
  missingLinkedHint: '외부 연결 자료입니다. 파일을 옮겼다면 “다시 연결”로 새 위치를 지정하세요.',
  missingManagedHint: '라이브러리 안의 복사본이 사라졌습니다. 백업에서 복원하거나 원본을 다시 가져오세요.',
  relink: '다시 연결',
  tutorTitle: '개인 튜터',
  tutorPending: '튜터는 P3 단계에서 구현됩니다. 지금은 자료를 가져오고 여는 기능을 먼저 검증하고 있습니다.',
  tutorScope: '범위: 선택한 자료 + 내 학습 기록 (P3–P4)',
  closePanel: '패널 닫기',
  openTutor: '튜터 패널 열기',
  fatalTitle: '라이브러리를 열 수 없습니다',
  fatalHint: '데이터는 삭제되지 않았습니다. 같은 폴더에 업데이트 전 백업(library.sqlite.pre-v*.bak)이 있으면 그 파일로 복구할 수 있습니다.',
  libraryPath: '라이브러리 위치',
  viewerPending: '이 자료의 뷰어를 준비하고 있습니다.',
} as const;
```

`apps/desktop/src/renderer/src/format.ts`:
```ts
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
```

- [ ] **Step 3: 컴포넌트**

`apps/desktop/src/renderer/src/components/TopBar.tsx`:
```tsx
import { t } from '../strings';

export type SaveStatus = 'idle' | 'busy' | 'error';

export function TopBar({ status }: { status: SaveStatus }) {
  const label = status === 'busy' ? t.statusBusy : status === 'error' ? t.statusError : t.statusSaved;
  return (
    <header className="topbar">
      <div className="brand">
        <strong>{t.brand}</strong> / {t.brandSub}
      </div>
      <div className={`save-status save-${status}`} role="status" aria-live="polite">
        LOCAL FIRST · {label}
      </div>
    </header>
  );
}
```

`apps/desktop/src/renderer/src/components/Sidebar.tsx`:
```tsx
import { t } from '../strings';

export function Sidebar({ count, active, onShowLibrary }: { count: number; active: boolean; onShowLibrary(): void }) {
  return (
    <nav className="sidebar" aria-label={t.library}>
      <h2>{t.library}</h2>
      <button className={`nav-item${active ? ' active' : ''}`} onClick={onShowLibrary}>
        {t.allMaterials} <span className="count">{count}</span>
      </button>
      <h2>{t.collections}</h2>
      <p className="muted small">{t.collectionsPending}</p>
    </nav>
  );
}
```

`apps/desktop/src/renderer/src/components/LibraryView.tsx`:
```tsx
import { useState, type DragEvent } from 'react';
import type { LibraryItem, StorageMode } from '@learn/domain';
import { api } from '../api';
import { formatDate, formatSize } from '../format';
import { t } from '../strings';

export interface LibraryViewProps {
  items: LibraryItem[];
  failures: Array<{ path: string; message: string }>;
  busy: boolean;
  onPick(mode: StorageMode): void;
  onImportPaths(paths: string[], mode: StorageMode): void;
  onOpen(itemId: string): void;
}

export function LibraryView({ items, failures, busy, onPick, onImportPaths, onOpen }: LibraryViewProps) {
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = Array.from(e.dataTransfer.files).map((f) => api().pathForFile(f)).filter((p) => p.length > 0);
    if (paths.length > 0) onImportPaths(paths, 'managed');
  };
  return (
    <section className="library">
      <div className="toolbar">
        <button data-testid="import-managed" disabled={busy} onClick={() => onPick('managed')}>{t.importManaged}</button>
        <button data-testid="import-linked" className="secondary" disabled={busy} onClick={() => onPick('linked')}>{t.importLinked}</button>
      </div>
      <div
        data-testid="drop-zone"
        className={`drop-zone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {t.dropHint}
      </div>
      {failures.length > 0 && (
        <div className="failures" role="alert" data-testid="import-failures">
          <strong>{t.importFailures}</strong>
          <ul>{failures.map((f, i) => <li key={i}>{f.path ? `${f.path.split(/[\\/]/).pop()}: ` : ''}{f.message}</li>)}</ul>
        </div>
      )}
      {items.length === 0 ? (
        <p className="empty" data-testid="empty-state">{t.empty}</p>
      ) : (
        <table className="items" data-testid="library-table">
          <thead>
            <tr><th>{t.colTitle}</th><th>{t.colType}</th><th>{t.colStorage}</th><th>{t.colSize}</th><th>{t.colStatus}</th><th>{t.colAdded}</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} data-testid="item-row">
                <td>
                  <button className="link" data-testid="open-item" data-title={item.title} onClick={() => onOpen(item.id)}>{item.title}</button>
                </td>
                <td>{t.type[item.type]}</td>
                <td>{t.storage[item.storageMode]}</td>
                <td>{formatSize(item.size)}</td>
                <td><span data-testid="availability-badge" className={`badge ${item.availability}`}>{t.availability[item.availability]}</span></td>
                <td>{formatDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

`apps/desktop/src/renderer/src/components/DuplicateDialog.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { t } from '../strings';

export function DuplicateDialog(props: { path: string; onOpenExisting(): void; onAddAnyway(): void; onCancel(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const name = props.path.split(/[\\/]/).pop() ?? props.path;
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dup-title" data-testid="duplicate-dialog">
        <h2 id="dup-title">{t.duplicateTitle}</h2>
        <p>{t.duplicateBody(name)}</p>
        <div className="modal-actions">
          <button data-testid="dup-open" onClick={props.onOpenExisting}>{t.openExisting}</button>
          <button data-testid="dup-add" className="secondary" onClick={props.onAddAnyway}>{t.addAnyway}</button>
          <button data-testid="dup-cancel" className="secondary" ref={cancelRef} onClick={props.onCancel}>{t.cancel}</button>
        </div>
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/src/components/TutorPanel.tsx`:
```tsx
import { t } from '../strings';

/** Placeholder only: no fake chat, no hard-coded memory. Implemented in P3. */
export function TutorPanel({ onClose }: { onClose(): void }) {
  return (
    <aside className="tutor" data-testid="tutor-panel" aria-label={t.tutorTitle}>
      <div className="tutor-head">
        <h2>{t.tutorTitle}</h2>
        <button className="icon" data-testid="tutor-close" aria-label={t.closePanel} onClick={onClose}>×</button>
      </div>
      <p className="muted small">{t.tutorScope}</p>
      <p className="pending">{t.tutorPending}</p>
    </aside>
  );
}
```

`apps/desktop/src/renderer/src/components/FatalScreen.tsx`:
```tsx
import type { AppInfo } from '@learn/domain';
import { t } from '../strings';

export function FatalScreen({ info }: { info: AppInfo }) {
  return (
    <main className="fatal" role="alert">
      <h1>{t.fatalTitle}</h1>
      <p>{info.libraryError?.message}</p>
      <p className="muted small">({info.libraryError?.code})</p>
      <p>{t.fatalHint}</p>
      <p className="muted small">{t.libraryPath}: {info.libraryRoot}</p>
      <div data-testid="app-ready" hidden />
    </main>
  );
}
```

`apps/desktop/src/renderer/src/viewers/ViewerHost.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { LibraryItem } from '@learn/domain';
import { api, unwrap } from '../api';
import { t } from '../strings';

export function ViewerHost({ itemId, onBack, onChanged }: { itemId: string; onBack(): void; onChanged(): void }) {
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    unwrap(api().getItem({ itemId })).then(
      (i) => { if (!cancelled) setItem(i); },
      (e: Error) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [itemId]);

  const relink = async () => {
    if (!item) return;
    setError(null);
    try {
      const updated = await unwrap(api().pickAndRelink({ assetId: item.assetId }));
      if (updated) {
        setItem(updated);
        onChanged();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="viewer">
      <div className="viewer-head">
        <button className="secondary" data-testid="viewer-back" onClick={onBack}>{t.back}</button>
        <span className="viewer-title" data-testid="viewer-title">{item?.title}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {item?.availability === 'missing' ? (
        <div className="missing" data-testid="missing-notice" role="alert">
          <p>{t.missingNotice}</p>
          <p className="muted small">{item.storageMode === 'linked' ? t.missingLinkedHint : t.missingManagedHint}</p>
          {item.storageMode === 'linked' && <button data-testid="relink" onClick={relink}>{t.relink}</button>}
        </div>
      ) : item ? (
        <ViewerBody item={item} />
      ) : null}
    </section>
  );
}

function ViewerBody({ item }: { item: LibraryItem }) {
  return <p className="muted" data-testid="viewer-pending">{t.viewerPending} ({t.type[item.type]})</p>;
}
```

- [ ] **Step 4: App과 진입점**

`apps/desktop/src/renderer/src/App.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, ImportOutcome, LibraryItem, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from './api';
import { DuplicateDialog } from './components/DuplicateDialog';
import { FatalScreen } from './components/FatalScreen';
import { LibraryView } from './components/LibraryView';
import { Sidebar } from './components/Sidebar';
import { TopBar, type SaveStatus } from './components/TopBar';
import { TutorPanel } from './components/TutorPanel';
import { t } from './strings';
import { ViewerHost } from './viewers/ViewerHost';

interface PendingDuplicate {
  path: string;
  existingItemId: string;
  mode: StorageMode;
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<PendingDuplicate[]>([]);
  const [failures, setFailures] = useState<Array<{ path: string; message: string }>>([]);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [tutorOpen, setTutorOpen] = useState(true);

  const refresh = useCallback(async () => setItems(await unwrap(api().listItems())), []);

  useEffect(() => {
    void (async () => {
      const i = await unwrap(api().appInfo());
      setInfo(i);
      if (!i.libraryError) await refresh();
      setReady(true);
    })();
  }, [refresh]);

  const runImport = useCallback(
    async (request: () => Promise<Result<ImportOutcome[]>>, mode: StorageMode) => {
      setStatus('busy');
      try {
        const outcomes = await unwrap(request());
        setDuplicates((q) => [
          ...q,
          ...outcomes.flatMap((o) => (o.status === 'duplicate' ? [{ path: o.path, existingItemId: o.existingItemId, mode }] : [])),
        ]);
        setFailures(outcomes.flatMap((o) => (o.status === 'failed' ? [{ path: o.path, message: o.message }] : [])));
        await refresh();
        setStatus('idle');
      } catch (e) {
        setFailures([{ path: '', message: (e as Error).message }]);
        setStatus('error');
      }
    },
    [refresh],
  );

  if (!info) return null;
  if (info.libraryError) return <FatalScreen info={info} />;

  const current = duplicates[0];
  const resolveDuplicate = (action: 'open' | 'add' | 'cancel') => {
    if (!current) return;
    setDuplicates((q) => q.slice(1));
    if (action === 'open') setOpenId(current.existingItemId);
    if (action === 'add') void runImport(() => api().importPaths({ paths: [current.path], mode: current.mode, allowDuplicate: true }), current.mode);
  };

  return (
    <div className={`shell${tutorOpen ? '' : ' no-tutor'}`}>
      <TopBar status={status} />
      <Sidebar count={items.length} active={openId === null} onShowLibrary={() => setOpenId(null)} />
      <main className="center">
        {openId ? (
          <ViewerHost key={openId} itemId={openId} onBack={() => setOpenId(null)} onChanged={() => void refresh()} />
        ) : (
          <LibraryView
            items={items}
            failures={failures}
            busy={status === 'busy'}
            onPick={(mode) => void runImport(() => api().pickAndImport({ mode }), mode)}
            onImportPaths={(paths, mode) => void runImport(() => api().importPaths({ paths, mode }), mode)}
            onOpen={setOpenId}
          />
        )}
      </main>
      {tutorOpen ? (
        <TutorPanel onClose={() => setTutorOpen(false)} />
      ) : (
        <button className="tutor-toggle" data-testid="tutor-open" onClick={() => setTutorOpen(true)}>{t.openTutor}</button>
      )}
      {current && (
        <DuplicateDialog
          path={current.path}
          onOpenExisting={() => resolveDuplicate('open')}
          onAddAnyway={() => resolveDuplicate('add')}
          onCancel={() => resolveDuplicate('cancel')}
        />
      )}
      {ready && <div data-testid="app-ready" hidden />}
    </div>
  );
}
```

`apps/desktop/src/renderer/src/main.tsx` (전체 교체):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Dropping a file outside the drop zone must never navigate the window.
for (const type of ['dragover', 'drop'] as const) document.addEventListener(type, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/desktop/src/renderer/src/styles.css`:
```css
:root {
  --bg: #eef2f6;
  --top: #182840;
  --top-text: #dfe7f1;
  --side: #e3e9f1;
  --panel: #ffffff;
  --text: #263449;
  --muted: #738198;
  --accent: #2f7f7a;
  --accent-soft: #dff0ec;
  --highlight: #fdeebd;
  --danger: #b4423a;
  --danger-soft: #fbe7e5;
  --border: #d5dde8;
  --focus: #2f6fd6;
  font-family: system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
  color: var(--text);
  background: var(--bg);
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); }
button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; padding: 7px 14px; }
button.secondary { background: var(--panel); color: var(--text); border-color: var(--border); }
button.link { background: none; border: none; color: var(--text); padding: 0; text-align: left; font-weight: 600; }
button.link:hover { text-decoration: underline; }
button.icon { background: none; border: none; color: var(--muted); font-size: 20px; padding: 0 6px; }
button:disabled { opacity: 0.5; cursor: default; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }

.shell { display: grid; height: 100%; grid-template-columns: 220px minmax(0, 1fr) 340px; grid-template-rows: 56px minmax(0, 1fr); grid-template-areas: 'top top top' 'side center tutor'; }
.shell.no-tutor { grid-template-columns: 220px minmax(0, 1fr) 0; }
.topbar { grid-area: top; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; background: var(--top); color: #fff; }
.brand { font-size: 18px; }
.save-status { font-size: 13px; color: var(--top-text); }
.save-status.save-error { color: #ffb4ac; }
.sidebar { grid-area: side; background: var(--side); padding: 20px 12px; overflow: auto; }
.sidebar h2 { font-size: 13px; letter-spacing: 0.06em; margin: 18px 10px 8px; }
.nav-item { width: 100%; display: flex; justify-content: space-between; background: none; border: none; color: var(--text); padding: 8px 10px; }
.nav-item.active { background: #c9dde6; }
.sidebar p { margin: 4px 10px; }
.center { grid-area: center; overflow: auto; padding: 16px; }
.tutor { grid-area: tutor; background: var(--panel); margin: 16px 16px 16px 0; border-radius: 12px; padding: 16px; overflow: auto; }
.tutor-head { display: flex; justify-content: space-between; align-items: center; }
.tutor-head h2 { font-size: 15px; margin: 0; }
.tutor .pending { background: var(--bg); border-radius: 8px; padding: 12px; line-height: 1.5; }
.tutor-toggle { position: fixed; right: 16px; bottom: 16px; }

.library, .viewer { background: var(--panel); border-radius: 12px; padding: 16px; min-height: 100%; }
.toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
.drop-zone { border: 2px dashed var(--border); border-radius: 10px; padding: 14px; color: var(--muted); text-align: center; margin-bottom: 12px; }
.drop-zone.dragging { border-color: var(--accent); background: var(--accent-soft); }
.failures { background: var(--danger-soft); color: var(--danger); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.failures ul { margin: 6px 0 0; padding-left: 18px; }
.empty { color: var(--muted); padding: 40px 0; text-align: center; }
table.items { width: 100%; border-collapse: collapse; font-size: 14px; }
table.items th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--border); padding: 8px; }
table.items td { border-bottom: 1px solid var(--bg); padding: 8px; }
.badge { border-radius: 999px; padding: 2px 10px; font-size: 12px; }
.badge.available { background: var(--accent-soft); color: var(--accent); }
.badge.missing { background: var(--danger-soft); color: var(--danger); }

.viewer-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.viewer-title { font-weight: 600; }
.missing { background: var(--danger-soft); border-radius: 8px; padding: 14px; }
.error { color: var(--danger); }

.modal-backdrop { position: fixed; inset: 0; background: rgb(24 40 64 / 0.35); display: grid; place-items: center; }
.modal { background: var(--panel); border-radius: 12px; padding: 20px 24px; width: min(480px, 90vw); }
.modal h2 { margin-top: 0; font-size: 17px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

.fatal { max-width: 640px; margin: 80px auto; background: var(--panel); border-radius: 12px; padding: 24px 28px; }
```

- [ ] **Step 5: 검증**

Run: `pnpm typecheck && pnpm test && pnpm e2e:xvfb`
Expected: `smoke`, `library` 모두 PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(desktop): Korean 3-pane UI with library table, import, duplicate and relink flows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 10: PDF·동영상 뷰어 + fixture 생성기 + 첫 세션 E2E

**Files:**
- Create: `apps/desktop/src/renderer/src/viewers/PdfViewer.tsx`, `apps/desktop/src/renderer/src/viewers/VideoViewer.tsx`
- Modify: `apps/desktop/src/renderer/src/viewers/ViewerHost.tsx` (`ViewerBody`가 실제 뷰어를 렌더)
- Modify: `apps/desktop/src/renderer/src/strings.ts` (뷰어 문구 추가)
- Modify: `apps/desktop/src/renderer/src/styles.css` (뷰어 스타일 추가)
- Create: `fixtures/generate.mjs`, `fixtures/README.md`
- Modify: 루트 `package.json` scripts — `"e2e": "pnpm build && pnpm fixtures && playwright test"`, `"e2e:xvfb": "pnpm build && pnpm fixtures && xvfb-run -a -s \"-screen 0 1440x900x24\" playwright test"`
- Test: `tests/e2e/first-session.spec.ts`

**Interfaces:**
- Consumes: `assetUrl` (Task 1), `ViewerHost` (Task 9), E2E helpers (Task 8)
- Produces (data-testid): `pdf-canvas`(+`data-rendered` = 완료된 렌더 수), `pdf-page-indicator`(`"N / M쪽"`), `pdf-prev`, `pdf-next`, `pdf-zoom`, `pdf-error`, `video`, `video-error`
- Fixtures: `fixtures/generated/{sample.pdf, 한글 경로 (테스트) #1.pdf, sample-h264-aac.mp4, sample-mpeg4part2.mp4, sample-hevc.mp4?}`

- [ ] **Step 1: fixture 생성기**

`fixtures/generate.mjs`:
```js
// Generates self-made, license-free test media. Uses argument arrays only (no shell strings).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generated');
fs.mkdirSync(out, { recursive: true });
const force = process.argv.includes('--force');
const need = (name) => force || !fs.existsSync(path.join(out, name));

async function makePdf(file, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Learn fixture: ${label}`);
  for (let i = 1; i <= 3; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} - page ${i}`, { x: 56, y: 770, size: 22, font });
    page.drawText('A signaling cascade can amplify an initial molecular event.', { x: 56, y: 730, size: 12, font });
    page.drawRectangle({ x: 56, y: 560, width: 220, height: 120, borderColor: rgb(0.18, 0.5, 0.48), borderWidth: 3 });
    if (i === 2) page.setRotation(degrees(90));
  }
  fs.writeFileSync(file, await doc.save());
}

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const has = (name) => new RegExp(`\\s${name}\\s`).test(encoders);

if (need('sample.pdf')) await makePdf(path.join(out, 'sample.pdf'), 'Sample PDF');
if (need('한글 경로 (테스트) #1.pdf')) await makePdf(path.join(out, '한글 경로 (테스트) #1.pdf'), 'Korean path PDF');

if (need('sample-h264-aac.mp4')) {
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '10',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    path.join(out, 'sample-h264-aac.mp4'),
  ]);
}
if (need('sample-mpeg4part2.mp4')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'mpeg4', path.join(out, 'sample-mpeg4part2.mp4')]);
}
if (!need('sample-hevc.mp4')) {
  // already present
} else if (has('libx265')) {
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '3', '-c:v', 'libx265', '-tag:v', 'hvc1', path.join(out, 'sample-hevc.mp4')]);
} else {
  console.warn('libx265 encoder not available — skipping sample-hevc.mp4');
}
console.log(`fixtures written to ${out}`);
```

`fixtures/README.md`:
```markdown
# Fixtures

`pnpm fixtures` 가 `fixtures/generated/` 에 테스트 자료를 만든다(이미 있으면 건너뜀, `node fixtures/generate.mjs --force`로 재생성). 생성물은 커밋하지 않는다. `pnpm e2e`는 자동으로 먼저 실행한다.
모든 파일은 이 저장소의 스크립트가 직접 합성한 것이라 제3자 저작물이 없다.

| 파일 | 출처 | 용도 |
|---|---|---|
| `sample.pdf` | pdf-lib, Helvetica, 3쪽(2쪽 90° 회전) | PDF 렌더·쪽 이동 |
| `한글 경로 (테스트) #1.pdf` | 위와 같은 생성기, 다른 라벨 | 경로의 한글·공백·특수문자 |
| `sample-h264-aac.mp4` | ffmpeg `testsrc2` + `sine`, 1280×720 30fps 10초, H.264 High/AAC, GOP 60, faststart | 재생·seek 정확도(AC05) |
| `sample-mpeg4part2.mp4` | ffmpeg `testsrc2`, MPEG-4 Part 2 | Chromium 미지원 코덱 안내 |
| `sample-hevc.mp4` | ffmpeg `libx265`(있을 때만) | 플랫폼 의존 코덱 기록용(판정 기준 아님) |
```

루트 `package.json` devDependencies에 `pdf-lib`가 있는지 확인(Task 8에서 추가)하고, 위 Files 항목대로 `e2e`/`e2e:xvfb` 스크립트에 `pnpm fixtures`를 넣는다.

Run: `pnpm fixtures && ls -la fixtures/generated`
Expected: 4–5개 파일 생성.

- [ ] **Step 2: 실패하는 E2E** — `tests/e2e/first-session.spec.ts`

```ts
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, launch, openItem, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const BAD = path.join(FIXTURES, 'sample-mpeg4part2.mp4');

test.beforeAll(() => {
  for (const f of [PDF, KO_PDF, MP4, BAD]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

async function inkedPixels(page: Page): Promise<number> {
  return page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 240 || d[i + 1]! < 240 || d[i + 2]! < 240) n++;
    return n;
  });
}

test('import → open PDF and video → unsupported codec notice → survive SIGKILL', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);

  await stubOpenDialog(app, [PDF, KO_PDF, MP4, BAD]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('item-row')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('01-library.png') });

  // PDF
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  expect(await inkedPixels(page)).toBeGreaterThan(500);
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
  await page.getByTestId('pdf-next').click();
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('2 / 3쪽');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[2-9]\d*$/);
  const rotated = await page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.width > c.height);
  expect(rotated).toBe(true); // page 2 is rotated 90°
  await page.screenshot({ path: testInfo.outputPath('02-pdf.png') });
  await page.getByTestId('viewer-back').click();

  // Korean path PDF
  await openItem(page, '한글 경로 (테스트) #1');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await page.getByTestId('viewer-back').click();

  // Video: play + seek accuracy (AC05 target ≤ 500 ms)
  await openItem(page, 'sample-h264-aac');
  const video = page.getByTestId('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const seek = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    const target = 7.3;
    const t0 = performance.now();
    v.currentTime = target;
    await new Promise((resolve) => v.addEventListener('seeked', resolve, { once: true }));
    v.pause();
    return { errorMs: Math.abs(v.currentTime - target) * 1000, seekMs: performance.now() - t0, width: v.videoWidth, height: v.videoHeight };
  });
  testInfo.annotations.push({ type: 'seek', description: JSON.stringify(seek) });
  console.log('[measure] video seek', JSON.stringify(seek));
  expect(seek.width).toBe(1280);
  expect(seek.errorMs).toBeLessThanOrEqual(500);
  await page.screenshot({ path: testInfo.outputPath('03-video.png') });
  await page.getByTestId('viewer-back').click();

  // Unsupported codec → explained, not silent
  await openItem(page, 'sample-mpeg4part2');
  await expect(page.getByTestId('video-error')).toContainText('코덱');
  await page.screenshot({ path: testInfo.outputPath('04-unsupported.png') });
  await page.getByTestId('viewer-back').click();

  // Crash and restart (AC06 partial: saved state survives a hard kill)
  app.process().kill('SIGKILL');
  ({ app, page } = await launch(lib, ud));
  await expect(page.getByTestId('item-row')).toHaveCount(4);
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await app.close();
});

test('PDF zoom levels keep rendering', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  await stubOpenDialog(app, [PDF]);
  await page.getByTestId('import-managed').click();
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  const width100 = await page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth);
  await page.getByTestId('pdf-zoom').selectOption('2');
  await expect.poll(() => page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth)).toBeGreaterThan(width100 * 1.9);
  await page.getByTestId('pdf-zoom').selectOption('0.5');
  await expect.poll(() => page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth)).toBeLessThan(width100 * 0.6);
  await app.close();
});
```

Run: `pnpm e2e:xvfb`
Expected: `first-session.spec.ts` FAIL (`pdf-canvas` 없음).

- [ ] **Step 3: 뷰어 구현**

`apps/desktop/src/renderer/src/strings.ts`의 `t` 객체에 다음 키를 추가(`as const` 유지):
```ts
  pdfPage: (n: number, total: number) => `${n} / ${total}쪽`,
  pdfPrev: '이전 쪽',
  pdfNext: '다음 쪽',
  pdfZoom: '배율',
  pdfError: 'PDF를 열 수 없습니다.',
  videoUnsupported: '이 동영상의 코덱은 재생할 수 없습니다. MP4(H.264/AAC)로 변환한 파일을 가져오면 재생할 수 있습니다. 원본은 그대로 보관됩니다.',
  videoError: '동영상을 재생할 수 없습니다.',
```

`apps/desktop/src/renderer/src/viewers/PdfViewer.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js runtime data copied by scripts/copy-pdfjs-assets.mjs; same-origin in dev and production. */
const dataUrl = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
const ZOOMS = [0.5, 1, 2] as const;

export function PdfViewer({ item }: { item: LibraryItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState<number>(1);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPageNum(1);
    setError(null);
    const task = pdfjs.getDocument({
      url: assetUrl(item.assetId),
      cMapUrl: dataUrl('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: dataUrl('standard_fonts'),
      wasmUrl: dataUrl('wasm'),
      iccUrl: dataUrl('iccs'),
      enableXfa: false,
    });
    task.promise.then(
      (d) => { if (!cancelled) setDoc(d); },
      (e: unknown) => { if (!cancelled) setError(`${t.pdfError} ${(e as Error)?.message ?? ''}`); },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [item.assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: zoom * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
        if (!cancelled) setRendered((n) => n + 1);
      } catch (e) {
        if (!cancelled && (e as Error)?.name !== 'RenderingCancelledException') setError(`${t.pdfError} ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, zoom]);

  const total = doc?.numPages ?? 0;
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="secondary" data-testid="pdf-prev" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>{t.pdfPrev}</button>
        <span data-testid="pdf-page-indicator">{total > 0 ? t.pdfPage(pageNum, total) : '…'}</span>
        <button className="secondary" data-testid="pdf-next" disabled={pageNum >= total} onClick={() => setPageNum((p) => p + 1)}>{t.pdfNext}</button>
        <label>
          {t.pdfZoom}{' '}
          <select data-testid="pdf-zoom" value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={String(z)}>{z * 100}%</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert" data-testid="pdf-error">{error}</p>}
      <div className="pdf-stage">
        <canvas ref={canvasRef} data-testid="pdf-canvas" data-rendered={rendered} />
      </div>
    </div>
  );
}
```

`apps/desktop/src/renderer/src/viewers/VideoViewer.tsx`:
```tsx
import { useState, type SyntheticEvent } from 'react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings';

export function VideoViewer({ item }: { item: LibraryItem }) {
  const [error, setError] = useState<{ message: string; detail: string } | null>(null);
  const onError = (e: SyntheticEvent<HTMLVideoElement>) => {
    const err = e.currentTarget.error;
    setError({
      message: err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? t.videoUnsupported : t.videoError,
      detail: err?.message ?? '',
    });
  };
  return (
    <div className="video-viewer">
      <video data-testid="video" src={assetUrl(item.assetId)} controls preload="metadata" onError={onError} />
      {error && (
        <div className="error-box" role="alert" data-testid="video-error">
          <p>{error.message}</p>
          {error.detail && <p className="muted small">{error.detail}</p>}
        </div>
      )}
    </div>
  );
}
```

`ViewerHost.tsx`의 `ViewerBody`를 교체하고 import를 추가:
```tsx
import { PdfViewer } from './PdfViewer';
import { VideoViewer } from './VideoViewer';

function ViewerBody({ item }: { item: LibraryItem }) {
  return item.type === 'pdf' ? <PdfViewer item={item} /> : <VideoViewer item={item} />;
}
```
(`t.viewerPending` 키는 더 이상 쓰지 않으므로 `strings.ts`에서 삭제)

`styles.css` 끝에 추가:
```css
.pdf-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; color: var(--muted); }
.pdf-stage { overflow: auto; background: var(--bg); border-radius: 8px; padding: 12px; max-height: calc(100vh - 200px); }
.pdf-stage canvas { display: block; margin: 0 auto; box-shadow: 0 1px 4px rgb(0 0 0 / 0.15); background: #fff; }
.video-viewer video { width: 100%; max-height: calc(100vh - 220px); background: #000; border-radius: 8px; }
.error-box { background: var(--danger-soft); color: var(--danger); border-radius: 8px; padding: 10px 14px; margin-top: 10px; }
```

- [ ] **Step 4: 검증**

Run: `pnpm typecheck && pnpm test && pnpm e2e:xvfb`
Expected: `smoke`, `library`, `first-session`(2개) 모두 PASS. 출력의 `[measure] video seek` 줄을 Task 11 문서에 옮겨 적는다.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(desktop): pdf.js and video viewers, generated fixtures, first-session E2E

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

### Task 11: P0 기록 · ADR · AC 추적표 · README

**Files:**
- Create: `docs/p0-verification.md`, `docs/decisions/0001-runtime.md`, `docs/decisions/0002-anchor-coordinates.md`, `docs/decisions/0003-storage-layout.md`, `docs/acceptance.md`, `README.md`

**Interfaces:**
- Consumes: 앞선 모든 작업의 테스트 결과와 측정값. 측정값은 이 작업에서 **다시 실행해 얻은 값**을 쓴다(아래 명령).

- [ ] **Step 1: 측정 재실행**

Run:
```bash
pnpm fixtures
pnpm typecheck 2>&1 | tail -3
pnpm test 2>&1 | tail -6
pnpm e2e:xvfb 2>&1 | tee .e2e-run.log | tail -15
grep '\[measure\]' .e2e-run.log
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec(\"create virtual table t using fts5(x, tokenize='trigram')\");d.prepare('insert into t values (?)').run('신호 증폭 연쇄');console.log('sqlite',d.prepare('select sqlite_version() v').get().v,'2-char',d.prepare('select count(*) n from t where t match ?').get('증폭').n,'3-char',d.prepare('select count(*) n from t where t match ?').get('증폭 연').n)"
```
(마지막 `node -e`는 `packages/db` 디렉터리에서 실행해 better-sqlite3를 해석한다.)
Expected: 모든 검사 통과, seek 측정 JSON 1줄, trigram `2-char 0`·`3-char 1`.

- [ ] **Step 2: `docs/p0-verification.md` 작성**

아래 표의 "실측"은 Step 1 출력으로 채운다. 탐색 단계(2026-10-20, scratchpad probe) 값은 이미 확인된 것이다.

```markdown
# P0 검증 기록

- 일시: 2026-10-20 · 환경: bce-colab-g01, Debian 13 x86_64, headless + Xvfb 1440×900×24, NFS 홈
- 런타임: Electron 44.9.1 (Node 24.22.0, Chromium 152.0.7977.167, NODE_MODULE_VERSION 149)
- 도구: electron-vite 6.0.0, Vite 8.3.4, TypeScript 7.0.2, vitest 5.0.5, Playwright 1.64.1, pdfjs-dist 6.4.299, better-sqlite3 13.0.3(SQLite 3.53.4), React 19.3.1, zod 4.6.7, pnpm 10.15.1
- 판정 범례: ✅ 통과 · ⚠️ 제한 있음 · ⏳ Mac에서 재확인 필요

| # | 항목 | 방법 | 기대 | 실측 | 판정 |
|---|---|---|---|---|---|
| 1 | Electron 실행(xvfb) + sandbox renderer | `tests/e2e/smoke.spec.ts` | `learn://app/index.html` 로드, `require` 없음, `window.learn` 존재 | (Step 1) | |
| 2 | better-sqlite3 in Electron, WAL, FTS5, 스냅샷 | smoke(DB 마이그레이션) + vitest + Step 1 node 스크립트 | 로드·WAL·`VACUUM INTO` 동작 | N-API라 Node 22·Electron 44에서 같은 바이너리 로드. trigram 2글자 질의 0건 / 3글자 1건 | ✅ / ⚠️ 한국어 2글자 검색은 P1에서 별도 처리 필요 |
| 3 | pdf.js(sandbox+CSP, 워커) | first-session E2E | 캔버스 잉크 픽셀 > 500, 회전 쪽 가로형 | (Step 1) | |
| 4 | H.264/AAC MP4 재생·Range·seek | first-session E2E `[measure]` | Range 206, seek 오차 ≤ 500ms | probe: `bytes=0-`, `bytes=2392064-` 요청, 오차 0.47–0.51ms, seek 168–192ms / E2E: (Step 1) | |
| 5 | 미지원 코덱 안내 | MPEG-4 Part 2 fixture | 원인 표시 | `MediaError.code=4`, `DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams`, 화면에 한국어 안내 | ✅ (Linux) ⏳ Mac |
| 6 | HEVC | `sample-hevc.mp4` 수동 열기 | 플랫폼 의존 — 기록만 | (선택 기록) | ⏳ Mac |
| 7 | `file://` origin | probe | — | Origin `null` 전송, pdf.js XHR CORS 차단 → `learn://app` 단일 스킴 채택(ADR-0001) | ✅ 해결 |
| 8 | EPUB 렌더러 후보 | 문헌 비교(구현 없음) | 라이선스·CFI·스크립트 차단 | 아래 표 | 결정은 P5 spike |
| 9 | PPTX 변환 | 서버에 LibreOffice 없음 | — | 미검증 | ⏳ Mac. 대체 경로: 사용자가 PDF를 함께 가져오기 |
| 10 | Electron 바이너리 설치 | `pnpm install` | — | GitHub 릴리스 연결당 ~20–60KB/s. 64개 범위 병렬 수신(20초) + `checksums.json` sha256 검증 후 `@electron/get` 캐시에 배치 | ⚠️ 이 서버 한정 |

## EPUB 렌더러 후보 (P5에서 spike로 확정)

| 후보 | 라이선스 | CFI | 비고 |
|---|---|---|---|
| foliate-js | MIT | 지원 | 의존성 없음, 활발. 스크립트 실행 차단을 iframe sandbox로 직접 구성해야 함 |
| epub.js | BSD-2-Clause | 지원 | 오래 쓰였지만 유지보수 느림. iframe 기반 |
| Readium ts-toolkit | BSD-3-Clause | Locator(CFI 변환 필요) | 표준 지향, 구성 요소 많음 |

## 의존성·변환기 라이선스

| 구성 요소 | 라이선스 | 배포 메모 |
|---|---|---|
| Electron | MIT | Chromium/FFmpeg 고지 포함(번들 LICENSES.chromium.html) |
| better-sqlite3 / SQLite | MIT / Public Domain | 네이티브 모듈 — macOS 서명 대상 |
| pdfjs-dist | Apache-2.0 | cmaps(Adobe, BSD-3) 포함 |
| React | MIT | |
| zod | MIT | |
| electron-vite / Vite | MIT | 개발 도구 |
| LibreOffice(후보) | MPL-2.0 | 번들하지 않고 사용자 설치 감지 예정 |
| FFmpeg(fixture 생성만) | LGPL/GPL(빌드 구성 의존) | 앱에 포함하지 않음 |
```
(EPUB·라이선스 표 항목은 작성 시점에 각 저장소 LICENSE 파일로 다시 확인하고, 다르면 고쳐 적는다.)

- [ ] **Step 3: ADR 세 개 작성**

`docs/decisions/0001-runtime.md`:
```markdown
# ADR-0001: 런타임 — Electron + electron-vite, 단일 앱 스킴

- 상태: 채택 (2026-10-20) · 관련: spec 07, P0 #1·#4·#7

## 맥락
여러 Viewer(PDF·EPUB·슬라이드·웹)와 로컬 영상, 파일 시스템 작업을 한 UI에서 연결해야 한다. 영상 코덱 동작이 OS마다 달라지면 AC05·AC20 검증이 플랫폼별로 갈라진다.

## 결정
- Electron 44 + electron-vite 6 + React + TypeScript. Tauri는 채택하지 않는다.
- renderer는 `file://`이 아닌 `learn://app`(standard·secure·stream 권한)으로 로드하고, 자료도 같은 origin의 `learn://app/asset/<assetId>`로 제공한다.
- `sandbox`, `contextIsolation` 켬, `nodeIntegration` 끔. preload는 `LearnApi`만 노출. IPC 호출자는 프레임 URL(프로토콜+호스트)로 검증.

## 근거
- Electron은 Chromium 자체 미디어 스택을 써서 macOS·Windows에서 같은 코덱 표를 가진다. Tauri는 OS 웹뷰(WKWebView/WebView2)에 따라 코덱·API가 달라진다.
- P0에서 `file://` 페이지는 Origin `null`을 보내 호출자를 구분할 수 없었고 pdf.js 요청이 CORS로 막혔다. 같은 origin 스킴은 CORS 예외 없이 해결하고, Electron 보안 권고(커스텀 프로토콜 사용)와도 맞는다.

## 결과
- dev 모드(Vite dev server)에서만 그 origin 하나에 CORS를 허용한다(패키지 빌드에서는 비활성).
- 재검토 조건: 앱 크기·메모리가 제품 요구를 넘거나, Tauri가 영상 코덱 일관성을 보장할 수 있게 될 때.
```

`docs/decisions/0002-anchor-coordinates.md`:
```markdown
# ADR-0002: 앵커 좌표계 (schema v1)

- 상태: 채택 (2026-10-20) · 관련: spec 06·08, `packages/domain/src/anchors.ts`

## 결정
- 모든 앵커는 불변 `revisionId`에 귀속하고 `schema_version`을 함께 저장한다. 원본 revision이 바뀌면 조용히 옮기지 않고 `ok/review/orphan` 상태로 구분한다.
- **PDF**: `pageIndex`(0부터) + 회전 전 PDF user space의 quad 배열(`[x1,y1,…,x4,y4]`, 단위 pt, 원점 좌하단) + `coordinateSpace:'pdf-user-space'` + 선택 시 quote(exact/prefix/suffix). 화면 좌표는 viewport 변환의 역변환으로 얻는다. 확대·회전과 무관하게 같은 값이어야 한다(AC03, 허용 오차 2pt).
- **동영상**: `startMs`/`endMs`(정수 ms) + 정지 프레임 `frame{atMs,width,height}`(디코딩 해상도) + `rect[x,y,w,h]`를 letterbox를 제외한 프레임 기준 0–1로 정규화(AC04, 허용 오차 0.5%).
- **EPUB**: `spineHref` + `cfi` + quote. **웹**: 스냅샷 revision의 텍스트 위치 + quote. **슬라이드**: 원본 revision + 파생 PDF revision + `slideIndex` + 파생 쪽 quad.
- 화면 픽셀을 그대로 저장하지 않는다.

## 근거
렌더 배율·회전·창 크기·글꼴이 바뀌어도 같은 원문 위치를 가리켜야 하고, 텍스트가 바뀐 revision에서 재앵커를 시도할 근거(quote)가 필요하다.
```

`docs/decisions/0003-storage-layout.md`:
```markdown
# ADR-0003: 저장 구조

- 상태: 채택 (2026-10-20) · 관련: spec 08·09·12

## 결정
- 라이브러리 = 한 폴더: `library.sqlite`, `assets/<sha256 앞 2자>/<sha256>`, `staging/`, `derived/`, `exports/`. 기본 위치 `<userData>/Library`, `LEARN_LIBRARY_DIR`로 바꿀 수 있다.
- 관리형 파일 이름은 해시뿐이다. 표시 이름은 DB에 둔다. 외부 연결은 경로만 기록하며 이식 불가능하다(백업에는 참조로만 남김).
- 가져오기: staging 복사 → 해시 재검증 → 원자적 rename → 단일 트랜잭션 커밋 → 추출 job 등록. 중간 실패는 DB에 흔적을 남기지 않고, 남은 파일은 복구 스캔이 보고만 한다(자동 삭제 없음).
- SQLite: WAL, `foreign_keys=ON`, main 프로세스 단일 연결 = 단일 쓰기 큐. `assets.sha256`은 관리형에만 부분 유일 인덱스.
- 스냅샷·백업은 `VACUUM INTO`(WAL 상태에서도 일관된 단일 파일) + 자산 manifest(sha256) + schema version. 복원은 빈 폴더에만 하고 해시·개수를 검증한다. 마이그레이션 전에는 `library.sqlite.pre-v<N>.bak` 스냅샷을 남긴다.
- 비밀키는 DB에 저장하지 않는다(OS keychain, P3).

## 근거
원본 불변·재시작 복구·빈 프로필 복원(AC01·AC06·AC15)을 파일 시스템과 DB 양쪽에서 단순하게 보장하기 위해서다.
```

- [ ] **Step 4: `docs/acceptance.md` 작성**

상태 범례: `통과`(이번 세션 자동 검증) · `부분`(일부만 자동 검증) · `미착수`. 근거 열에는 테스트 파일/이름을 쓴다.
```markdown
# Acceptance 추적표 (AC01–AC20)

- 갱신: 2026-10-20 · 기준: `docs/spec.html` 14절 · 최종 완료 판정은 P6에서 한다. R1 완료를 전체 완료로 보고하지 않는다.

| ID | 요약 | 상태 | 근거 / 남은 일 |
|---|---|---|---|
| AC01 | 복사 가져오기 후 원래 경로 이동해도 열림, linked는 missing·재연결 | 부분 | `importer.test.ts` "keeps working after the original file is moved away", `recovery.test.ts` relink, `library.spec.ts` · 남은 일: MP4 linked E2E |
| AC02 | 중복 선택 UI, 원본 삭제 없음 | 통과 | `importer.test.ts` duplicates, `library.spec.ts` duplicate prompt |
| AC03 | PDF 회전·배율에서 필기 위치 유지(2pt) | 미착수 | P2 필기. 좌표 규칙은 ADR-0002, 배율 렌더는 `first-session.spec.ts` zoom |
| AC04 | 영상 letterbox·창 크기 변경 후 정지 프레임 필기 위치(0.5%) | 미착수 | P2 |
| AC05 | 시간 메모 클릭 → seek 오차 ≤ 500ms | 부분 | `first-session.spec.ts` seek 측정 (값: p0-verification #4). 시간 메모는 P2 |
| AC06 | 저장 완료 필기·위치가 강제 종료 후 복원, undo/redo | 부분 | `first-session.spec.ts` SIGKILL 후 라이브러리 유지. 필기·위치·undo는 P2 |
| AC07 | EPUB 글꼴/폭 변경 후 하이라이트 유지 | 미착수 | P5 |
| AC08 | PPTX 변환·실패 안내·원본 보존 | 미착수 | P5 (LibreOffice 미설치 서버, Mac 확인) |
| AC09 | 웹 스냅샷 offline·스크립트 차단 | 미착수 | P5 |
| AC10 | 튜터 인용 클릭 → 같은 revision 위치 | 미착수 | P3 |
| AC11 | 선택 밖 자료·제외 기억이 provider 요청에 없음 | 미착수 | P3 |
| AC12 | 시청만으로 숙달 claim 없음 | 미착수 | P4 |
| AC13 | 근거 삭제 시 파생 claim·인덱스 정리 | 미착수 | P4 |
| AC14 | 인터넷 없이 자료·필기·검색·복습, 원격 요청 자동 재전송 없음 | 부분 | 현재 앱은 네트워크를 쓰지 않음(자료·열기 offline 동작). 검색·복습·튜터는 이후 단계 |
| AC15 | 빈 프로필 복원 시 해시·필기 수·인용·기억 근거 일치 | 부분 | `backup.test.ts` (자산 해시·개수). 필기·인용·기억은 해당 단계에서 manifest 확장 |
| AC16 | 10,000 item 검색 p95 300ms, 첫 PDF 2초, MP4 3초 | 미착수 | P6 성능(기준 장비 Apple Silicon 16GB는 Mac에서) |
| AC17 | 필기 입력 반응 p95 50ms | 미착수 | P2/P6 |
| AC18 | 키보드 조작·포커스·200% 확대 | 부분 | 모든 조작이 button/select이며 `:focus-visible` 표시. 수동 점검 체크리스트는 P6 |
| AC19 | 악성 HTML·경로 탈출·프롬프트 주입 무해 | 부분 | `resolveAssetPath` 경로 탈출 거부(`primitives.test.ts`), `url-policy.test.ts`, IPC zod 검증, CSP 헤더. HTML·프롬프트 주입 fixture는 P3/P5 |
| AC20 | 키 없이 신규 설치·mock 구분·서명 배포본에서 PDF·영상 | 부분 | 키 없이 실행됨(smoke). 서명·패키징은 P6(Mac) |
```

- [ ] **Step 5: `README.md` 작성**

```markdown
# Learn

자료를 소유하고, 마음껏 필기하며, 나를 이해하는 튜터와 공부하는 로컬 우선 데스크톱 학습 앱. 제품 명세는 [`docs/spec.html`](docs/spec.html).

> 현재 상태: 첫 세션(P0 + 자료 기반 최소 수직선). PDF·동영상 가져오기/열기까지 동작한다. 필기(P2), 튜터(P3), 기억·복습(P4)은 아직 없다. 진행 상황은 [`docs/acceptance.md`](docs/acceptance.md).

## 요구 사항
- Node 22.12+, pnpm 10.15 (`corepack enable`)
- macOS: Xcode Command Line Tools(better-sqlite3 소스 빌드)
- Linux 헤드리스 검증: `xvfb-run`, fixture 생성: `ffmpeg`(libx264)

## 실행
    pnpm install
    pnpm dev            # 개발 실행 (Vite HMR)
    pnpm build && pnpm --filter @learn/desktop start   # 빌드본 실행

라이브러리 위치는 기본 `<userData>/Library`이다. 다른 폴더를 쓰려면 `LEARN_LIBRARY_DIR=/path/to/Library pnpm dev`.

## 검증
    pnpm typecheck
    pnpm test           # 단위·통합 (vitest)
    pnpm fixtures       # 테스트용 PDF·동영상 생성 (ffmpeg 필요)
    pnpm e2e            # Electron E2E (macOS/데스크톱)
    pnpm e2e:xvfb       # Electron E2E (헤드리스 Linux)

E2E 스크린샷과 trace는 `test-results/`에 남는다.

## 구조
- `packages/domain` 타입·스키마·Result · `packages/db` SQLite·마이그레이션 · `packages/library` 가져오기·복구·백업
- `apps/desktop` Electron(main/preload/renderer) · `docs/decisions` ADR · `docs/p0-verification.md` P0 기록

## 문제 해결
- `pnpm install`이 Electron 다운로드에서 멈추면(느린 GitHub 릴리스 연결) 해당 버전 zip을 받아 `electron` 패키지의 `checksums.json` sha256과 대조한 뒤 `@electron/get` 캐시(`~/.cache/electron/<sha256(릴리스 URL 디렉터리)>/`, macOS는 `~/Library/Caches/electron/…`)에 두고 다시 설치한다. 자세한 내용은 `docs/p0-verification.md` #10.
```

- [ ] **Step 6: 최종 검증 후 Commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e:xvfb`
Expected: 전부 PASS.

```bash
git add -A
git commit -m "docs: P0 verification record, ADRs 0001-0003, AC tracking table, README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01LH2FDh4QwsGUFR3V2KewHi"
```

---

## 완료 보고 형식 (명세 15절 12항)

세션 종료 시 다음만 간결히 보고한다: 변경 파일(패키지 단위), 실행 방법, 테스트 결과(개수·실측값), 알려진 한계, 다음 단계(P1: 컬렉션·태그·검색(한국어 2글자 처리)·휴지통·백업 UI, P2: 필기).
