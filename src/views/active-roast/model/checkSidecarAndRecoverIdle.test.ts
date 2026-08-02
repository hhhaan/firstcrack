import { describe, expect, it, vi } from 'vitest';
import { checkSidecarAndRecoverIdle } from './useSidecarPolling';

describe('checkSidecarAndRecoverIdle (#178)', () => {
    it('enters preheating when connected and phase is idle', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => ({ connected: true, capabilities: ['heater'] }),
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
        });

        expect(setConnected).toHaveBeenCalledWith(true, ['heater']);
        expect(enterPreheating).toHaveBeenCalledWith(['heater']);
    });

    it('does not enter preheating when already non-idle', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => ({ connected: true, capabilities: [] }),
            getPhase: () => 'roasting',
            setConnected,
            enterPreheating,
        });

        expect(setConnected).toHaveBeenCalledWith(true, []);
        expect(enterPreheating).not.toHaveBeenCalled();
    });

    it('sets disconnected when status reports not connected', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => ({ connected: false }),
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
        });

        expect(setConnected).toHaveBeenCalledWith(false);
        expect(enterPreheating).not.toHaveBeenCalled();
    });

    it('sets disconnected when getStatus throws', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => {
                throw new Error('sidecar down');
            },
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
        });

        expect(setConnected).toHaveBeenCalledWith(false);
        expect(enterPreheating).not.toHaveBeenCalled();
    });
});

describe('idle recovery effect wiring (structural)', () => {
    it('useSidecarPolling polls idle status on interval constant', async () => {
        // Ensures the shipped module still exports the interval used by the effect.
        const mod = await import('./useSidecarPolling');
        expect(mod.IDLE_STATUS_POLL_MS).toBe(5000);
        expect(typeof mod.checkSidecarAndRecoverIdle).toBe('function');
    });
});
