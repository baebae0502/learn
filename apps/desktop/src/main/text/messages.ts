import { TEXT_LIMITS } from '@learn/domain';
import { z } from 'zod';

export interface ExtractLimits {
  maxPages: number;
  maxPageChars: number;
  maxDocChars: number;
  maxFileBytes: number;
}
export interface ExtractRequest {
  type: 'extract';
  jobId: string;
  file: string;
  startPage: number;
  limits: ExtractLimits;
  assetsDir: string;
}

export type WorkerMessage =
  | { type: 'opened'; jobId: string; pages: number }
  | { type: 'pages'; jobId: string; from: number; texts: string[] }
  | { type: 'done'; jobId: string; pages: number; truncated: boolean }
  | { type: 'failed'; jobId: string; reason: 'locked' | 'damaged' | 'too-large' };

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The four messages a worker may send (spec 5.2); anything else, or any extra key, is refused. */
export const workerMessage: z.ZodType<WorkerMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('opened'), jobId: z.uuid(), pages: count }).strict(),
  z
    .object({
      type: z.literal('pages'),
      jobId: z.uuid(),
      from: count,
      texts: z.array(z.string().max(TEXT_LIMITS.maxPageChars)).min(1).max(TEXT_LIMITS.batchPages),
    })
    .strict(),
  z.object({ type: z.literal('done'), jobId: z.uuid(), pages: count, truncated: z.boolean() }).strict(),
  z.object({ type: z.literal('failed'), jobId: z.uuid(), reason: z.enum(['locked', 'damaged', 'too-large']) }).strict(),
]);

/** The message if it is well formed and comes where this job expects it, else null (the caller kills the worker). */
export function checkWorkerMessage(raw: unknown, at: { jobId: string; nextPage: number; pages: number | null }): WorkerMessage | null {
  const parsed = workerMessage.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (m.jobId !== at.jobId) return null;
  switch (m.type) {
    case 'opened':
      return at.pages === null ? m : null;
    case 'pages': {
      if (at.pages === null || m.from !== at.nextPage || m.from + m.texts.length > at.pages) return null;
      const chars = m.texts.reduce((sum, t) => sum + t.length, 0);
      return chars <= TEXT_LIMITS.batchChars + TEXT_LIMITS.maxPageChars ? m : null;
    }
    case 'done':
      return at.pages !== null && m.pages <= at.pages ? m : null;
    case 'failed':
      return m;
  }
}
