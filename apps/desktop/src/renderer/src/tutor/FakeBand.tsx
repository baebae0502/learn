import { FlaskConical } from 'lucide-react';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/** Under the panel's head while the chosen agent is the fake, so no screen passes it off as a real one. Main reads a stored fake choice as none in a packaged build, so only development, demo and test builds ever get here. */
export function FakeBand() {
  return (
    <div className="tutor-band" role="status" data-testid="tutor-fake-band">
      <Icon icon={FlaskConical} size="sm" />
      {t.tutor.agents.fakeBand}
    </div>
  );
}
