import { z } from 'zod';

const dateString = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/);
const httpUrl = z.string().max(2048).refine((s) => {
  try {
    const p = new URL(s).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
});

/** Item metadata, schema v1. */
export const itemMetadataSchema = z.object({
  creators: z.array(z.object({ name: z.string().min(1).max(200), role: z.enum(['author', 'editor', 'lecturer', 'other']) })).default([]),
  date: dateString.optional(),
  publisher: z.string().max(500).optional(),
  url: httpUrl.optional(),
  language: z.string().max(35).optional(),
  abstract: z.string().max(10000).optional(),
  extra: z.string().max(10000).optional(),
});
export type ItemMetadata = z.infer<typeof itemMetadataSchema>;

/** Corrupt or invalid stored JSON degrades to empty metadata; only a warning code is logged (never content). */
export function parseItemMetadata(json: string): ItemMetadata {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn('METADATA_CORRUPT_JSON');
    return itemMetadataSchema.parse({});
  }
  const r = itemMetadataSchema.safeParse(raw);
  if (!r.success) {
    console.warn('METADATA_INVALID');
    return itemMetadataSchema.parse({});
  }
  return r.data;
}

export function yearOf(meta: ItemMetadata): number | null {
  if (!meta.date) return null;
  const y = Number.parseInt(meta.date.slice(0, 4), 10);
  return Number.isNaN(y) ? null : y;
}

export const creatorNames = (meta: ItemMetadata): string[] => meta.creators.map((c) => c.name);
