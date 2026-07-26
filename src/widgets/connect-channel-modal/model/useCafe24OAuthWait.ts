import type { SalesChannelConnection } from '@entities/sales-channel';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 2_000;
const OAUTH_WAIT_TIMEOUT_MS = 3 * 60 * 1000;
/** Callback may land a moment before the client clock recorded the wait start. */
const CLOCK_SKEW_MS = 5_000;

/**
 * A Cafe24 connection counts as "just authorized" when it is active, matches the
 * requested mall (blank mall = any) and was touched after the wait started.
 */
export const hasFreshCafe24Connection = (
    channels: SalesChannelConnection[],
    mallId: string,
    waitSinceMs: number,
): boolean => {
    const mall = mallId.trim().toLowerCase();
    return channels.some(
        (c) =>
            c.platform === 'cafe24' &&
            c.status === 'active' &&
            (!mall || c.shop_identifier.toLowerCase() === mall) &&
            new Date(c.updated_at).getTime() >= waitSinceMs - CLOCK_SKEW_MS,
    );
};

interface UseCafe24OAuthWaitParams {
    /** Modal is open on the Cafe24 platform. */
    enabled: boolean;
    mallId: string;
    channels: SalesChannelConnection[];
    /** React Query `refetch` — stable identity, so the poll interval is not restarted per render. */
    refetchChannels: () => void;
    onConnected: () => void;
}

export interface Cafe24OAuthWait {
    waiting: boolean;
    timedOut: boolean;
    start: () => void;
    stop: () => void;
}

/**
 * Polls the channel list after the browser hand-off until the callback stores the
 * connection, or the wait deadline passes.
 */
export const useCafe24OAuthWait = ({
    enabled,
    mallId,
    channels,
    refetchChannels,
    onConnected,
}: UseCafe24OAuthWaitParams): Cafe24OAuthWait => {
    const [waiting, setWaiting] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const waitSinceRef = useRef(0);

    const start = useCallback(() => {
        waitSinceRef.current = Date.now();
        setTimedOut(false);
        setWaiting(true);
    }, []);

    const stop = useCallback(() => {
        setWaiting(false);
        setTimedOut(false);
    }, []);

    // Deadline. Deps are booleans only, so a poll result can never re-run this effect
    // and push the timeout out (the previous bug: the whole query object was a dep).
    useEffect(() => {
        if (!enabled || !waiting) return;
        const id = window.setTimeout(() => {
            setWaiting(false);
            setTimedOut(true);
        }, OAUTH_WAIT_TIMEOUT_MS);
        return () => window.clearTimeout(id);
    }, [enabled, waiting]);

    // Poll.
    useEffect(() => {
        if (!enabled || !waiting) return;
        const id = window.setInterval(() => refetchChannels(), POLL_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, [enabled, waiting, refetchChannels]);

    // Resolution. Holds no timer, so re-running on every poll result is harmless.
    useEffect(() => {
        if (!enabled || !waiting) return;
        if (!hasFreshCafe24Connection(channels, mallId, waitSinceRef.current)) return;
        setWaiting(false);
        onConnected();
    }, [enabled, waiting, channels, mallId, onConnected]);

    return { waiting, timedOut, start, stop };
};
