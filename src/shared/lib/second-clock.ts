/** One wall-clock timer shared by session and display subscribers. */
const listeners = new Map<() => void, number>();
let timer: ReturnType<typeof setInterval> | null = null;

export const subscribeSecondClock = (listener: () => void): (() => void) => {
    listeners.set(listener, (listeners.get(listener) ?? 0) + 1);
    timer ??= setInterval(() => {
        for (const update of listeners.keys()) update();
    }, 1000);
    return () => {
        const count = listeners.get(listener) ?? 0;
        if (count <= 1) listeners.delete(listener);
        else listeners.set(listener, count - 1);
        if (listeners.size === 0 && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };
};
