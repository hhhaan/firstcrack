import { useEffect, useState, useSyncExternalStore } from 'react';

const members: symbol[] = [];
const listeners = new Set<() => void>();
const publish = () => {
    for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** A remounted or second screen cannot install another polling loop. */
export const usePollingLease = (enabled: boolean): boolean => {
    const [token] = useState(() => Symbol('roast polling'));
    useEffect(() => {
        if (!enabled) return;
        members.push(token);
        publish();
        return () => {
            const index = members.indexOf(token);
            if (index >= 0) members.splice(index, 1);
            publish();
        };
    }, [enabled, token]);
    return useSyncExternalStore(
        subscribe,
        () => enabled && members[0] === token,
        () => false,
    );
};
