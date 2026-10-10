// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { Machine } from './types';

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
    useMachines.getState().addMachines([draft, { ...draft, name: 'Second' }]);
    expect(JSON.parse(localStorage.getItem('fc_machines') ?? '{}').state.machines).toHaveLength(2);
    vi.resetModules();
    const reloaded = await import('./model');
    expect(reloaded.useMachines.getState().machines.map((machine) => machine.name)).toEqual([
        'Virtual Machine',
        'Imported',
        'Second',
    ]);
});

it('rolls back in-memory machines when persistence fails', async () => {
    const { useMachines } = await import('./model');
    const previous = useMachines.getState().machines;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('disk full');
    });
    try {
        expect(() => useMachines.getState().addMachines([draft])).toThrow('disk full');
        expect(useMachines.getState().machines).toBe(previous);
        expect(localStorage.getItem('fc_machines')).toBeNull();
    } finally {
        write.mockRestore();
    }
});
