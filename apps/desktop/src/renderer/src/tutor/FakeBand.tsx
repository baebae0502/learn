import { FlaskConical } from 'lucide-react';
import { t } from '../strings';
import { Icon } from '../ui/Icon';

/** Under the panel's head while the chosen agent is the fake (J58, AC20): development, demo and test builds only, since only they can choose it. */
export function FakeBand() {
  return (
    <div className="tutor-band" role="status" data-testid="tutor-fake-band">
      <Icon icon={FlaskConical} size="sm" />
      {t.tutor.agents.fakeBand}
    </div>
  );
}
