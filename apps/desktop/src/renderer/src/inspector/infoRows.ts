import type { ItemMetadata, LibraryItem } from '@learn/domain';
import { formatDate } from '../format';
import { t } from '../strings';

export type InfoField = 'creators' | 'date' | 'publisher' | 'language' | 'url' | 'abstract' | 'extra' | 'createdAt' | 'updatedAt';
export interface InfoRow {
  field: InfoField;
  label: string;
  value: string;
  /** text: one value; link: an http(s) URL; long: the abstract (4 lines, then 더 보기); note: the memo as typed; time: a date with its full form as the tooltip. */
  kind: 'text' | 'link' | 'long' | 'note' | 'time';
  title?: string;
}

/** "2024" / "2024. 3." / "2024. 3. 15." from YYYY, YYYY-MM or YYYY-MM-DD; a year alone is labelled 연도 (spec §5.3). */
export function partialDate(date: string): { label: string; value: string } {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!m) return { label: t.inspector.fields.date, value: date };
  const [, y, mo, d] = m;
  if (mo === undefined) return { label: t.inspector.fields.year, value: y! };
  return { label: t.inspector.fields.date, value: d === undefined ? t.inspector.monthDate(Number(y), Number(mo)) : t.inspector.dayDate(Number(y), Number(mo), Number(d)) };
}

const filled = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/** Anything to show beyond the dates (else the panel says what writing it gives). */
export const hasInfo = (meta: ItemMetadata): boolean =>
  meta.creators.length > 0 || [meta.date, meta.publisher, meta.language, meta.url, meta.abstract, meta.extra].some(filled);

const fullTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' });
};

/** The 정보 rows with a value, in the spec's order (§5.3), then 추가일 · 수정일, which are always there. */
export function infoRows(meta: ItemMetadata, item: Pick<LibraryItem, 'createdAt' | 'updatedAt'>, now: Date): InfoRow[] {
  const f = t.inspector.fields;
  const rows: InfoRow[] = [];
  if (meta.creators.length > 0) {
    const names = meta.creators.map((c) => (c.role === 'author' ? c.name : t.inspector.creatorWithRole(c.name, t.inspector.roles[c.role])));
    rows.push({ field: 'creators', label: f.creators, value: names.join(', '), kind: 'text' });
  }
  if (filled(meta.date)) rows.push({ field: 'date', ...partialDate(meta.date), kind: 'text' });
  if (filled(meta.publisher)) rows.push({ field: 'publisher', label: f.publisher, value: meta.publisher, kind: 'text' });
  if (filled(meta.language)) rows.push({ field: 'language', label: f.language, value: meta.language, kind: 'text' });
  if (filled(meta.url)) rows.push({ field: 'url', label: f.url, value: meta.url, kind: 'link' });
  if (filled(meta.abstract)) rows.push({ field: 'abstract', label: f.abstract, value: meta.abstract, kind: 'long' });
  if (filled(meta.extra)) rows.push({ field: 'extra', label: f.extra, value: meta.extra, kind: 'note' });
  rows.push({ field: 'createdAt', label: f.createdAt, value: formatDate(item.createdAt, now), kind: 'time', title: fullTime(item.createdAt) });
  rows.push({ field: 'updatedAt', label: f.updatedAt, value: formatDate(item.updatedAt, now), kind: 'time', title: fullTime(item.updatedAt) });
  return rows;
}
