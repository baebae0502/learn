import {
  Channels, LearnError, tutorAgentsInput, tutorAskInput, tutorChooseAgentInput, tutorConsentInput, tutorRetryInput, tutorStopInput, tutorViewInput, tutorWarmInput,
} from '@learn/domain';
import { mainStrings } from '../strings';
import type { TutorService } from '../tutor/service';
import type { Handle, IpcDeps } from './register';

/** The tutor (spec 12): every channel is the main window's (channel-kinds.ts); the service exists once the library is open. */
export function registerTutorIpc(handle: Handle, deps: IpcDeps): void {
  const tutor = (): TutorService => {
    if (!deps.tutor) throw new LearnError('LIBRARY_UNAVAILABLE', mainStrings.library.unavailable);
    return deps.tutor;
  };
  handle(Channels.tutor.consent, tutorConsentInput, () => tutor().consent());
  handle(Channels.tutor.agents, tutorAgentsInput, (input) => tutor().agents(input));
  handle(Channels.tutor.chooseAgent, tutorChooseAgentInput, ({ agent }) => tutor().chooseAgent(agent));
  handle(Channels.tutor.view, tutorViewInput, ({ view }) => tutor().view(view));
  handle(Channels.tutor.warm, tutorWarmInput, (input) => tutor().warm(input));
  handle(Channels.tutor.ask, tutorAskInput, (input) => tutor().ask(input));
  handle(Channels.tutor.stop, tutorStopInput, ({ messageId }) => tutor().stop(messageId));
  handle(Channels.tutor.resend, tutorRetryInput, (input) => tutor().resend(input));
  handle(Channels.tutor.reground, tutorRetryInput, (input) => tutor().reground(input));
}
