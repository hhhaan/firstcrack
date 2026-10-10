import type { PidRuntime } from '@entities/machine';
import type { DropControlSnapshot } from '@features/active-roast/model/batch';
import type { RoastingState } from '@features/active-roast/model/status';

export const captureDropControlSnapshot = (state: Pick<RoastingState, 'pid' | 'liveData'>): DropControlSnapshot => {
    const pid = state.pid;
    const pidEngaged = pid?.state === 'running' || pid?.state === 'holding';
    return {
        pidEngaged,
        pidSv: pidEngaged && pid?.sv != null ? pid.sv : null,
        heater: state.liveData?.heater ?? null,
    };
};

export const isPidEngaged = (pid: PidRuntime | null | undefined): boolean =>
    pid?.state === 'running' || pid?.state === 'holding';

/** After Cancel Drop, warn when drop-time PID/heater changes are still uncorrected. */
export const shouldWarnDropCancelControl = (
    before: DropControlSnapshot,
    pid: PidRuntime | null | undefined,
    heater: number | null | undefined,
): boolean => {
    if (before.pidEngaged && !isPidEngaged(pid)) return true;
    if (before.heater == null) return false;
    if (heater == null) return before.heater > 0;
    return Math.abs(before.heater - heater) > 0.05;
};
