import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ROASTER_REGISTRY } from './roasterRegistry';
import type { Machine } from './types';

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const VIRTUAL_ID = '__virtual__';
export const VIRTUAL_READONLY_ID = '__virtual_readonly__';

const SIMULATOR_IDS = new Set([VIRTUAL_ID, VIRTUAL_READONLY_ID]);

/** Seeded by the app. Shown only when profiles.simulator_enabled is on. */
export const isSimulatorMachine = (id: string): boolean => SIMULATOR_IDS.has(id);

/** Machine list shown to the user. The store always keeps the virtual rows. */
export function machinesForPicker(machines: Machine[], simulatorEnabled: boolean): Machine[] {
    if (simulatorEnabled) return machines;
    return machines.filter((machine) => !isSimulatorMachine(machine.id));
}

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

const VIRTUAL_READONLY_MACHINE: Machine = {
    id: VIRTUAL_READONLY_ID,
    name: 'Virtual Machine (read only)',
    roasterKey: 'virtual_readonly',
    displayName: 'Virtual Machine (read only)',
    brand: 'Internal',
    models: ['읽기 전용'],
    protocol: 'virtual',
    connectionParams: {},
    capabilities: ['heater', 'fan', 'drum'],
    pid: null,
    createdAt: '2024-01-01T00:00:00.000Z',
};

const SEEDED_SIMULATORS = [VIRTUAL_MACHINE, VIRTUAL_READONLY_MACHINE];

interface MachinesState {
    machines: Machine[];
    addMachine: (draft: Omit<Machine, 'id' | 'createdAt'> & { id?: string }) => Machine;
    importMachines: (
        drafts: Omit<Machine, 'id' | 'createdAt'>[],
        updates?: { id: string; patch: Pick<Machine, 'connectionParams' | 'capabilities'> }[],
    ) => void;
    removeMachine: (id: string) => void;
    updateMachine: (id: string, patch: Partial<Machine>) => void;
}

export const useMachines = create<MachinesState>()(
    persist(
        (set, get) => ({
            machines: SEEDED_SIMULATORS,

            addMachine: (draft) => {
                const machine: Machine = {
                    ...draft,
                    id: draft.id ?? uid(),
                    createdAt: new Date().toISOString(),
                };
                set((s) => ({ machines: [...s.machines, machine] }));
                return machine;
            },

            importMachines: (drafts, updates = []) => {
                const previous = get().machines;
                const added = drafts.map((draft) => ({ ...draft, id: uid(), createdAt: new Date().toISOString() }));
                try {
                    set({
                        machines: [
                            ...previous.map((machine) => {
                                const update = updates.find(({ id }) => id === machine.id);
                                return update ? { ...machine, ...update.patch } : machine;
                            }),
                            ...added,
                        ],
                    });
                } catch (error) {
                    try {
                        set({ machines: previous });
                    } catch {
                        /* Storage remains unavailable. */
                    }
                    throw error;
                }
            },

            removeMachine: (id) => {
                if (isSimulatorMachine(id)) return;
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
            version: 1, // Keep after removing migrate so converted registrations still hydrate.
            migrate: (persisted, version) => {
                const state = persisted as Pick<MachinesState, 'machines'>;
                if (version !== 0) return state;
                const w60 = ROASTER_REGISTRY.giesen_w45a_w60a;
                // shortcut: version-0 Standard is Quest Bean's W60; remove after its v1 migration is confirmed.
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
                machines: state.machines.filter((m) => !isSimulatorMachine(m.id)),
            }),
            merge: (persisted, current) => ({
                ...current,
                machines: [...SEEDED_SIMULATORS, ...((persisted as { machines: Machine[] }).machines ?? [])],
            }),
        },
    ),
);
