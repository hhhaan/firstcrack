import type { Machine, RoasterDef, SidecarStatus, TemperatureReading } from '@entities/machine';
import { useMachines, VIRTUAL_ID } from '@entities/machine';
import { canAddMachine, planMaxMachines, useEffectivePlan } from '@shared/lib/features';
import { sidecar } from '@shared/lib/sidecar';
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from 'react';

type Args = {
    sidecarStatus: SidecarStatus | null;
    setSidecarStatus: Dispatch<SetStateAction<SidecarStatus | null>>;
    setTemps: Dispatch<SetStateAction<TemperatureReading | null>>;
};

export const useMachinesPageState = ({ sidecarStatus, setSidecarStatus, setTemps }: Args) => {
    const { addMachine, updateMachine, machines } = useMachines();
    const plan = useEffectivePlan();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingMachine, setEditingMachine] = useState<Machine | null>(null);
    const [limitBlocked, setLimitBlocked] = useState(false);

    const realMachineCount = useMemo(() => machines.filter((m) => m.id !== VIRTUAL_ID).length, [machines]);
    const maxMachines = planMaxMachines(plan);
    const allowAddMachine = canAddMachine(plan, realMachineCount);

    const isThisMachineConnected = useCallback(
        (m: Machine) => Boolean(sidecarStatus?.connected && sidecarStatus.roaster === m.roasterKey),
        [sidecarStatus?.connected, sidecarStatus?.roaster],
    );

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

    const handleEdit = useCallback(
        async (id: string, params: Record<string, unknown>, keepConnection = false): Promise<void> => {
            const machine = machines.find((m) => m.id === id);
            const wasConnected = machine ? isThisMachineConnected(machine) : false;
            updateMachine(id, { connectionParams: params });
            if (wasConnected && !keepConnection) {
                const status = await sidecar.disconnect().catch(() => null);
                if (status) setSidecarStatus(status);
                setTemps(null);
            } else if (keepConnection) {
                const status = await sidecar.getStatus().catch(() => null);
                if (status) setSidecarStatus(status);
            }
        },
        [machines, isThisMachineConnected, updateMachine, setSidecarStatus, setTemps],
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
        handleEdit,
        isThisMachineConnected,
        allowAddMachine,
        maxMachines,
        realMachineCount,
        limitBlocked,
        dismissLimitBlocked,
    };
};
