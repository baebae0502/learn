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
  /** Right-click on a row: native item context menu (client coordinates). */
  onItemContextMenu(itemId: string, x: number, y: number): void;
}

export function LibraryView({ items, failures, busy, onPick, onImportPaths, onOpen, onItemContextMenu }: LibraryViewProps) {
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
              <tr
                key={item.id}
                data-testid="item-row"
                onContextMenu={(e) => {
                  e.preventDefault();
                  onItemContextMenu(item.id, e.clientX, e.clientY);
                }}
              >
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
