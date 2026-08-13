export type MachineControlPidState = 'off' | 'running' | 'holding' | 'fault' | string;

export const shouldMountMachineControl = ({
    entitled,
    pidState,
    writable,
    hasRoles,
}: {
    entitled: boolean;
    pidState: MachineControlPidState;
    writable: boolean;
    hasRoles: boolean;
}): boolean => {
    const pidHoldsHeater = pidState === 'running' || pidState === 'holding';
    const faultHold = pidState === 'fault';
    // FAULT reason must survive disconnect; unmounting the panel drops it (#206).
    if (faultHold) return true;
    if (!entitled && !pidHoldsHeater) return false;
    if (!writable) return false;
    if (!hasRoles) return false;
    return true;
};
