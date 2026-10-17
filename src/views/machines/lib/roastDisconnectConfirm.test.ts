// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ask } = vi.hoisted(() => ({ ask: vi.fn() }));

vi.mock('@tauri-apps/plugin-dialog', () => ({ ask }));

import {
    type DisconnectMachineRef,
    disconnectMachineWithRoastGuard,
    ROAST_DISCONNECT_CANCEL,
    ROAST_DISCONNECT_MESSAGE,
    ROAST_DISCONNECT_OK,
    ROAST_DISCONNECT_TITLE,
    type RoastDisconnectSession,
} from './roastDisconnectConfirm';

const roastingMachine: DisconnectMachineRef = { id: 'm-roast', roasterKey: 'virtual' };
const otherMachine: DisconnectMachineRef = { id: 'm-other', roasterKey: 'probat' };

const roastingSession = (): RoastDisconnectSession => ({
    phase: 'roasting',
    machineSnapshot: { machine_id: roastingMachine.id, machine_roaster_key: roastingMachine.roasterKey },
});

const markTauri = () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
};

describe('disconnectMachineWithRoastGuard', () => {
    beforeEach(() => {
        ask.mockReset();
        Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    });

    it('roasting + cancel keeps the connection', async () => {
        markTauri();
        ask.mockResolvedValue(false);
        const disconnect = vi.fn();

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(false);

        expect(disconnect).not.toHaveBeenCalled();
        expect(ask).toHaveBeenCalledWith(ROAST_DISCONNECT_MESSAGE, {
            title: ROAST_DISCONNECT_TITLE,
            kind: 'warning',
            okLabel: ROAST_DISCONNECT_OK,
            cancelLabel: ROAST_DISCONNECT_CANCEL,
        });
    });

    it('roasting + confirm disconnects', async () => {
        markTauri();
        ask.mockResolvedValue(true);
        const disconnect = vi.fn().mockResolvedValue(undefined);

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(true);

        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('treats closing the dialog (non-true) as cancel', async () => {
        markTauri();
        ask.mockResolvedValue(null);
        const disconnect = vi.fn();

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(false);

        expect(disconnect).not.toHaveBeenCalled();
    });

    it('not roasting disconnects without a dialog', async () => {
        markTauri();
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const disconnect = vi.fn().mockResolvedValue(undefined);

        for (const phase of ['idle', 'preheating', 'standby', 'ended'] as const) {
            disconnect.mockClear();
            ask.mockClear();
            confirm.mockClear();
            await disconnectMachineWithRoastGuard({
                session: { phase, machineSnapshot: roastingSession().machineSnapshot },
                machine: roastingMachine,
                disconnect,
            });
            expect(ask).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
            expect(disconnect).toHaveBeenCalledOnce();
        }

        confirm.mockRestore();
    });

    it('matches the roast machine by roaster key when the snapshot has no id', async () => {
        markTauri();
        ask.mockResolvedValue(false);
        const disconnect = vi.fn();
        const session: RoastDisconnectSession = {
            phase: 'roasting',
            machineSnapshot: { machine_id: null, machine_roaster_key: 'virtual' },
        };

        await disconnectMachineWithRoastGuard({
            session,
            machine: { id: 'local-only', roasterKey: 'virtual' },
            disconnect,
        });
        expect(ask).toHaveBeenCalledOnce();
        expect(disconnect).not.toHaveBeenCalled();

        ask.mockClear();
        await disconnectMachineWithRoastGuard({
            session,
            machine: { id: 'local-only', roasterKey: 'other' },
            disconnect,
        });
        expect(ask).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('confirms when a roast is in progress and no machine snapshot exists yet', async () => {
        markTauri();
        ask.mockResolvedValue(false);
        const disconnect = vi.fn();

        await disconnectMachineWithRoastGuard({
            session: { phase: 'roasting', machineSnapshot: null },
            machine: roastingMachine,
            disconnect,
        });

        expect(ask).toHaveBeenCalledOnce();
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('disconnecting a different machine skips the dialog during a roast', async () => {
        markTauri();
        const disconnect = vi.fn().mockResolvedValue(undefined);

        await disconnectMachineWithRoastGuard({
            session: roastingSession(),
            machine: otherMachine,
            disconnect,
        });

        expect(ask).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('web fallback: cancel on window.confirm keeps the connection', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const disconnect = vi.fn();

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(false);

        expect(confirm).toHaveBeenCalledWith(ROAST_DISCONNECT_MESSAGE);
        expect(ask).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
        confirm.mockRestore();
    });

    it('web fallback: confirm on window.confirm disconnects', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const disconnect = vi.fn().mockResolvedValue(undefined);

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(true);

        expect(confirm).toHaveBeenCalledWith(ROAST_DISCONNECT_MESSAGE);
        expect(ask).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalledOnce();
        confirm.mockRestore();
    });

    it('falls back to window.confirm when the Tauri dialog throws', async () => {
        markTauri();
        ask.mockRejectedValue(new Error('dialog unavailable'));
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const disconnect = vi.fn();

        await expect(
            disconnectMachineWithRoastGuard({
                session: roastingSession(),
                machine: roastingMachine,
                disconnect,
            }),
        ).resolves.toBe(false);

        expect(confirm).toHaveBeenCalledWith(ROAST_DISCONNECT_MESSAGE);
        expect(disconnect).not.toHaveBeenCalled();
        confirm.mockRestore();
    });
});
