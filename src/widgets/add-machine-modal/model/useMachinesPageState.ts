import type { Machine, RoasterDef, SidecarStatus, TemperatureReading } from '@entities/machine';
import { useMachines } from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';

type Args = {
    sidecarStatus: SidecarStatus | null;
    setSidecarStatus: Dispatch<SetStateAction<SidecarStatus | null>>;
    setTemps: Dispatch<SetStateAction<TemperatureReading | null>>;
};

export const useMachinesPageState = ({ sidecarStatus, setSidecarStatus, setTemps }: Args) => {
    const { addMachine, updateMachine, machines } = useMachines();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingMachine, setEditingMachine] = useState<Machine | null>(null);

    const isThisMachineConnected = useCallback(
        (m: Machine) => Boolean(sidecarStatus?.connected && sidecarStatus.roaster === m.roasterKey),
        [sidecarStatus?.connected, sidecarStatus?.roaster],
    );

    const handleAdd = useCallback(
        (roasterKey: string, def: RoasterDef, params: Record<string, unknown>) => {
            addMachine({
                name: def.display_name,
                roasterKey,
                displayName: def.display_name,
                brand: def.brand,
                models: def.models,
                protocol: def.protocol,
                connectionParams: params,
                capabilities: def.capabilities,
                pid: def.pid,
            });
        },
        [addMachine],
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
        setEditingMachine(null);
        setModalOpen(true);
    }, []);

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
    };
};
