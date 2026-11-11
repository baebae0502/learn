import type { KeyboardEvent } from 'react';
import { EyeOff, FolderCog, GraduationCap, KeyRound, Send, ShieldCheck, type LucideIcon } from 'lucide-react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

const { consent } = t.tutor;

/** One fact of the card: what goes out, what does not, what the agent may touch, where it keeps its settings, who handles the login. */
const FACTS: ReadonlyArray<{ id: string; icon: LucideIcon; title: string; text: string }> = [
  { id: 'sends', icon: Send, title: consent.sends.title, text: consent.sends.text },
  { id: 'not-sent', icon: EyeOff, title: consent.notSent.title, text: consent.notSent.text },
  { id: 'tools', icon: ShieldCheck, title: consent.tools.title, text: consent.tools.text },
  { id: 'config', icon: FolderCog, title: consent.config.title, text: consent.config.text },
  { id: 'login', icon: KeyRound, title: consent.login.title, text: consent.login.text },
];

/**
 * The first-use consent (spec 8.6, mockup state 2): a card in the panel, one company and one agent, what is sent and what is not.
 * 동의 is also ↩ while the card itself has the focus (a button keeps its own ↩).
 */
export function ConsentCard({ onAgree, onLater }: { onAgree(): void; onLater(): void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget || e.nativeEvent.isComposing) return;
    e.preventDefault();
    onAgree();
  };
  return (
    <section className="tutor-consent" role="region" aria-label={consent.region} tabIndex={-1} onKeyDown={onKeyDown} data-testid="tutor-consent">
      <div className="tutor-consent-head">
        <span className="badge-tile">
          <Icon icon={GraduationCap} size="md" />
        </span>
        <h2>{consent.title}</h2>
      </div>
      <p className="tutor-text" data-testid="tutor-consent-lead">{consent.lead}</p>
      <ul className="tutor-facts">
        {FACTS.map((f) => (
          <li key={f.id} className="tutor-fact" data-testid={`tutor-consent-${f.id}`}>
            <Icon icon={f.icon} size="md" />
            <div>
              <div className="f-title">{f.title}</div>
              <div className="f-text">{f.text}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="tutor-text small">{consent.note}</p>
      <div className="tutor-consent-actions">
        <Button onPress={onLater} testId="tutor-consent-later">
          {consent.later}
        </Button>
        <Button variant="primary" onPress={onAgree} testId="tutor-consent-agree">
          {consent.agree}
        </Button>
      </div>
    </section>
  );
}
