import type { DropControlSnapshot } from '@features/active-roast/model/batch';
import type { RoastingState } from '@features/active-roast/model/status';
import { captureDropControlSnapshot } from './drop-cancel-control';

/** ActiveRoast applyDrop — machine wiring must pass live pidActive, not store-only. */
export const finishDropControlSnapshot = (
    roastState: Pick<RoastingState, 'pid' | 'liveData'>,
    machineWiring: { pidActive: boolean; batchEvents: unknown },
): DropControlSnapshot => captureDropControlSnapshot(roastState, { pidActive: machineWiring.pidActive });
