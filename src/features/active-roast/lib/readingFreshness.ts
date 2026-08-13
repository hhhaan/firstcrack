export type ReadingFreshness = 'live' | 'stale' | 'reconnecting' | 'disconnected';

export const readingFreshness = ({
    connected,
    stale,
    reconnecting,
}: {
    connected: boolean;
    stale: boolean;
    reconnecting: boolean;
}): ReadingFreshness => {
    if (reconnecting) return 'reconnecting';
    if (!connected) return 'disconnected';
    if (stale) return 'stale';
    return 'live';
};
