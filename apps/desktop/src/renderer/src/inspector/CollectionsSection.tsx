import { Fragment, useMemo } from 'react';
import { Folder } from 'lucide-react';
import { Button as AriaButton } from 'react-aria-components';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { Icon } from '../ui/Icon';
import { afterEditing } from './editGuard';
import { pathRows } from './collectionRows';
import { Section } from './Section';

/**
 * 컬렉션 (spec 6.1, 6.2): one path row per collection the item is directly in — for several items, the ones all of them
 * are in. A press moves the view to that collection: for one item it stays selected and shown (the exception to
 * "a new view starts with no selection"), for several the selection is cleared. While the info is being edited the
 * editor's rules come first (save, keep, discard), as for any way off the item.
 */
export function CollectionsSection({ ids }: { ids: readonly string[] }) {
  const { model } = useOrganize();
  const rows = useMemo(() => (model ? pathRows(model, ids) : []), [model, ids]);
  if (!model) return null;
  const multi = ids.length > 1;
  const go = (collectionId: string) =>
    afterEditing(() => useLibrary.getState().setScope({ kind: 'collection', id: collectionId }, multi ? undefined : { keepSelected: ids[0]! }));
  return (
    <Section id="collections" title={t.organize.panel.collections.title} testId="collections-section">
      {rows.length === 0 ? (
        <p className="info-hint" data-testid={multi ? 'collections-common-none' : 'collections-none'}>
          {multi ? t.organize.panel.collections.noCommon : t.organize.panel.collections.none}
        </p>
      ) : (
        rows.map((row) => {
          const whole = row.names.join(t.organize.pathSeparator);
          return (
            <AriaButton key={row.id} className="collection-path" data-testid="collection-path" data-collection-id={row.id} aria-label={whole} onPress={() => go(row.id)}>
              <Icon icon={Folder} size="md" />
              <span className="path-text" title={whole}>
                {row.names.map((name, i) => (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className="sep" aria-hidden="true">
                        {' › '}
                      </span>
                    )}
                    {name}
                  </Fragment>
                ))}
              </span>
            </AriaButton>
          );
        })
      )}
    </Section>
  );
}
