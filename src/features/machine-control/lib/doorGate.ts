/** One in-flight door write for both actuators. A rejected call is not queued. */
export interface DoorGate {
    tryBegin: () => boolean;
    end: () => void;
}

export const createDoorGate = (): DoorGate => {
    let held = false;
    return {
        tryBegin: () => {
            if (held) return false;
            held = true;
            return true;
        },
        end: () => {
            held = false;
        },
    };
};

/** Keep the active HTTP write gated across recoverable screen remounts. */
export const sharedDoorGate = createDoorGate();
