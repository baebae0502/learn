import { useEffect, useState } from 'react';
import type { LibraryItem } from '@learn/domain';
import { api, unwrap } from '../api';
import { t } from '../strings';
import { PdfViewer } from './PdfViewer';
import { VideoViewer } from './VideoViewer';

/** The library list refreshes itself on libraryChanged (pushed by main after a relink). */
export function ViewerHost({ itemId, onBack }: { itemId: string; onBack(): void }) {
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    unwrap(api().library.get({ itemId })).then(
      (i) => { if (!cancelled) setItem(i); },
      (e: Error) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [itemId]);

  const relink = async () => {
    if (!item) return;
    setError(null);
    try {
      const updated = await unwrap(api().library.pickAndRelink({ assetId: item.assetId }));
      if (updated) setItem(updated);
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
  return item.type === 'pdf' ? <PdfViewer key={item.id} item={item} /> : <VideoViewer key={item.id} item={item} />;
}
