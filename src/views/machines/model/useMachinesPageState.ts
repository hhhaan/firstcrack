import type { Machine, RoasterDef } from '@entities/machine';
import { useMachines, VIRTUAL_ID } from '@entities/machine';
import { canAddMachine, planMaxMachines, useEffectivePlan } from '@shared/lib/features';
import { useCallback, useMemo, useState } from 'react';

export const useMachinesPageState = () => {
    const { addMachine, updateMachine, machines } = useMachines();
    const plan = useEffectivePlan();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
    const [limitBlocked, setLimitBlocked] = useState(false);

    const realMachineCount = useMemo(() => machines.filter((m) => m.id !== VIRTUAL_ID).length, [machines]);
    const maxMachines = planMaxMachines(plan);
    const allowAddMachine = canAddMachine(plan, realMachineCount);

    const handleAdd = useCallback(
        (
            roasterKey: string,
            def: RoasterDef,
            params: Record<string, unknown>,
            meta?: { name?: string; brand?: string },
        ) => {
            if (!canAddMachine(plan, realMachineCount)) {
                setLimitBlocked(true);
                return;
            }
            const name = meta?.name?.trim() || def.display_name;
            const brand = meta?.brand?.trim() || def.brand;
            addMachine({
                name,
                roasterKey,
                displayName: name,
                brand,
                models: meta?.name?.trim() ? [name] : def.models,
                protocol: def.protocol,
                connectionParams: params,
                capabilities: def.capabilities,
                pid: def.pid,
            });
        },
        [addMachine, plan, realMachineCount],
    );

    const updateMachineParams = useCallback(
        (id: string, params: Record<string, unknown>) => {
            updateMachine(id, { connectionParams: params });
        },
        [updateMachine],
    );

    const openAddModal = useCallback(() => {
        if (!canAddMachine(plan, realMachineCount)) {
            setLimitBlocked(true);
            return;
        }
        setLimitBlocked(false);
        setEditingMachine(null);
        setModalOpen(true);
    }, [plan, realMachineCount]);

    const dismissLimitBlocked = useCallback(() => setLimitBlocked(false), []);

    const openEditModal = useCallback((machine: Machine) => {
        setEditingMachine(machine);
        setModalOpen(true);
    }, []);

    const closeModal = useCallback(() => {
        setModalOpen(false);
        setEditingMachine(null);
    }, []);

    return {
        modalOpen,
        editingMachine,
        openAddModal,
        openEditModal,
        closeModal,
        handleAdd,
        updateMachineParams,
        allowAddMachine,
        maxMachines,
        realMachineCount,
        limitBlocked,
        dismissLimitBlocked,
    };
};
