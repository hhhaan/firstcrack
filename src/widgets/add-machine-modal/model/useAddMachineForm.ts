import type { NetworkHost, RoasterDef, SerialPort } from '@entities/machine';
import {
    addressFormFieldsForProtocol,
    buildProtocolRoasterDef,
    isCustomConnectKey,
    networkScanProtocol,
    PROTOCOLS_WITH_ADDRESS_MAP,
    ROASTER_REGISTRY,
    resolveCustomConnectKey,
    writeMapFormFlags,
} from '@entities/machine';
import { FEATURE, useFeature } from '@shared/lib/features';
import { sidecar } from '@shared/lib/sidecar';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { AddMachineFormArgs, MachineModalTab, TestState } from './types';
import { useAddMachineFormSync } from './useAddMachineFormSync';
import { useMachineFormActions } from './useMachineFormActions';

export type { CommitAction, MachineModalTab, TestState } from './types';

export const useAddMachineForm = ({ open, onClose, onAdd, editing, onEdit }: AddMachineFormArgs) => {
    const isEdit = !!editing;
    const editingId = editing?.id;
    const [tab, setTab] = useState<MachineModalTab>('supported');
    const [selectedKey, setSelectedKey] = useState('');
    const [params, setParams] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [customName, setCustomName] = useState('');
    const [customBrand, setCustomBrand] = useState('');
    const [customProtocol, setCustomProtocol] = useState('');
    const [testState, setTestState] = useState<TestState>('idle');
    const [testMessage, setTestMessage] = useState('');
    const testConnectedRef = useRef(false);
    const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);
    const [networkHosts, setNetworkHosts] = useState<NetworkHost[]>([]);
    const [scanningNetwork, setScanningNetwork] = useState(false);
    const [scannedNetworkOnce, setScannedNetworkOnce] = useState(false);

    /** Re-fetch serial ports on demand (USB plugged in while the modal is open). */
    const refreshSerialPorts = useCallback(() => {
        void sidecar
            .getSerialPorts()
            .catch(() => [])
            .then((ports) => setSerialPorts(ports as SerialPort[]));
    }, []);

    const scanNetworkHosts = useCallback((protocol: string) => {
        const scanKey = networkScanProtocol(protocol);
        if (!scanKey) return;
        setScanningNetwork(true);
        void sidecar
            .scanNetwork(scanKey)
            .catch(() => [] as NetworkHost[])
            .then((hosts) => {
                setNetworkHosts(hosts);
                setScannedNetworkOnce(true);
            })
            .finally(() => setScanningNetwork(false));
    }, []);

    const editingIsCustom = isEdit && !!editing && isCustomConnectKey(editing.roasterKey);
    const isCustom = (!isEdit && tab === 'custom') || editingIsCustom;

    useAddMachineFormSync({
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
    });

    const switchTab = (next: MachineModalTab) => {
        if (next === tab) return;
        setTab(next);
        setError('');
        setTestState('idle');
        setTestMessage('');
        setParams({});
        if (next === 'supported') {
            setSelectedKey('');
            setCustomName('');
            setCustomBrand('');
            setCustomProtocol('');
        } else {
            setSelectedKey('');
        }
    };

    const selectedDef: RoasterDef | null = useMemo(() => {
        if (isCustom) {
            if (editingIsCustom && editing) return buildProtocolRoasterDef(editing.protocol);
            if (!customProtocol) return null;
            return buildProtocolRoasterDef(customProtocol);
        }
        return selectedKey ? (ROASTER_REGISTRY[selectedKey] ?? null) : null;
    }, [isCustom, editingIsCustom, editing, customProtocol, selectedKey]);

    const protocolForAddress = selectedDef?.protocol ?? '';
    const showAddressMap = isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(protocolForAddress);
    const addressFields = showAddressMap ? addressFormFieldsForProtocol(protocolForAddress) : [];
    const canConfigureControl = useFeature(FEATURE.customMachineControl);
    const { showWriteMap, includeWriteMap } = writeMapFormFlags({
        isCustom,
        protocol: protocolForAddress,
        canConfigureControl,
    });

    const connectKey = isCustom
        ? editingIsCustom && editing
            ? editing.roasterKey
            : (resolveCustomConnectKey(customProtocol) ?? '')
        : selectedKey;

    const handleClose = useCallback(async () => {
        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }
        onClose();
    }, [onClose]);

    useFormEscape(open, () => {
        void handleClose();
    });

    const canCommit = isCustom
        ? Boolean((isEdit || customName.trim()) && (editingIsCustom || customProtocol) && connectKey && selectedDef)
        : Boolean(selectedKey && selectedDef);

    const setParam = useCallback((key: string, value: string) => {
        setParams((p) => ({ ...p, [key]: value }));
    }, []);

    const selectRoaster = useCallback((key: string) => {
        setSelectedKey(key);
        setTestState('idle');
        setTestMessage('');
        setError('');
    }, []);

    const selectCustomProtocol = useCallback((protocol: string) => {
        setCustomProtocol(protocol);
        setTestState('idle');
        setError('');
    }, []);

    const { commit, handleTestConnection, successActions } = useMachineFormActions({
        isEdit,
        isCustom,
        selectedDef,
        connectKey,
        customName,
        customBrand,
        params,
        showAddressMap,
        includeWriteMap,
        editing,
        onEdit,
        onAdd,
        onClose,
        testConnectedRef,
        setSaving,
        setError,
        setTestState,
        setTestMessage,
    });

    return {
        isEdit,
        tab,
        switchTab,
        selectedKey,
        selectRoaster,
        params,
        setParam,
        saving,
        error,
        customName,
        setCustomName,
        customBrand,
        setCustomBrand,
        customProtocol,
        selectCustomProtocol,
        testState,
        testMessage,
        serialPorts,
        refreshSerialPorts,
        networkHosts,
        scanningNetwork,
        scannedNetworkOnce,
        scanNetworkHosts,
        isCustom,
        selectedDef,
        showAddressMap,
        addressFields,
        showWriteMap,
        canCommit,
        handleClose,
        commit,
        handleTestConnection,
        successActions,
    };
};
