type Listener = () => void;

const listeners = new Set<Listener>();

/** Fired only after the Machines disconnect button releases the sidecar. */
export const subscribeExplicitMachineDisconnect = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const emitExplicitMachineDisconnect = (): void => {
    for (const listener of [...listeners]) listener();
};
