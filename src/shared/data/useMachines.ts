import { useState, useCallback } from 'react';
import type { Machine } from '../types/machine';

const STORAGE_KEY = 'fc_machines';

const load = (): Machine[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
};

const save = (machines: Machine[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(machines));
};

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const useMachines = () => {
  const [machines, setMachines] = useState<Machine[]>(load);

  const addMachine = useCallback((draft: Omit<Machine, 'id' | 'createdAt'>) => {
    const machine: Machine = {
      ...draft,
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    setMachines(prev => {
      const next = [...prev, machine];
      save(next);
      return next;
    });
    return machine;
  }, []);

  const removeMachine = useCallback((id: string) => {
    setMachines(prev => {
      const next = prev.filter(m => m.id !== id);
      save(next);
      return next;
    });
  }, []);

  const updateMachine = useCallback((id: string, patch: Partial<Machine>) => {
    setMachines(prev => {
      const next = prev.map(m => m.id === id ? { ...m, ...patch } : m);
      save(next);
      return next;
    });
  }, []);

  return { machines, addMachine, removeMachine, updateMachine };
};
