import type { Machine, SerialPort } from '@entities/machine';
import {
    buildProtocolRoasterDef,
    initRoasterFormParams,
    isCustomConnectKey,
    ROASTER_REGISTRY,
} from '@entities/machine';
import { sidecar } from '@shared/lib/sidecar';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect } from 'react';
import type { MachineModalTab, TestState } from './types';

type Args = {
    open: boolean;
    editing: Machine | null | undefined;
    editingId: string | undefined;
    selectedKey: string;
    isCustom: boolean;
    customProtocol: string;
    setError: (v: string) => void;
    setTestState: (v: TestState) => void;
    setTestMessage: (v: string) => void;
    testConnectedRef: { current: boolean };
    setSerialPorts: Dispatch<SetStateAction<SerialPort[]>>;
    setTab: (v: MachineModalTab) => void;
    setSelectedKey: (v: string) => void;
    setParams: Dispatch<SetStateAction<Record<string, string>>>;
    setCustomName: (v: string) => void;
    setCustomBrand: (v: string) => void;
    setCustomProtocol: (v: string) => void;
};

/** Reset form + load serial ports when modal opens / selection changes. */
export const useAddMachineFormSync = ({
    open,
    editing,
    editingId,
    selectedKey,
    isCustom,
    customProtocol,
    setError,
    setTestState,
    setTestMessage,
    testConnectedRef,
    setSerialPorts,
    setTab,
    setSelectedKey,
    setParams,
    setCustomName,
    setCustomBrand,
    setCustomProtocol,
}: Args) => {
    useEffect(() => {
        if (!open) return;
        setError('');
        setTestState('idle');
        setTestMessage('');
        testConnectedRef.current = false;
        void sidecar
            .getSerialPorts()
            .catch(() => [])
            .then((ports) => setSerialPorts(ports as SerialPort[]));
    }, [open, setError, setTestState, setTestMessage, testConnectedRef, setSerialPorts]);

    useEffect(() => {
        if (!open) return;
        if (editingId && editing) {
            setTab('supported');
            setSelectedKey(editing.roasterKey);
            setCustomName(editing.name);
            setCustomBrand(editing.brand === 'Custom' ? '' : editing.brand);
            setCustomProtocol(editing.protocol);
            const includeAddressMap = isCustomConnectKey(editing.roasterKey);
            const def = includeAddressMap
                ? buildProtocolRoasterDef(editing.protocol)
                : ROASTER_REGISTRY[editing.roasterKey];
            if (def)
                setParams(
                    initRoasterFormParams(def, editing.connectionParams, {
                        includeAddressMap,
                        includeWriteMap: includeAddressMap,
                    }),
                );
            return;
        }
        setTab('supported');
        setSelectedKey('');
        setParams({});
        setCustomName('');
        setCustomBrand('');
        setCustomProtocol('');
    }, [open, editingId, editing, setTab, setSelectedKey, setParams, setCustomName, setCustomBrand, setCustomProtocol]);

    useEffect(() => {
        if (!open || editingId || !selectedKey || isCustom) return;
        const def = ROASTER_REGISTRY[selectedKey];
        if (def) setParams(initRoasterFormParams(def));
    }, [open, editingId, selectedKey, isCustom, setParams]);

    useEffect(() => {
        if (!open || editingId || !isCustom || !customProtocol) return;
        const def = buildProtocolRoasterDef(customProtocol);
        setParams(initRoasterFormParams(def, undefined, { includeAddressMap: true, includeWriteMap: true }));
    }, [open, editingId, isCustom, customProtocol, setParams]);
};
