// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        const { useMachines, VIRTUAL_ID } = await import('./model');
        const migrated = {
            ...legacyW60,
            roasterKey: 'giesen_w45a_w60a',
            displayName: 'Giesen W45A / W60A',
            models: ['W45A', 'W60A'],
        };

        expect(useMachines.getState().machines.filter((machine) => machine.id !== VIRTUAL_ID)).toEqual([migrated]);
        expect(JSON.parse(localStorage.getItem('fc_machines') ?? 'null')).toEqual({
            state: { machines: [migrated] },
            version: 1,
        });

        await useMachines.persist.rehydrate();
        expect(useMachines.getState().machines.filter((machine) => machine.id !== VIRTUAL_ID)).toEqual([migrated]);
        expect(useMachines.getState().machines.filter((machine) => machine.id === VIRTUAL_ID)).toHaveLength(1);
    });

    it('keeps other roaster registrations unchanged', async () => {
        const other = { ...legacyW60, roasterKey: 'giesen_w6a_pro' };
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [other] }, version: 0 }));
        const { useMachines, VIRTUAL_ID } = await import('./model');
        expect(useMachines.getState().machines.filter((machine) => machine.id !== VIRTUAL_ID)).toEqual([other]);
    });

    it('does not reclassify Standard machines registered after the migration', async () => {
        localStorage.setItem('fc_machines', JSON.stringify({ state: { machines: [legacyW60] }, version: 1 }));
        const { useMachines, VIRTUAL_ID } = await import('./model');
        expect(useMachines.getState().machines.filter((machine) => machine.id !== VIRTUAL_ID)).toEqual([legacyW60]);
    });
});
