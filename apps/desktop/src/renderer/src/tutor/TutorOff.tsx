import { GraduationCap } from 'lucide-react';
import { t } from '../strings';
import { Button } from '../ui/Button';
import { PaneEmpty } from '../ui/PaneEmpty';

/** The tutor after 나중에: off for this run, and 튜터 켜기… brings the consent card back (spec 8.2). */
export function TutorOff({ onTurnOn }: { onTurnOn(): void }) {
  return (
    <PaneEmpty
      icon={GraduationCap}
      title={t.tutor.off.title}
      testId="tutor-off"
      action={
        <Button onPress={onTurnOn} testId="tutor-turn-on">
          {t.tutor.off.turnOn}
        </Button>
      }
    >
      {t.tutor.off.body}
    </PaneEmpty>
  );
}
