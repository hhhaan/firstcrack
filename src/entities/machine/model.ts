import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ROASTER_REGISTRY } from './roasterRegistry';
import type { Machine } from './types';

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const VIRTUAL_ID = '__virtual__';

const VIRTUAL_MACHINE: Machine = {
    id: VIRTUAL_ID,
    name: 'Virtual Machine',
    roasterKey: 'virtual',
    displayName: 'Virtual Machine',
    brand: 'Internal',
    models: ['가상 머신'],
    protocol: 'virtual',
    connectionParams: {},
    capabilities: [],
    pid: null,
    createdAt: '2024-01-01T00:00:00.000Z',
};

interface MachinesState {
    machines: Machine[];
    addMachine: (draft: Omit<Machine, 'id' | 'createdAt'>) => Machine;
    removeMachine: (id: string) => void;
    updateMachine: (id: string, patch: Partial<Machine>) => void;
}

export const useMachines = create<MachinesState>()(
    persist(
        (set) => ({
            machines: [VIRTUAL_MACHINE],

            addMachine: (draft) => {
                const machine: Machine = {
                    ...draft,
                    id: uid(),
                    createdAt: new Date().toISOString(),
                };
                set((s) => ({ machines: [...s.machines, machine] }));
                return machine;
            },

            removeMachine: (id) => {
                if (id === VIRTUAL_ID) return;
                set((s) => ({ machines: s.machines.filter((m) => m.id !== id) }));
            },

            updateMachine: (id, patch) => {
                set((s) => ({
                    machines: s.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
                }));
            },
        }),
        {
            name: 'fc_machines',
            version: 1,
            migrate: (persisted, version) => {
                const state = persisted as Pick<MachinesState, 'machines'>;
                if (version !== 0) return state;
                const w60 = ROASTER_REGISTRY.giesen_w45a_w60a;
                // shortcut: legacy Standard means Quest Bean's W60; revisit if another legacy user appears.
                return {
                    ...state,
                    machines: state.machines.map((machine) =>
                        machine.roasterKey === 'giesen_standard'
                            ? {
                                  ...machine,
                                  roasterKey: 'giesen_w45a_w60a',
                                  displayName: w60.display_name,
                                  models: [...w60.models],
                              }
                            : machine,
                    ),
                };
            },
            partialize: (state) => ({
                machines: state.machines.filter((m) => m.id !== VIRTUAL_ID),
            }),
            merge: (persisted, current) => ({
                ...current,
                machines: [VIRTUAL_MACHINE, ...((persisted as { machines: Machine[] }).machines ?? [])],
            }),
        },
    ),
);
