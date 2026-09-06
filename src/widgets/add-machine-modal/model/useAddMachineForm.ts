import type { NetworkHost, RoasterDef, SerialPort } from '@entities/machine';
import {
    addressFormFieldsForProtocol,
    buildProtocolRoasterDef,
    initRoasterFormParams,
    isCustomConnectKey,
    networkScanProtocol,
    PROTOCOLS_WITH_ADDRESS_MAP,
    ROASTER_REGISTRY,
    resolveCustomConnectKey,
    writeMapFormFlags,
} from '@entities/machine';
import { FEATURE, useFeature } from '@shared/lib/features';
import { logger } from '@shared/lib/logger';
import { sidecar } from '@shared/lib/sidecar';
import { useFormEscape } from '@shared/lib/useFormEscape';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assembleConnectionParams } from './assembleConnectionParams';
import { canCommitMachineForm, machineFormMode } from './formMode';
import type { AddMachineFormArgs, CommitAction, MachineModalTab, SuccessActions, TestState } from './types';

export type { CommitAction, MachineModalTab, TestState } from './types';

export const useAddMachineForm = ({ open, onClose, onAdd, editing, onEdit }: AddMachineFormArgs) => {
    const { t } = useTranslation();
    const isEdit = !!editing;
    const editingId = editing?.id;
    const editingRef = useRef(editing);
    editingRef.current = editing;

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

        const current = editingRef.current;
        if (editingId && current) {
            const custom = isCustomConnectKey(current.roasterKey);
            setTab('supported');
            setSelectedKey(current.roasterKey);
            setCustomName(current.name);
            setCustomBrand(current.brand === 'Custom' ? '' : current.brand);
            setCustomProtocol(current.protocol);
            const def = custom ? buildProtocolRoasterDef(current.protocol) : ROASTER_REGISTRY[current.roasterKey];
            if (def) setParams(initRoasterFormParams(def, current.connectionParams, custom));
            return;
        }
        setTab('supported');
        setSelectedKey('');
        setParams({});
        setCustomName('');
        setCustomBrand('');
        setCustomProtocol('');
    }, [open, editingId]);

    const formMode = machineFormMode({ isEdit, tab, roasterKey: editing?.roasterKey });
    const isCustom = formMode !== 'supported';

    const switchTab = (next: MachineModalTab) => {
        if (next === tab) return;
        setTab(next);
        setError('');
        setTestState('idle');
        setTestMessage('');
        setParams({});
        setSelectedKey('');
        if (next === 'supported') {
            setCustomName('');
            setCustomBrand('');
            setCustomProtocol('');
        }
    };

    const selectedDef: RoasterDef | null = useMemo(() => {
        if (formMode === 'custom-edit' && editing) return buildProtocolRoasterDef(editing.protocol);
        if (formMode === 'custom-new') {
            if (!customProtocol) return null;
            return buildProtocolRoasterDef(customProtocol);
        }
        return selectedKey ? (ROASTER_REGISTRY[selectedKey] ?? null) : null;
    }, [formMode, editing, customProtocol, selectedKey]);

    const protocolForAddress = selectedDef?.protocol ?? '';
    const showAddressMap = isCustom && PROTOCOLS_WITH_ADDRESS_MAP.has(protocolForAddress);
    const addressFields = showAddressMap ? addressFormFieldsForProtocol(protocolForAddress) : [];
    const canConfigureControl = useFeature(FEATURE.customMachineControl);
    const { showWriteMap, includeWriteMap } = writeMapFormFlags({
        isCustom,
        protocol: protocolForAddress,
        canConfigureControl,
    });

    const connectKey =
        formMode === 'custom-edit' && editing
            ? editing.roasterKey
            : formMode === 'custom-new'
              ? (resolveCustomConnectKey(customProtocol) ?? '')
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

    const canCommit = canCommitMachineForm({
        mode: formMode,
        selectedKey,
        selectedDef,
        customName,
        customProtocol,
        connectKey,
    });

    const setParam = useCallback((key: string, value: string) => {
        setParams((p) => ({ ...p, [key]: value }));
    }, []);

    const selectRoaster = useCallback((key: string) => {
        setSelectedKey(key);
        setError('');
        setTestState('idle');
        setTestMessage('');
        const def = ROASTER_REGISTRY[key];
        setParams(def ? initRoasterFormParams(def) : {});
    }, []);

    const selectCustomProtocol = useCallback((protocol: string) => {
        setCustomProtocol(protocol);
        setTestState('idle');
        setError('');
        if (!protocol) {
            setParams({});
            return;
        }
        setParams(initRoasterFormParams(buildProtocolRoasterDef(protocol), undefined, true));
    }, []);

    const fieldLabel = (key: string) => t(`addMachine.fields.${key}`, { defaultValue: key });

    const validateOrError = (): Record<string, unknown> | null => {
        if (!selectedDef || !connectKey) return null;
        if (formMode === 'custom-new' && !customName.trim()) {
            setError(t('addMachine.fieldRequired', { field: t('addMachine.customName') }));
            return null;
        }
        const assembled = assembleConnectionParams(selectedDef, params, isCustom, includeWriteMap);
        if (!assembled.ok) {
            setError(t('addMachine.fieldRequired', { field: fieldLabel(assembled.missing) }));
            return null;
        }
        return assembled.typed;
    };

    const commit = async (action: CommitAction) => {
        const typed = validateOrError();
        if (!typed || !selectedDef || !connectKey) return;

        const keepTest = action === 'addAndConnect' || action === 'saveAndConnect';
        const isSave = action === 'save' || action === 'saveAndConnect';
        if (isSave && (!editing || !onEdit)) return;

        setSaving(true);
        setError('');
        try {
            if (!keepTest && testConnectedRef.current) {
                await sidecar.disconnect().catch(() => null);
                testConnectedRef.current = false;
            }
            if (isSave) {
                // biome-ignore lint/style/noNonNullAssertion: error already checked above
                await onEdit!(editing!.id, typed, keepTest);
            } else {
                onAdd(
                    connectKey,
                    selectedDef,
                    typed,
                    isCustom ? { name: customName.trim(), brand: customBrand.trim() || 'Custom' } : undefined,
                );
                if (action === 'addAndConnect') testConnectedRef.current = false;
            }
            if (!keepTest) onClose();
        } catch (err) {
            logger.capture(err, { scope: 'machineForm.commit' });
            setError(t(isEdit ? 'addMachine.failedToSave' : 'addMachine.failedToAdd'));
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        const typed = validateOrError();
        if (!typed || !connectKey || !selectedDef) return;

        if (testConnectedRef.current) {
            await sidecar.disconnect().catch(() => null);
            testConnectedRef.current = false;
        }

        setTestState('testing');
        setTestMessage('');
        setError('');

        try {
            const status = await sidecar.connect(connectKey, typed);
            if (status.connected) {
                const temps = await sidecar.getTemperatures().catch(() => null);
                setTestState('success');
                setTestMessage(
                    temps?.bt != null ? t('addMachine.connectedWithBt', { bt: temps.bt }) : t('common.connected'),
                );
                testConnectedRef.current = true;
            } else {
                setTestState('failed');
                setTestMessage(status.error ?? t('addMachine.connectionFailed'));
            }
        } catch (e) {
            // 타임아웃 후에도 사이드카가 핸드셰이크를 쥐고 있으면 다음 시도가 락에 막힌다
            void sidecar.disconnect().catch(() => null);
            setTestState('failed');
            setTestMessage(e instanceof Error ? e.message : t('addMachine.connectionFailed'));
        }
    };

    const successActions: SuccessActions = useMemo(
        () =>
            isEdit
                ? {
                      secondary: { action: 'save', label: t('addMachine.saveOnly') },
                      primary: {
                          action: 'saveAndConnect',
                          label: t('addMachine.saveAndConnect'),
                          loading: t('addMachine.saving'),
                      },
                  }
                : {
                      secondary: { action: 'add', label: t('addMachine.addOnly') },
                      primary: {
                          action: 'addAndConnect',
                          label: t('addMachine.addAndConnect'),
                          loading: t('addMachine.adding'),
                      },
                  },
        [isEdit, t],
    );

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
