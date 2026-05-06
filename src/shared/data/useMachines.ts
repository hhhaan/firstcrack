import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Machine } from '../types/machine';

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface MachinesState {
  machines: Machine[];
  addMachine: (draft: Omit<Machine, 'id' | 'createdAt'>) => Machine;
  removeMachine: (id: string) => void;
  updateMachine: (id: string, patch: Partial<Machine>) => void;
}

export const useMachines = create<MachinesState>()(
  persist(
    (set) => ({
      machines: [],

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
        set((s) => ({ machines: s.machines.filter((m) => m.id !== id) }));
      },

      updateMachine: (id, patch) => {
        set((s) => ({
          machines: s.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        }));
      },
    }),
    {
      name: 'fc_machines', // 기존 localStorage 키 유지 — 저장된 데이터 그대로 마이그레이션
    },
  ),
);
