// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReplayMachineMismatch } from '../../views/active-roast/lib/active-roast-screen';
import { snapshotFromSidecar } from './lib';
import type { Machine } from './types';

const legacyW60: Machine = {
    id: 'quest-bean-w60',
    name: '퀘스트빈',
    roasterKey: 'giesen_standard',
    displayName: 'Giesen W6A / W15A / W30A / W45A / W60A',
    brand: 'Giesen',
    models: ['W6A', 'W6E', 'W15A', 'W30A', 'W45A', 'W60A'],
    protocol: 's7',
    connectionParams: {
        host: '192.168.10.60',
        port: 102,
        rack: 0,
        slot: 0,
        channels: [{ role: 'BT', db: 3, offset: 116 }],
        write_map: { heater: { db: 2, offset: 16, min: 1, max: 100 } },
    },
    capabilities: ['heater', 'fan', 'drum'],
    pid: { Kp: 18, Ki: 0.01, Kd: 3 },
    createdAt: '2026-09-01T00:00:00.000Z',
};

describe('saved machine migration', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('persists the W60 key once while preserving identity and custom connection settings', async () => {
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [legacyW60] }, version: 0 }));
        const { machinesForPicker, useMachines, VIRTUAL_ID } = await import('./model');
        const migrated = {
            ...legacyW60,
            roasterKey: 'giesen_w45a_w60a',
            displayName: 'Giesen W45A / W60A',
            models: ['W45A', 'W60A'],
        };

        expect(useMachines.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            migrated,
        ]);
        expect(JSON.parse(localStorage.getItem('fc_machines') ?? 'null')).toEqual({
            state: { machines: [migrated] },
            version: 1,
        });

        await useMachines.persist.rehydrate();
        expect(useMachines.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            migrated,
        ]);
        expect(useMachines.getState().machines.filter((machine) => machine.id === VIRTUAL_ID)).toHaveLength(1);
        expect(
            useMachines.getState().machines.filter((machine) => machine.roasterKey === 'virtual_readonly'),
        ).toHaveLength(1);
        const seeded = useMachines.getState().machines;
        expect(machinesForPicker(seeded, false).some((machine) => machine.id.startsWith('__virtual'))).toBe(false);
        expect(machinesForPicker(seeded, true).some((machine) => machine.roasterKey === 'virtual_readonly')).toBe(true);
        expect(machinesForPicker(seeded, true).some((machine) => machine.roasterKey === 'virtual_giesen_w1')).toBe(
            true,
        );
        expect(
            machinesForPicker(seeded, true).some((machine) => machine.roasterKey === 'virtual_giesen_w45a_w60a'),
        ).toBe(true);

        vi.resetModules();
        const { useMachines: restarted } = await import('./model');
        expect(restarted.persist.hasHydrated()).toBe(true);
        expect(restarted.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            migrated,
        ]);
        const snapshot = snapshotFromSidecar(
            { connected: true, roaster: 'giesen_w45a_w60a', machine_id: legacyW60.id },
            restarted.getState().machines,
        );
        expect(snapshot).toEqual({
            machine_id: legacyW60.id,
            machine_name: legacyW60.name,
            machine_roaster_key: 'giesen_w45a_w60a',
            machine_brand: legacyW60.brand,
            machine_protocol: legacyW60.protocol,
        });
        expect(
            isReplayMachineMismatch(
                legacyW60.roasterKey,
                snapshot?.machine_roaster_key ?? null,
                legacyW60.id,
                snapshot?.machine_id,
            ),
        ).toBe(false);
    });

    it('converts every legacy Standard registration using the latest settings saved before restart', async () => {
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [legacyW60] }, version: 0 }));
        const edited = { ...legacyW60, connectionParams: { ...legacyW60.connectionParams, host: '192.168.10.61' } };
        const another = { ...legacyW60, id: 'another-standard', name: '예전 등록' };
        const alreadyW60 = { ...legacyW60, id: 'already-w60', roasterKey: 'giesen_w45a_w60a' };
        // The running old app can still save version-0 registrations while an update waits for restart.
        localStorage.setItem(
            'fc_machines',
            JSON.stringify({ state: { machines: [edited, another, alreadyW60] }, version: 0 }),
        );
        const { useMachines } = await import('./model');
        expect(useMachines.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            { ...edited, roasterKey: 'giesen_w45a_w60a', displayName: 'Giesen W45A / W60A', models: ['W45A', 'W60A'] },
            { ...another, roasterKey: 'giesen_w45a_w60a', displayName: 'Giesen W45A / W60A', models: ['W45A', 'W60A'] },
            alreadyW60,
        ]);
    });

    it('keeps other roaster registrations unchanged', async () => {
        const other = { ...legacyW60, roasterKey: 'giesen_w6a_pro' };
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [other] }, version: 0 }));
        const { useMachines } = await import('./model');
        expect(useMachines.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            other,
        ]);
    });

    it('does not reclassify Standard machines registered after the migration', async () => {
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [legacyW60] }, version: 1 }));
        const { useMachines } = await import('./model');
        expect(useMachines.getState().machines.filter((machine) => !machine.id.startsWith('__virtual'))).toEqual([
            legacyW60,
        ]);
    });
});

describe('machine imports', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    const draft: Omit<Machine, 'id' | 'createdAt'> = {
        name: 'Imported',
        roasterKey: 'custom_modbus',
        displayName: 'Imported',
        brand: 'Firescope',
        models: [],
        protocol: 'modbus',
        connectionParams: { modbus_type: 'rtu', port: '/dev/tty.example' },
        capabilities: [],
        pid: null,
    };

    it('persists a batch together and restores it on reload', async () => {
        const { useMachines } = await import('./model');
        useMachines.getState().importMachines([draft, { ...draft, name: 'Second' }]);
        expect(JSON.parse(localStorage.getItem('fc_machines') ?? '{}').state.machines).toHaveLength(2);
        vi.resetModules();
        const reloaded = await import('./model');
        expect(reloaded.useMachines.getState().machines.map((machine) => machine.name)).toEqual([
            'Virtual Machine',
            'Virtual Machine (read only)',
            'Giesen W1A (가상)',
            'Giesen W45A / W60A (가상)',
            'Imported',
            'Second',
        ]);
    });

    it('rolls back in-memory machines when persistence fails', async () => {
        const { useMachines } = await import('./model');
        const existing = useMachines.getState().addMachine(draft);
        const previous = useMachines.getState().machines;
        const stored = localStorage.getItem('fc_machines');
        const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('disk full');
        });
        try {
            expect(() =>
                useMachines.getState().importMachines(
                    [draft],
                    [
                        {
                            id: existing.id,
                            patch: { connectionParams: { host: 'updated' }, capabilities: ['heater'] },
                        },
                    ],
                ),
            ).toThrow('disk full');
            expect(useMachines.getState().machines).toBe(previous);
            expect(localStorage.getItem('fc_machines')).toBe(stored);
        } finally {
            write.mockRestore();
        }
    });
});
