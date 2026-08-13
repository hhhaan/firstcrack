import { describe, expect, it } from 'vitest';
import { isSidecarProcessHealthy, nextSidecarDeadState } from './sidecarDead';

describe('nextSidecarDeadState', () => {
    it('latches true on sidecar-dead', () => {
        expect(nextSidecarDeadState({ isDead: false, event: 'sidecar-dead' })).toBe(true);
        expect(nextSidecarDeadState({ isDead: true, event: 'sidecar-dead' })).toBe(true);
    });

    it('clears only when /status is healthy', () => {
        expect(nextSidecarDeadState({ isDead: true, event: 'status-healthy' })).toBe(false);
        expect(nextSidecarDeadState({ isDead: true, event: 'status-failed' })).toBe(true);
    });

    it('stays clear when already healthy', () => {
        expect(nextSidecarDeadState({ isDead: false, event: 'status-healthy' })).toBe(false);
        expect(nextSidecarDeadState({ isDead: false, event: 'status-failed' })).toBe(false);
    });
});

describe('isSidecarProcessHealthy', () => {
    it('treats any /status payload as healthy (even disconnected machine)', () => {
        expect(isSidecarProcessHealthy({ connected: false, error: 'no machine' })).toBe(true);
        expect(isSidecarProcessHealthy({ connected: true })).toBe(true);
    });

    it('rejects missing / failed status', () => {
        expect(isSidecarProcessHealthy(null)).toBe(false);
        expect(isSidecarProcessHealthy(undefined)).toBe(false);
    });
});
