import { describe, expect, it } from 'vitest';
import { shouldStaleEngageSafeOff } from './stalePidEngage';

describe('shouldStaleEngageSafeOff', () => {
    it('arms safe-off on first engaged sample after connect when not roasting', () => {
        expect(
            shouldStaleEngageSafeOff({
                sidecarConnected: true,
                roasting: false,
                pidState: 'running',
                userEngagedThisSession: false,
                handledForConnectGeneration: 0,
                connectGeneration: 1,
            }),
        ).toBe(true);
    });

    it('skips when the user turned PID on this session', () => {
        expect(
            shouldStaleEngageSafeOff({
                sidecarConnected: true,
                roasting: false,
                pidState: 'running',
                userEngagedThisSession: true,
                handledForConnectGeneration: 0,
                connectGeneration: 1,
            }),
        ).toBe(false);
    });

    it('does not arm during an active roast (mid-roast reconnect)', () => {
        expect(
            shouldStaleEngageSafeOff({
                sidecarConnected: true,
                roasting: true,
                pidState: 'running',
                userEngagedThisSession: false,
                handledForConnectGeneration: 0,
                connectGeneration: 2,
            }),
        ).toBe(false);
    });

    it('runs once per connect generation', () => {
        expect(
            shouldStaleEngageSafeOff({
                sidecarConnected: true,
                roasting: false,
                pidState: 'holding',
                userEngagedThisSession: false,
                handledForConnectGeneration: 2,
                connectGeneration: 2,
            }),
        ).toBe(false);
    });
});
