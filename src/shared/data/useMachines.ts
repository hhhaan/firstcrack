import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Machine } from '../types/machine';

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const SIMULATOR_ID = '__simulator__';

const SIMULATOR_MACHINE: Machine = {
  id: SIMULATOR_ID,
  name: 'Simulator',
  roasterKey: 'simulator',
  displayName: 'Simulator',
  brand: 'Internal',
  models: ['Simulator'],
  protocol: 'simulator',
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
      machines: [SIMULATOR_MACHINE],

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
        if (id === SIMULATOR_ID) return; // built-in — 삭제 불가
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
      // Simulator는 localStorage에 저장하지 않음 — 항상 코드에서 주입
      partialize: (state) => ({
        machines: state.machines.filter((m) => m.id !== SIMULATOR_ID),
      }),
      // localStorage 복원 시 Simulator를 맨 앞에 붙여 넣음
      merge: (persisted, current) => ({
        ...current,
        machines: [
          SIMULATOR_MACHINE,
          ...((persisted as { machines: Machine[] }).machines ?? []),
        ],
      }),
    },
  ),
);
