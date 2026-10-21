import { useEffect, useRef } from 'react';
import { t } from '../strings/legacy';

export function DuplicateDialog(props: { path: string; onOpenExisting(): void; onAddAnyway(): void; onCancel(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const name = props.path.split(/[\\/]/).pop() ?? props.path;
  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dup-title" data-testid="duplicate-dialog">
        <h2 id="dup-title">{t.duplicateTitle}</h2>
        <p>{t.duplicateBody(name)}</p>
        <div className="modal-actions">
          <button data-testid="dup-open" onClick={props.onOpenExisting}>{t.openExisting}</button>
          <button data-testid="dup-add" className="secondary" onClick={props.onAddAnyway}>{t.addAnyway}</button>
          <button data-testid="dup-cancel" className="secondary" ref={cancelRef} onClick={props.onCancel}>{t.cancel}</button>
        </div>
      </div>
    </div>
  );
}
