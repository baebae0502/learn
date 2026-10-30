import { useEffect, useState } from 'react';
import type { LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { Spinner } from '../ui/Spinner';
import { BUSY_DELAY_MS } from './busyScreen';
import { LibraryTable } from './LibraryTable';
import { useLibrarySettings } from './useLibrarySettings';

const NO_ROWS: readonly LibraryItem[] = [];
const ignore = () => {};

/**
 * Before the first list read has answered (M4 spec 3.5, design-spec 6): nothing for 300 ms, then the table's header with
 * "불러오는 중…" where the rows go. It also starts the column and sort reads, so the table that follows is ready at once.
 */
export function LibraryLoading() {
  const settings = useLibrarySettings();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), BUSY_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!shown || !settings.ready) return null;
  return (
    <LibraryTable
      rows={NO_ROWS}
      columns={settings.columns}
      forced={settings.forced}
      sort={settings.sort}
      onSortChange={settings.setSort}
      onColumnsChange={settings.setColumns}
      onOpen={ignore}
      onContextMenu={ignore}
      empty={
        <div className="pane-empty top" data-testid="table-loading">
          <div className="loading" role="status">
            <Spinner />
            {t.library.loading}
          </div>
        </div>
      }
    />
  );
}
