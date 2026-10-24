import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button as AriaButton, Disclosure, DisclosurePanel, Heading } from 'react-aria-components';
import { Icon } from '../ui/Icon';
import { useSections, type SectionId } from './sections';

/** A panel section (library.html .section): a disclosure head with the section's name, and room at its end (`extra`). */
export function Section({ id, title, extra, testId, children }: { id: SectionId; title: string; extra?: ReactNode; testId: string; children: ReactNode }) {
  const open = useSections((s) => s.open[id]);
  const setOpen = useSections((s) => s.setOpen);
  return (
    <section className="section" data-testid={testId}>
      <Disclosure isExpanded={open} onExpandedChange={(next) => setOpen(id, next)}>
        <div className="section-head">
          <Heading level={3} className="section-title">
            <AriaButton slot="trigger" className="section-toggle">
              <Icon icon={ChevronDown} size="xs" />
              {title}
            </AriaButton>
          </Heading>
          {extra}
        </div>
        <DisclosurePanel className="section-body">{children}</DisclosurePanel>
      </Disclosure>
    </section>
  );
}
