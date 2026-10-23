import { LibraryBig } from 'lucide-react';
import { ListBox, ListBoxItem } from 'react-aria-components';
import { useCommands } from '../commands/CommandProvider';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/**
 * M3 interim library navigator: one row, 내 라이브러리, always the current location (the reader is still "inside" it).
 * Activating it from a reader goes back through the registry (nav.back). M5 replaces this with the collection tree.
 */
export function LibrarySidebar({ count }: { count: number }) {
  const { run, isEnabled } = useCommands();
  return (
    <>
      <div className="section-label" id="sidebar-library-heading">
        {t.shell.libraryHeading}
      </div>
      <ListBox aria-labelledby="sidebar-library-heading" className="nav-list" onAction={() => isEnabled('nav.back') && run('nav.back')}>
        <ListBoxItem id="library" textValue={t.shell.myLibrary} className="nav-row" data-current="" data-testid="nav-library">
          <Icon icon={LibraryBig} />
          <span className="label ellipsis">{t.shell.myLibrary}</span>
          {count > 0 && <span className="count num">{count}</span>}
        </ListBoxItem>
      </ListBox>
    </>
  );
}
