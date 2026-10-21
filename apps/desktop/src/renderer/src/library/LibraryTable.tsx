import { Clapperboard, FileText, Link, TriangleAlert } from 'lucide-react';
import type { LibraryItem } from '@learn/domain';
import { formatDate, formatSize } from '../format';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/**
 * M3 interim library list (M4 replaces it with the virtualized RAC table and keeps these metrics).
 * Open = click/↩ on a title or double-click on the row; right-click = native item menu. No selection or sorting yet.
 */
export function LibraryTable(props: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onContextMenu(itemId: string, x: number, y: number): void }) {
  return (
    <div className="table library-table" role="table" aria-label={t.library.table} data-testid="library-table">
      <div className="table-head" role="row">
        <div className="th" role="columnheader">{t.library.colTitle}</div>
        <div className="th" role="columnheader">{t.library.colType}</div>
        <div className="th end" role="columnheader">{t.library.colSize}</div>
        <div className="th" role="columnheader">{t.library.colAdded}</div>
      </div>
      <div className="table-body" role="rowgroup">
        {props.items.map((item) => {
          const missing = item.availability === 'missing';
          return (
            <div
              key={item.id}
              className="table-row"
              role="row"
              data-testid="item-row"
              data-missing={missing || undefined}
              onDoubleClick={() => props.onOpen(item.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                props.onContextMenu(item.id, e.clientX, e.clientY);
              }}
            >
              <div className="td" role="cell">
                <Icon icon={item.type === 'video' ? Clapperboard : FileText} />
                <button type="button" className="row-open" data-testid="open-item" data-title={item.title} title={item.title} onClick={() => props.onOpen(item.id)}>
                  {item.title}
                </button>
                {item.storageMode === 'linked' && (
                  <span className="linked-mark c-tertiary" title={t.library.linked}>
                    <Icon icon={Link} size="sm" label={t.library.linked} />
                  </span>
                )}
                {missing && (
                  <span className="inline-flag c-warning" title={t.library.missingTitle} data-testid="missing-flag">
                    <Icon icon={TriangleAlert} size="sm" />
                    {t.library.missing}
                  </span>
                )}
              </div>
              <div className="td" role="cell">{t.library.type[item.type]}</div>
              <div className="td end num" role="cell">{formatSize(item.size)}</div>
              <div className="td num" role="cell" data-col="added">{formatDate(item.createdAt)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
