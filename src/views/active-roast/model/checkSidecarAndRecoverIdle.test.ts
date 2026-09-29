import { observeRoastLink, resetMachineLinkNotice } from '@features/machine-connection/lib/machineLinkNotice';
import { useToastStore } from '@shared/store/toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSidecarAndRecoverIdle } from './useSidecarPolling';

afterEach(() => {
    resetMachineLinkNotice();
    for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
});

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

    it('connected status is forwarded for machine snapshot', async () => {
        const onConnectedStatus = vi.fn();
        const status = { connected: true, roaster: 'giesen_w6a', display_name: 'Giesen W6A', brand: 'Giesen' };

        await checkSidecarAndRecoverIdle({
            getStatus: async () => status,
            getPhase: () => 'roasting',
            setConnected: vi.fn(),
            enterPreheating: vi.fn(),
            onConnectedStatus,
        });

        expect(onConnectedStatus).toHaveBeenCalledWith(status);
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

    it('sets disconnected when status reports idle disconnect (not reconnecting)', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();
        const setReconnecting = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => ({ connected: false, reconnecting: false }),
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
            setReconnecting,
        });

        expect(setConnected).toHaveBeenCalledWith(false);
        expect(setReconnecting).toHaveBeenCalledWith(false);
        expect(enterPreheating).not.toHaveBeenCalled();
    });

    it('holds connected while hardware auto-reconnect is in progress', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();
        const setReconnecting = vi.fn();
        const setError = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => ({
                connected: false,
                reconnecting: true,
                error: 'read failed',
            }),
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
            setReconnecting,
            setError,
        });

        expect(setConnected).toHaveBeenCalledWith(true);
        expect(setReconnecting).toHaveBeenCalledWith(true);
        expect(setError).toHaveBeenCalledWith('read failed');
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

    it('does not promote zombie 401 to disconnect', async () => {
        const setConnected = vi.fn();
        const enterPreheating = vi.fn();
        const setReconnecting = vi.fn();

        await checkSidecarAndRecoverIdle({
            getStatus: async () => {
                throw new Error('unauthorized');
            },
            getPhase: () => 'idle',
            setConnected,
            enterPreheating,
            setReconnecting,
        });

        expect(setConnected).not.toHaveBeenCalled();
        expect(setReconnecting).not.toHaveBeenCalled();
        expect(enterPreheating).not.toHaveBeenCalled();
    });

    it('toasts once for an idle disconnect after a confirmed link', async () => {
        observeRoastLink({ connected: true, observation: 'valid' });
        const disconnected = async () =>
            checkSidecarAndRecoverIdle({
                getStatus: async () => ({ connected: false, reconnecting: false }),
                getPhase: () => 'idle',
                setConnected: vi.fn(),
                enterPreheating: vi.fn(),
                reportLink: true,
            });

        await disconnected();
        expect(useToastStore.getState().toasts).toHaveLength(1);
        await disconnected();
        expect(useToastStore.getState().toasts).toHaveLength(1);
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
