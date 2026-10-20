import { z } from 'zod';

export const readingLocatorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf'),
    pageIndex: z.number().int().min(0),
    scale: z.number().positive().optional(),
    top: z.number().optional(),
    left: z.number().optional(),
  }),
  z.object({ kind: z.literal('video'), timeMs: z.number().int().min(0) }),
]);
export type ReadingLocator = z.infer<typeof readingLocatorSchema>;

export interface ReadingPosition {
  itemId: string;
  revisionId: string;
  locator: ReadingLocator;
  progress: number | null;
  openedAt: string | null;
  updatedAt: string;
}
