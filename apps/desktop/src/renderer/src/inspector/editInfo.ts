import { itemMetadataSchema, titleSchema, type ItemMetadata } from '@learn/domain';
import { t } from '../strings';

export type CreatorRole = ItemMetadata['creators'][number]['role'];
/** In the order the role menu lists them (spec §5.3: 저자/편집자/강연자/기타). */
export const CREATOR_ROLES: readonly CreatorRole[] = ['author', 'editor', 'lecturer', 'other'];
export interface CreatorDraft {
  /** The row's identity while it is edited (its React key and its error's key): rows move and go. */
  key: string;
  name: string;
  role: CreatorRole;
}
/** The form's values as typed. */
export interface InfoDraft {
  title: string;
  creators: CreatorDraft[];
  date: string;
  publisher: string;
  language: string;
  url: string;
  abstract: string;
  extra: string;
}
export type InfoTextField = 'title' | 'date' | 'publisher' | 'language' | 'url' | 'abstract' | 'extra';
/** A field the form can mark: a text field, or a creator row by its key. */
export type FieldKey = InfoTextField | `creator:${string}`;
export type FieldErrors = Partial<Record<FieldKey, string>>;
export interface CleanInfo {
  title: string;
  metadata: ItemMetadata;
}

const OPTIONAL = ['date', 'publisher', 'language', 'url', 'abstract', 'extra'] as const;
type OptionalField = (typeof OPTIONAL)[number];
/** The form's order, where the focus looks for the first marked field (creator rows sit after the title). */
export const FIELD_ORDER: readonly InfoTextField[] = ['title', ...OPTIONAL];

export function draftOf(title: string, meta: ItemMetadata, newKey: () => string): InfoDraft {
  return {
    title,
    creators: meta.creators.map((c) => ({ key: newKey(), name: c.name, role: c.role })),
    date: meta.date ?? '',
    publisher: meta.publisher ?? '',
    language: meta.language ?? '',
    url: meta.url ?? '',
    abstract: meta.abstract ?? '',
    extra: meta.extra ?? '',
  };
}

/** The draft as it would be saved: trimmed, empty fields left out, rows without a name dropped (and the rows that stay). */
function asSaved(d: InfoDraft): { title: string; rows: CreatorDraft[]; metadata: Record<string, unknown> } {
  const rows = d.creators.filter((c) => c.name.trim() !== '');
  const metadata: Record<string, unknown> = { creators: rows.map((c) => ({ name: c.name.trim(), role: c.role })) };
  for (const field of OPTIONAL) {
    const value = d[field].trim();
    if (value !== '') metadata[field] = value;
  }
  return { title: d.title.trim(), rows, metadata };
}

/** A marked field's footnote, by field and by what the schema found (too long, or not the form it wants). */
function messageFor(field: OptionalField, code: string): string {
  const m = t.inspector.editor.errors;
  switch (field) {
    case 'date':
      return m.date;
    case 'url':
      return code === 'too_big' ? m.urlLong : m.url;
    case 'publisher':
      return m.publisherLong;
    case 'language':
      return m.languageLong;
    case 'abstract':
      return m.abstractLong;
    case 'extra':
      return m.extraLong;
  }
}

/** domain's own schemas (titleSchema, itemMetadataSchema: what main checks again), each problem on its field. */
export function validateInfo(d: InfoDraft): { ok: true; value: CleanInfo } | { ok: false; errors: FieldErrors } {
  const { rows, metadata } = asSaved(d);
  const m = t.inspector.editor.errors;
  const errors: FieldErrors = {};
  const title = titleSchema.safeParse(d.title);
  if (!title.success) errors.title = title.error.issues.some((i) => i.code === 'too_big') ? m.titleLong : m.titleEmpty;
  const meta = itemMetadataSchema.safeParse(metadata);
  if (!meta.success) {
    for (const issue of meta.error.issues) {
      const [field, index] = issue.path;
      if (field === 'creators' && typeof index === 'number') {
        const row = rows[index];
        if (row) errors[`creator:${row.key}`] ??= m.nameLong;
      } else if (typeof field === 'string' && (OPTIONAL as readonly string[]).includes(field)) {
        errors[field as OptionalField] ??= messageFor(field as OptionalField, issue.code);
      }
    }
  }
  if (title.success && meta.success) return { ok: true, value: { title: title.data, metadata: meta.data } };
  return { ok: false, errors };
}

/** Changes are what saving would change: spaces around a value or an empty row are none. */
export function sameInfo(a: InfoDraft, b: InfoDraft): boolean {
  const x = asSaved(a);
  const y = asSaved(b);
  return x.title === y.title && JSON.stringify(x.metadata) === JSON.stringify(y.metadata);
}
