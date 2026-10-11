import type { PidRuntime } from '@entities/machine';
import type { CompletedRoastRestore, DropControlSnapshot } from '@features/active-roast/model/batch';
import type { RoastingState } from '@features/active-roast/model/status';

export const EMPTY_DROP_CONTROL_SNAPSHOT: DropControlSnapshot = {
    pidEngaged: false,
    pidSv: null,
    heater: null,
};

export const captureDropControlSnapshot = (
    state: Pick<RoastingState, 'pid' | 'liveData'>,
    opts?: { pidActive?: boolean },
): DropControlSnapshot => {
    const pid = state.pid;
    const storeEngaged = pid?.state === 'running' || pid?.state === 'holding';
    const pidEngaged = Boolean(opts?.pidActive || storeEngaged);
    return {
        pidEngaged,
        pidSv: pidEngaged ? (pid?.sv ?? null) : null,
        heater: state.liveData?.heater ?? null,
    };
};

export const isPidEngaged = (pid: PidRuntime | null | undefined): boolean =>
    pid?.state === 'running' || pid?.state === 'holding';

const heaterIsZero = (heater: number | null | undefined): boolean => heater == null || heater <= 0;

/** After Cancel Drop: PID lost, or heater was on and is now 0. */
export const shouldWarnDropCancelControl = (
    before: DropControlSnapshot,
    pid: PidRuntime | null | undefined,
    heater: number | null | undefined,
): boolean => {
    if (before.pidEngaged && !isPidEngaged(pid)) return true;
    if (before.heater != null && before.heater > 0 && heaterIsZero(heater)) return true;
    return false;
};

export type DropCancelControlMessageParts = {
    pidOff: string;
    heaterAt: (heater: number) => string;
    heaterUnknown: string;
    joiner: string;
};

export const buildDropCancelControlMessage = (
    before: DropControlSnapshot,
    pid: PidRuntime | null | undefined,
    heater: number | null | undefined,
    parts: DropCancelControlMessageParts,
): string | null => {
    if (!shouldWarnDropCancelControl(before, pid, heater)) return null;
    const segments: string[] = [];
    const pidLost = before.pidEngaged && !isPidEngaged(pid);
    if (pidLost) segments.push(parts.pidOff);
    if (!pidLost && before.heater != null && before.heater > 0 && heaterIsZero(heater)) {
        segments.push(parts.heaterAt(heater ?? 0));
    } else if (pidLost) {
        if (heater != null) segments.push(parts.heaterAt(Math.round(heater)));
        else segments.push(parts.heaterUnknown);
    }
    return segments.length > 0 ? segments.join(parts.joiner) : null;
};

export const dropCancelWarningFromRestore = (restore: CompletedRoastRestore): DropControlSnapshot =>
    restore.controlBeforeDrop ?? EMPTY_DROP_CONTROL_SNAPSHOT;
