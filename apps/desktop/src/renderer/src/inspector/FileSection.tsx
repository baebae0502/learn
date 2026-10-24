import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { ItemDetail } from '@learn/domain';
import { useAppInfo } from '../data/queries';
import { formatSize, homeRelative } from '../format';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { showToast } from '../ui/toasts';
import { Section } from './Section';

/** How long the copy button says 복사했습니다 (spec §5.3). */
export const COPIED_MS = 1500;

interface FileRow {
  field: 'storage' | 'size' | 'originalName' | 'location';
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}

/** 파일 (spec §5.3): where the technical values live (design-spec 9), paths and the hash in mono, end-ellipsised with the whole value as tooltip. */
export function FileSection({ detail }: { detail: ItemDetail }) {
  const home = useAppInfo().data?.homeDir;
  const f = detail.file;
  const rows: FileRow[] = [
    { field: 'storage', label: t.inspector.file.storage, value: t.inspector.storage[f.storageMode] },
    { field: 'size', label: t.inspector.file.size, value: formatSize(f.size) },
    { field: 'originalName', label: t.inspector.file.originalName, value: f.originalName, title: f.originalName },
    ...(f.storageMode === 'linked' && f.externalPath
      ? [{ field: 'location' as const, label: t.inspector.file.location, value: homeRelative(f.externalPath, home), title: f.externalPath, mono: true }]
      : []),
  ];
  return (
    <Section id="file" title={t.inspector.sections.file} testId="file-section">
      <dl className="kv">
        {rows.map((row) => (
          <div key={row.field} className="kv-row" data-testid="file-row" data-field={row.field}>
            <dt>{row.label}</dt>
            <dd className={cx('ellipsis', row.mono && 'mono c-secondary', row.field === 'size' && 'num')} title={row.title}>
              {row.value}
            </dd>
          </div>
        ))}
        <div className="kv-row" data-testid="file-row" data-field="sha256">
          <dt>{t.inspector.fileSha}</dt>
          <dd className="sha">
            <span className="mono c-secondary" data-testid="sha-value" title={f.sha256}>{`${f.sha256.slice(0, 8)}…`}</span>
            <CopyButton value={f.sha256} />
          </dd>
        </div>
      </dl>
    </Section>
  );
}

/** 전체 SHA-256 복사: the clipboard gets the whole value; the tooltip confirms for 1.5 s, and no toast (spec §5.3). */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => setCopied(true),
      (e: unknown) => {
        console.warn(`[inspector] copy failed: ${(e as Error)?.name ?? 'Error'}`);
        showToast({ kind: 'error', title: t.inspector.copyFailedTitle, body: t.inspector.copyFailedBody, testId: 'copy-failed' });
      },
    );
  return (
    <>
      <IconButton icon={Copy} size="small" label={copied ? t.inspector.copied : t.inspector.copySha} tooltipOpen={copied} onPress={() => void copy()} testId="copy-sha" />
      {/* A tooltip is not read out: the confirmation is said in a polite live region too. */}
      <span className="visually-hidden" role="status">
        {copied ? t.inspector.copied : ''}
      </span>
    </>
  );
}
